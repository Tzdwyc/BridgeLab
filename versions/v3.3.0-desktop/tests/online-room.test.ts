import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { scoreContract } from '../src/core/scoring';
import { deck } from '../src/core/deal';
import { newGameFromDeal } from '../src/core/game';
import { agreementVersionFor } from '../src/ai/bid-strategy';
import { isVulnerable, PASS, SEATS, sideOf, type Hands, type Seat } from '../src/core/types';
import { createJoinNonce, LAN_SUPPORTED_AGREEMENTS, type RoomAction, type RoomRequest, type RoomResponse } from '../src/online/protocol';
import { LanRoom, type RoomOptions } from '../src/online/room';
import { isCompatibleRoomAgreement } from '../src/online/useLanRoom';

beforeAll(() => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto);
});

function unwrap(response: RoomResponse) {
  if (!response.ok) throw new Error(`${response.code}: ${response.message}`);
  return response;
}

function setup(options: RoomOptions = {}) {
  let time = 0;
  let nextId = 0;
  const room = new LanRoom({ now: () => time, timeoutMs: 100, ...options });
  const capabilities = { supportedAgreements: LAN_SUPPORTED_AGREEMENTS };
  const tokens = new Map<Seat, string>();
  const join = (seat: Seat, nonce = createJoinNonce()) => {
    const response = unwrap(room.request({ kind: 'join', roomCode: room.roomCode, seat, nonce, ...capabilities }));
    tokens.set(seat, response.token!);
    return response;
  };
  const ask = (kind: 'poll' | 'resume' | 'leave', seat: Seat) => room.request({ kind, token: tokens.get(seat)!, ...capabilities });
  const poll = (seat: Seat) => unwrap(ask('poll', seat)).snapshot;
  const command = (seat: Seat, action: RoomAction): RoomRequest => ({
    kind: 'action', token: tokens.get(seat)!, id: String(nextId++), revision: poll(seat).revision, action, ...capabilities,
  });
  const act = (seat: Seat, action: RoomAction) => room.request(command(seat, action));
  const start = () => {
    SEATS.forEach(seat => join(seat));
    SEATS.forEach(seat => unwrap(act(seat, { kind: 'ready', ready: true })));
  };
  return { room, join, ask, poll, command, act, start, advance: (ms: number) => { time += ms; } };
}

describe('LAN room authority', () => {
  it('accepts explicit current host cards and rejects missing, unknown, or old host metadata', () => {
    for (const system of ['sayc', 'two-over-one', 'precision', 'natural-lite'] as const) {
      expect(isCompatibleRoomAgreement({ biddingSystem: system, agreementVersion: agreementVersionFor(system) })).toBe(true);
      expect(isCompatibleRoomAgreement({ biddingSystem: system })).toBe(false);
    }
    for (const metadata of [{}, { agreementVersion: agreementVersionFor('two-over-one') },
      { biddingSystem: 'unknown', agreementVersion: 'unknown-v2.2' },
      { biddingSystem: 'sayc', agreementVersion: 'sayc-v2.1' },
      { biddingSystem: 'two-over-one', agreementVersion: 'two-over-one-v2.1' }])
      expect(isCompatibleRoomAgreement(metadata)).toBe(false);
  });

  it('rejects unversioned and incompatible cards before seat reservation', () => {
    expect(() => new LanRoom({ biddingSystem: 'precision', agreementVersion: 'unknown-card' })).toThrow('约定版本');
    expect(() => new LanRoom({ biddingSystem: 'unknown' as RoomOptions['biddingSystem'] })).toThrow('不支持');
    for (const biddingSystem of ['sayc', 'two-over-one'] as const) {
      const natural = setup({ biddingSystem });
      const request = { kind: 'join', roomCode: natural.room.roomCode, seat: 'N', nonce: createJoinNonce() };
      expect(natural.room.request(request)).toMatchObject({ ok: false, code: 'CLIENT_UPDATE_REQUIRED' });
      expect(natural.room.request({ ...request, supportedAgreements: { [biddingSystem]: `${biddingSystem}-v2.1` } }))
        .toMatchObject({ ok: false, code: 'CLIENT_UPDATE_REQUIRED' });
      expect(natural.join('N').snapshot).toMatchObject({ biddingSystem, agreementVersion: biddingSystem === 'sayc' ? 'sayc-v3.0-standard' : 'natural-v3.0-drury' });
    }
    const table = setup({ biddingSystem: 'precision' });
    const join = { kind: 'join', roomCode: table.room.roomCode, seat: 'N', nonce: createJoinNonce() };
    expect(table.room.request(join)).toMatchObject({ ok: false, code: 'CLIENT_UPDATE_REQUIRED' });
    expect(table.room.request({ ...join, supportedAgreements: { precision: 'unknown-card' } }))
      .toMatchObject({ ok: false, code: 'CLIENT_UPDATE_REQUIRED' });
    const north = table.join('N');
    expect(north.snapshot.seats.N).toBe('connected');
    expect(table.room.request({ kind: 'resume', token: north.token }))
      .toMatchObject({ ok: false, code: 'CLIENT_UPDATE_REQUIRED' });
    expect(table.room.request({ kind: 'action', token: north.token, id: 'change-card', revision: north.snapshot.revision,
      action: { kind: 'setBiddingSystem', biddingSystem: 'two-over-one' }, supportedAgreements: LAN_SUPPORTED_AGREEMENTS }))
      .toMatchObject({ ok: false, code: 'INVALID_ACTION' });
  });

  it('freezes the host card for all four seats, reconnects and the next board', () => {
    const options: RoomOptions = { biddingSystem: 'precision' };
    const table = setup(options);
    options.biddingSystem = 'two-over-one';
    table.start();
    const config = { biddingSystem: 'precision', agreementVersion: agreementVersionFor('precision') };
    for (const seat of SEATS) expect(table.poll(seat)).toMatchObject(config);
    const altered = table.poll('S');
    altered.biddingSystem = 'sayc';
    altered.agreementVersion = 'client-mutated';
    expect(table.poll('N')).toMatchObject(config);
    unwrap(table.ask('leave', 'E'));
    expect(unwrap(table.ask('resume', 'E')).snapshot).toMatchObject({ ...config, status: 'active', auction: [] });
    SEATS.forEach(seat => unwrap(table.act(seat, { kind: 'call', call: PASS })));
    expect(unwrap(table.act('N', { kind: 'nextBoard' })).snapshot).toMatchObject({ ...config, board: 2 });
  });

  it.each([
    ['strong 1C', ['S14', 'S12', 'S11', 'S2', 'H13', 'H12', 'H3', 'D14', 'D8', 'D4', 'D2', 'C7', 'C6'], 'C'],
    ['weak 1NT', ['S14', 'S12', 'S3', 'S2', 'H13', 'H11', 'H3', 'D13', 'D8', 'D4', 'D2', 'C7', 'C6'], 'NT'],
  ] as const)('applies a real Precision robot %s on the host heartbeat without requesting a natural neural model', (_label, ids, strain) => {
    const table = setup({ biddingSystem: 'precision' });
    table.join('E');
    unwrap(table.act('E', { kind: 'ready', ready: true }));
    const started = unwrap(table.act('E', { kind: 'startWithRobots' })).snapshot;
    expect(started).toMatchObject({ seats: { N: 'robot', E: 'connected', S: 'robot', W: 'robot' }, biddingSystem: 'precision' });
    const northIds = new Set<string>(ids);
    const north = deck().filter(card => northIds.has(card.id));
    const rest = deck().filter(card => !northIds.has(card.id));
    const hands: Hands = { N: north, E: rest.slice(0, 13), S: rest.slice(13, 26), W: rest.slice(26) };
    Object.assign(table.room, { game: newGameFromDeal(1, 'precision-host-bot', hands, 'N', 'None') });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Precision must stay offline'));
    try {
      const snapshot = table.poll('E');
      expect(snapshot.auction).toEqual([{ seat: 'N', call: { kind: 'bid', level: 1, strain } }]);
      expect(snapshot).toMatchObject({ biddingSystem: 'precision', agreementVersion: agreementVersionFor('precision'), turn: 'E' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(snapshot.hand.map(card => card.id)).toEqual(hands.E.map(card => card.id));
      expect(snapshot).not.toHaveProperty('hands');
      expect(snapshot).not.toHaveProperty('seed');
    } finally { fetchSpy.mockRestore(); }
  });

  it('reserves seats, retries join, and deals only when all four ready', () => {
    const table = setup();
    const nonce = createJoinNonce();
    const north = table.join('N', nonce);
    const retry = table.join('N', nonce);
    expect(retry.token).toBe(north.token);
    expect(retry.token).not.toBe(nonce);
    expect(retry.snapshot.revision).toBe(north.snapshot.revision);
    expect(table.room.request({ kind: 'join', roomCode: table.room.roomCode, seat: 'N', nonce: createJoinNonce(), supportedAgreements: LAN_SUPPORTED_AGREEMENTS }))
      .toMatchObject({ ok: false, code: 'SEAT_TAKEN' });
    expect(table.room.request({ kind: 'poll', token: nonce })).toEqual({ ok: false, code: 'INVALID_TOKEN', message: '座位凭证无效' });
    expect(table.act('N', { kind: 'call', call: PASS })).toMatchObject({ ok: false, code: 'ROOM_WAITING' });
    table.join('E');
    table.join('S');
    table.join('W');
    (['N', 'E', 'S'] as const).forEach(seat => unwrap(table.act(seat, { kind: 'ready', ready: true })));
    expect(table.poll('N')).toMatchObject({ status: 'waiting', hand: [], legalCalls: [] });
    expect(unwrap(table.ask('leave', 'W')).snapshot.seats.W).toBe('empty');
    expect(table.ask('poll', 'W')).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });
    table.join('W');
    unwrap(table.act('W', { kind: 'ready', ready: true }));
    const hands = SEATS.map(seat => table.poll(seat).hand);
    expect(hands.map(hand => hand.length)).toEqual([13, 13, 13, 13]);
    expect(new Set(hands.flat().map(card => card.id)).size).toBe(52);
    expect(table.poll('N')).not.toHaveProperty('seed');
    expect(table.poll('N')).not.toHaveProperty('initialHands');
    expect(table.poll('N')).not.toHaveProperty('hands');
    expect(table.poll('N')).not.toHaveProperty('customSetup');
  });

  it.each([1, 2, 3])('requires host approval to fill empty seats with %i human players', humanCount => {
    const table = setup();
    const humans = SEATS.slice(0, humanCount);
    const robots = SEATS.slice(humanCount);
    humans.forEach(seat => table.join(seat));
    const startWithRobots = { kind: 'startWithRobots' } as const;
    expect(table.act('N', startWithRobots)).toMatchObject({ ok: false, code: 'PLAYERS_NOT_READY' });
    humans.forEach(seat => unwrap(table.act(seat, { kind: 'ready', ready: true })));
    if (humanCount > 1) expect(table.act('E', startWithRobots)).toMatchObject({ ok: false, code: 'HOST_ONLY' });
    expect(table.poll('N')).toMatchObject({ status: 'waiting', hand: [] });

    const confirmed = table.command('N', startWithRobots);
    const result = unwrap(table.room.request(confirmed)).snapshot;
    expect(result.status).toBe('active');
    for (const seat of humans) expect(result.seats[seat]).toBe('connected');
    for (const seat of robots) expect(result.seats[seat]).toBe('robot');
    for (const seat of humans) expect(table.poll(seat).hand).toHaveLength(13);
    expect(unwrap(table.room.request(confirmed)).snapshot.revision).toBe(result.revision);
    expect(table.room.request({ kind: 'join', roomCode: table.room.roomCode, seat: robots[0], nonce: createJoinNonce(), supportedAgreements: LAN_SUPPORTED_AGREEMENTS }))
      .toMatchObject({ ok: false, code: 'ROOM_STARTED' });
  });

  it('rechecks the roster at confirmation and reserves disconnected human seats', () => {
    const table = setup();
    table.join('N');
    unwrap(table.act('N', { kind: 'ready', ready: true }));
    const action = { kind: 'startWithRobots' } as const;
    const confirmed = table.command('N', action);
    table.join('E');
    expect(table.room.request(confirmed)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    table.advance(60);
    table.poll('N');
    table.advance(40);
    expect(table.act('N', action)).toMatchObject({
      ok: false, code: 'PLAYERS_NOT_READY', snapshot: { status: 'waiting', seats: { E: 'disconnected' }, hand: [] },
    });
    unwrap(table.ask('resume', 'E'));
    table.join('S');
    table.join('W');
    expect(table.act('N', action)).toMatchObject({ ok: false, code: 'NO_EMPTY_SEATS' });
  });

  it('advances mixed-table robots on host heartbeats and pauses for disconnected humans', () => {
    const table = setup();
    table.join('N');
    table.join('E');
    (['N', 'E'] as const).forEach(seat => unwrap(table.act(seat, { kind: 'ready', ready: true })));
    unwrap(table.act('N', { kind: 'startWithRobots' }));
    unwrap(table.act('N', { kind: 'call', call: { kind: 'bid', level: 7, strain: 'NT' } }));
    unwrap(table.act('E', { kind: 'call', call: PASS }));
    expect(table.poll('E').auction).toHaveLength(2);

    table.advance(60);
    expect(table.poll('N').auction).toHaveLength(3);
    table.advance(40);
    expect(table.poll('N')).toMatchObject({ status: 'paused', turn: 'W', seats: { E: 'disconnected', S: 'robot', W: 'robot' } });
    expect(unwrap(table.ask('resume', 'E')).snapshot).toMatchObject({ status: 'active', turn: 'W' });
    expect(table.poll('N').auction).toHaveLength(4);
  });

  it.each(['two-over-one', 'precision'] as const)('plays a mixed %s board with private dummy control and retains the robot card on the next board', biddingSystem => {
    const table = setup({ biddingSystem });
    table.join('N');
    table.join('S');
    (['N', 'S'] as const).forEach(seat => unwrap(table.act(seat, { kind: 'ready', ready: true })));
    unwrap(table.act('N', { kind: 'startWithRobots' }));
    unwrap(table.act('N', { kind: 'call', call: { kind: 'bid', level: 7, strain: 'NT' } }));
    let snapshot = table.poll('N');
    let dummyTurns = 0;
    for (let step = 0; step < 70 && snapshot.phase !== 'complete'; step++) {
      if (snapshot.seats[snapshot.controller] !== 'robot') {
        const acting = snapshot.controller === 'N' ? snapshot : table.poll('S');
        if (acting.phase === 'auction') unwrap(table.act(acting.controller, { kind: 'call', call: PASS }));
        else {
          if (acting.turn === 'S') {
            expect(acting.controller).toBe('N');
            expect(table.poll('S').legalCardIds).toHaveLength(0);
            dummyTurns++;
          }
          unwrap(table.act(acting.controller, { kind: 'play', cardId: acting.legalCardIds[0] }));
        }
      }
      snapshot = table.poll('N');
    }
    expect(dummyTurns).toBe(13);
    expect(snapshot).toMatchObject({ phase: 'complete', canNextBoard: true, handCounts: { N: 0, E: 0, S: 0, W: 0 } });
    expect(snapshot.completedTricks).toHaveLength(13);
    expect(unwrap(table.act('N', { kind: 'nextBoard' })).snapshot).toMatchObject({
      board: 2, status: 'active', phase: 'auction', seats: { N: 'connected', E: 'robot', S: 'connected', W: 'robot' },
      biddingSystem, agreementVersion: agreementVersionFor(biddingSystem),
    });
    expect(table.poll('N').auction[0]?.seat).toBe('E');
  });

  it('rejects illegal and stale actions, deduplicates commits, and rolls over a passed-out board', () => {
    const table = setup();
    table.start();
    expect(table.act('E', { kind: 'call', call: PASS })).toMatchObject({ ok: false, code: 'NOT_CONTROLLER' });
    expect(table.act('N', { kind: 'call', call: { kind: 'double' } })).toMatchObject({ ok: false, code: 'INVALID_CALL' });
    const north = table.command('N', { kind: 'call', call: PASS });
    const east = table.command('E', { kind: 'call', call: PASS });
    unwrap(table.room.request(north));
    expect(table.room.request(east)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    unwrap(table.act('E', { kind: 'call', call: PASS }));
    expect(unwrap(table.room.request(north)).snapshot.auction).toHaveLength(2);
    expect(table.room.request({ ...north, action: { kind: 'nextBoard' } }))
      .toMatchObject({ ok: false, code: 'ACTION_ID_REUSED' });
    unwrap(table.act('S', { kind: 'call', call: PASS }));
    const ended = unwrap(table.act('W', { kind: 'call', call: PASS })).snapshot;
    expect(ended).toMatchObject({ phase: 'passedOut', result: { scoreNS: 0 }, canNextBoard: false });
    expect(table.act('W', { kind: 'nextBoard' })).toMatchObject({ ok: false, code: 'HOST_ONLY' });
    expect(table.poll('N').canNextBoard).toBe(true);
    expect(unwrap(table.act('N', { kind: 'nextBoard' })).snapshot)
      .toMatchObject({ board: 2, phase: 'auction', dealer: 'E', vulnerability: 'NS', auction: [], result: null });
  });

  it('reveals dummy on opening lead, assigns control to declarer, and scores all thirteen tricks', () => {
    const table = setup();
    table.start();
    unwrap(table.act('N', { kind: 'call', call: { kind: 'bid', level: 1, strain: 'NT' } }));
    (['E', 'S', 'W'] as const).forEach(seat => unwrap(table.act(seat, { kind: 'call', call: PASS })));
    const dummyHand = table.poll('S').hand;
    expect(table.poll('N').dummy).toBeNull();
    const east = table.poll('E');
    unwrap(table.act('E', { kind: 'play', cardId: east.legalCardIds[0] }));
    expect(table.poll('W')).toMatchObject({ dummy: { seat: 'S', hand: dummyHand }, controller: 'N', turn: 'S' });
    const north = table.poll('N');
    expect(north.legalCardIds.length).toBeGreaterThan(0);
    expect(table.act('S', { kind: 'play', cardId: north.legalCardIds[0] })).toMatchObject({ ok: false, code: 'NOT_CONTROLLER' });
    expect(table.act('N', { kind: 'play', cardId: north.hand[0].id })).toMatchObject({ ok: false, code: 'NO_CARD' });
    for (let played = 1; played < 52; played++) {
      const current = table.poll(table.poll('N').controller);
      unwrap(table.act(current.controller, { kind: 'play', cardId: current.legalCardIds[0] }));
    }
    const result = table.poll('W');
    expect(result.phase).toBe('complete');
    expect(result.completedTricks).toHaveLength(13);
    const { contract, vulnerability, tricksWon } = result;
    const tricks = tricksWon[sideOf(contract!.declarer)];
    expect(result.result).toMatchObject({ declarerTricks: tricks, scoreNS: scoreContract(contract!, tricks, isVulnerable(vulnerability, 'N')).total });
  });

  it('pauses on heartbeat expiry and preserves board state after authenticated rejoin', () => {
    const table = setup();
    table.start();
    unwrap(table.act('N', { kind: 'call', call: PASS }));
    table.advance(60);
    (['N', 'S', 'W'] as const).forEach(table.poll);
    table.advance(40);
    expect(table.poll('N')).toMatchObject({ status: 'paused', seats: { E: 'disconnected' }, legalCalls: [] });
    expect(table.ask('poll', 'E')).toMatchObject({ ok: false, code: 'DISCONNECTED' });
    expect(table.act('N', { kind: 'call', call: PASS })).toMatchObject({ ok: false, code: 'ROOM_PAUSED' });
    expect(unwrap(table.ask('resume', 'E')).snapshot).toMatchObject({
      status: 'active', seats: { E: 'connected' }, board: 1, turn: 'E', auction: [{ seat: 'N', call: PASS }],
    });
    expect(unwrap(table.ask('leave', 'W')).snapshot).toMatchObject({ status: 'paused', seats: { W: 'disconnected' } });
    expect(unwrap(table.ask('resume', 'W')).snapshot.status).toBe('active');
  });

  it('reclaims abandoned lobby guests while retaining the host seat', () => {
    const table = setup();
    table.join('N');
    const oldGuest = table.join('E');
    unwrap(table.act('E', { kind: 'ready', ready: true }));
    table.advance(60_000);
    const host = unwrap(table.ask('resume', 'N')).snapshot;
    expect(host).toMatchObject({ seats: { N: 'connected', E: 'empty' }, readiness: { E: false } });
    expect(table.room.request({ kind: 'resume', token: oldGuest.token })).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });
    expect(table.join('E').token).not.toBe(oldGuest.token);
  });
});
