import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LanRoom, type RoomOptions } from '../src/online/room';
import { createJoinNonce, LAN_SUPPORTED_AGREEMENTS, type RoomAction, type RoomResponse } from '../src/online/protocol';
import { controllerFor, playCard } from '../src/core/game';
import { type GameState, type Seat, SEATS } from '../src/core/types';
import { observe, type PlayObservation } from '../src/ai/observation';
import { chooseCard } from '../src/ai/playing';
import { advisePlay } from '../src/ai/play-advisor-core';
import { type PlayAdviceRequest, type PlayDecision } from '../src/ai/play-advisor-types';
import { DdsEngine } from '../src/analysis/engine';
import { LAN_FUNCTIONAL_CASES, functionalGame } from './fixtures/v331-lan-functional';

function ok(response: RoomResponse) { if (!response.ok) throw new Error(`${response.code}: ${response.message}`); return response; }
function internal(room: LanRoom) { return room as unknown as { game: GameState; revision: number; pendingRobot?: unknown }; }
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function setup(item = LAN_FUNCTIONAL_CASES[0], advisor?: RoomOptions['advisor']) {
  let clock = 0, serial = 0;
  const room = new LanRoom({ advisor, now: () => clock, timeoutMs: 100, biddingSystem: 'two-over-one' });
  const tokens = new Map<Seat, string>();
  const host = item.humans[0];
  const request = (payload: object) => room.request({ ...payload, supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
  for (const seat of item.humans) tokens.set(seat, ok(request({ kind: 'join', roomCode: room.roomCode, seat, nonce: createJoinNonce() })).token!);
  const poll = (seat = host) => ok(request({ kind: 'poll', token: tokens.get(seat) })).snapshot;
  const command = (seat: Seat, action: RoomAction) => ({ kind: 'action', token: tokens.get(seat), id: `a${serial++}`, revision: internal(room).revision, action });
  const act = (seat: Seat, action: RoomAction) => request(command(seat, action));
  for (const seat of item.humans) ok(act(seat, { kind: 'ready', ready: true }));
  ok(act(host, { kind: 'startWithRobots' }));
  internal(room).game = functionalGame(item);
  return { room, host, item, poll, request, act, command, tokens,
    time: (value: number) => { clock = value; },
    resume: (seat: Seat) => ok(request({ kind: 'resume', token: tokens.get(seat) })).snapshot };
}
function decision(request: PlayAdviceRequest, partial = false): PlayDecision {
  const cardId = chooseCard(request.observation, request.system);
  return { cardId, candidates: request.observation.legalCards.map(card => ({ cardId: card.id, support: 1,
    expectedDeclarerTricks: 7, makeRate: 1, worstDeclarerTricks: 7, bestDeclarerTricks: 7 })),
    sampleCount: 1, attemptedSamples: 1, elapsedMs: 1, engine: 'sampled-dds', fallback: partial,
    publicKey: 'functional-public', reasonTags: [partial ? 'completed-batch-timeout' : 'functional'],
    diagnostics: { status: 'partial', requestedSamples: 8, completedSamples: 1 } };
}
function controlled() {
  const calls: { request: PlayAdviceRequest; resolve: (value: PlayDecision) => void; reject: (error: Error) => void }[] = [];
  const advisor = { advise: vi.fn((request: PlayAdviceRequest) => new Promise<PlayDecision>((resolve, reject) => calls.push({ request, resolve, reject }))), cancel: vi.fn() };
  return { calls, advisor };
}
function advanceToRobot(table: ReturnType<typeof setup>) {
  for (let n = 0; n < 4 && table.item.humans.includes(controllerFor(internal(table.room).game)); n++) {
    const controller = controllerFor(internal(table.room).game);
    ok(table.act(controller, { kind: 'play', cardId: table.poll(controller).legalCardIds[0] }));
  }
}

test('one asynchronous host slot sends only public observations and commits one revision after completion', async () => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[0], task.advisor);
  const start = internal(table.room).game.actions.length, revision = internal(table.room).revision;
  for (let n = 0; n < 10; n++) table.poll();
  expect(internal(table.room).revision).toBe(revision);
  await settle();
  expect(task.calls).toHaveLength(1);
  const request = task.calls[0].request;
  expect(Object.keys(request).sort()).toEqual(['observation', 'strength', 'system']);
  expect(request).toMatchObject({ strength: 'challenge', system: 'two-over-one' });
  for (const key of ['seed', 'hands', 'initialHands', 'customSetup']) expect(request.observation).not.toHaveProperty(key);
  task.calls[0].resolve(decision(request));
  await settle();
  expect(internal(table.room).game.actions).toHaveLength(start + 1);
  expect(internal(table.room).revision).toBe(revision + 1);
  expect(task.calls).toHaveLength(1);
  table.room.dispose();
});

test('disconnect cancels the old epoch and its late finally cannot release a replacement task', async () => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[4], task.advisor);
  advanceToRobot(table);
  table.poll(); await settle();
  const start = internal(table.room).game.actions.length;
  ok(table.request({ kind: 'leave', token: table.tokens.get('E') }));
  expect(task.advisor.cancel).toHaveBeenCalledTimes(1);
  expect(table.poll().status).toBe('paused');
  table.resume('E'); table.poll(); await settle();
  expect(task.calls).toHaveLength(2);
  task.calls[0].resolve(decision(task.calls[0].request)); await settle();
  expect(internal(table.room).game.actions).toHaveLength(start);
  for (let n = 0; n < 5; n++) table.poll();
  await settle(); expect(task.calls).toHaveLength(2);
  task.calls[1].resolve(decision(task.calls[1].request)); await settle();
  expect(internal(table.room).game.actions).toHaveLength(start + 1);
  table.room.dispose();
});

test('completion detects heartbeat expiry without a poll and never falls back while paused', async () => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[4], task.advisor);
  advanceToRobot(table);
  table.poll(); await settle();
  const start = internal(table.room).game.actions.length;
  table.time(101);
  task.calls[0].reject(new Error('late failure')); await settle();
  expect(internal(table.room).game.actions).toHaveLength(start);
  expect(task.advisor.cancel).toHaveBeenCalledTimes(1);
  for (const seat of table.item.humans) table.resume(seat);
  table.poll(); await settle(); expect(task.calls).toHaveLength(2);
  table.room.dispose();
});

test('illegal result and genuine advisor failure each use one legal safety card on the current position', async () => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[0], task.advisor);
  for (const mode of ['illegal', 'failure']) {
    const before = internal(table.room).game;
    const expected = chooseCard(observe(before) as PlayObservation, 'two-over-one');
    table.poll(); await settle();
    const call = task.calls.at(-1)!;
    if (mode === 'illegal') call.resolve({ ...decision(call.request), cardId: 'invalid' });
    else call.reject(new Error('no completed batch'));
    await settle();
    expect(internal(table.room).game.actions).toHaveLength(before.actions.length + 1);
    expect(internal(table.room).game.actions.at(-1)).toMatchObject({ kind: 'play', cardId: expected });
  }
  table.room.dispose();
});

test('dispose blocks all future requests and old replies cannot affect a newly created room', async () => {
  const old = controlled(), table = setup(LAN_FUNCTIONAL_CASES[5], old.advisor);
  table.poll(); await settle(); const before = internal(table.room).game;
  table.room.dispose(); table.room.dispose();
  expect(old.advisor.cancel).toHaveBeenCalledTimes(1);
  expect(table.request({ kind: 'poll', token: table.tokens.get(table.host) })).toMatchObject({ ok: false, code: 'ROOM_CLOSED' });
  const fresh = controlled(), replacement = setup(LAN_FUNCTIONAL_CASES[5], fresh.advisor);
  replacement.poll(); await settle();
  old.calls[0].resolve(decision(old.calls[0].request)); await settle();
  expect(internal(table.room).game).toBe(before);
  expect(fresh.calls).toHaveLength(1);
  const next = internal(replacement.room).game;
  fresh.calls[0].resolve(decision(fresh.calls[0].request)); await settle();
  expect(internal(replacement.room).game.actions).toHaveLength(next.actions.length + 1);
  replacement.room.dispose();
});

test.each(['reference', 'revision'] as const)('stale %s results are discarded without safety fallback', async field => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[0], task.advisor);
  table.poll(); await settle();
  const before = internal(table.room).game;
  if (field === 'reference') internal(table.room).game = structuredClone(before);
  else internal(table.room).revision++;
  task.calls[0].reject(new Error('stale')); await settle();
  expect(internal(table.room).game.actions).toHaveLength(before.actions.length);
  table.room.dispose();
});

test('a physical robot dummy controlled by a seated human never starts advisor work', async () => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[3], task.advisor);
  const game = internal(table.room).game;
  internal(table.room).game = playCard(game, game.turn, chooseCard(observe(game) as PlayObservation));
  expect(internal(table.room).game.turn).toBe('S');
  expect(controllerFor(internal(table.room).game)).toBe('N');
  for (let n = 0; n < 5; n++) table.poll();
  await settle(); expect(task.calls).toHaveLength(0);
  table.room.dispose();
});

test('nextBoard invalidates an outstanding old-board task before replacing authority', async () => {
  const task = controlled(), table = setup(LAN_FUNCTIONAL_CASES[7], task.advisor);
  table.poll(); await settle();
  expect(task.calls).toHaveLength(1);
  // Reuse the same fixed hand to construct the finished authority, without another deal.
  let finished = internal(table.room).game;
  while (finished.phase === 'play') finished = playCard(finished, finished.turn, chooseCard(observe(finished) as PlayObservation));
  internal(table.room).game = finished;
  ok(table.act(table.host, { kind: 'nextBoard' }));
  expect(task.advisor.cancel).toHaveBeenCalledTimes(1);
  const next = internal(table.room).game;
  task.calls[0].resolve(decision(task.calls[0].request)); await settle();
  expect(internal(table.room).game).toBe(next);
  expect(next.phase).toBe('auction');
  expect(next.actions).toHaveLength(0);
  table.room.dispose();
});

let engine: DdsEngine;
const evidence: unknown[] = [];
beforeAll(async () => { engine = await DdsEngine.create(); }, 30000);
afterAll(() => {
  if (!evidence.length) return;
  mkdirSync('artifacts/v331-play/lan-integration', { recursive: true });
  writeFileSync('artifacts/v331-play/lan-integration/eight-hands-node-results.json', JSON.stringify({
    layer: 'Node authoritative room + actual frozen advisor core/local DDS; no browser Worker, relay or physical mobile device',
    fixedNewFunctionalHands: 8, policyStrengthClaim: false, cases: evidence
  }, null, 2) + '\n');
});

for (const item of LAN_FUNCTIONAL_CASES) test(`fixed LAN functional hand ${item.id} completes all 52 legal cards with actual frozen DDS advice`, async () => {
  let inflight = 0, maxInflight = 0, calls = 0, partials = 0, failures = 0;
  let partialCard: string | undefined;
  const requests: PlayAdviceRequest[] = [];
  const advisor = { cancel: vi.fn(), advise: vi.fn(async (request: PlayAdviceRequest) => {
    calls++; requests.push(structuredClone(request)); inflight++; maxInflight = Math.max(maxInflight, inflight);
    try {
      if (item.id === 7 && calls === 1) {
        partials++;
        const result = decision(request, true);
        result.cardId = request.observation.legalCards.find(card => card.id !== result.cardId)?.id ?? result.cardId;
        partialCard = result.cardId;
        return result;
      }
      if (item.id === 7 && calls === 2) { failures++; throw new Error('functional no-batch failure'); }
      return await advisePlay(request, engine);
    } finally { inflight--; }
  }) };
  const table = setup(item, advisor);
  let dummyHumanTurns = 0, dummyRobotTurns = 0;
  for (let turn = 0; turn < 52; turn++) {
    const before = internal(table.room).game;
    const controller = controllerFor(before);
    if (item.humans.includes(controller)) {
      const view = table.poll(controller);
      if (before.turn === before.contract!.dummy) dummyHumanTurns++;
      const response = ok(table.act(controller, { kind: 'play', cardId: view.legalCardIds[0] }));
      expect(response.snapshot.revision).toBe(internal(table.room).revision);
    } else {
      if (before.turn === before.contract!.dummy) dummyRobotTurns++;
      const count = calls;
      for (let repeat = 0; repeat < 4; repeat++) table.poll();
      await settle();
      expect(calls).toBe(count + 1);
      if (item.id === 7 && count === 0) expect(internal(table.room).game.actions.at(-1)).toMatchObject({ cardId: partialCard });
      if (item.id === 7 && count === 1) expect(internal(table.room).game.actions.at(-1)).toMatchObject({
        cardId: chooseCard(observe(before) as PlayObservation, 'two-over-one') });
    }
    const after = internal(table.room).game;
    expect(after.actions).toHaveLength(before.actions.length + 1);
    // Each recipient gets only its own remaining hand, plus a publicly revealed dummy.
    for (const seat of item.humans) {
      const view = table.poll(seat);
      expect(view).not.toHaveProperty('hands'); expect(view).not.toHaveProperty('seed');
      expect(view).not.toHaveProperty('initialHands');
      expect(view.hand).toEqual(internal(table.room).game.hands[view.seat]);
    }
  }
  const game = internal(table.room).game;
  expect(game.phase).toBe('complete'); expect(game.completedTricks).toHaveLength(13);
  expect(game.actions.filter(action => action.kind === 'play')).toHaveLength(52);
  expect(maxInflight).toBeLessThanOrEqual(1);
  for (const request of requests) {
    expect(request).toMatchObject({ strength: 'challenge', system: 'two-over-one' });
    for (const key of ['seed', 'hands', 'initialHands', 'customSetup']) expect(request.observation).not.toHaveProperty(key);
  }
  if (item.id === 3) expect(dummyRobotTurns).toBe(13);
  if (item.id === 4) { expect(dummyHumanTurns).toBe(13); expect(calls).toBe(0); }
  if (item.id === 8) {
    const stale = table.command(table.host, { kind: 'nextBoard' });
    stale.revision--;
    expect(table.request(stale)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    const next = table.command(table.host, { kind: 'nextBoard' });
    const response = ok(table.request(next));
    expect(response.snapshot.board).toBe(item.id + 1);
    expect(ok(table.request(next)).snapshot.revision).toBe(response.snapshot.revision);
  }
  evidence.push({ id: item.id, seed: item.seed, humans: item.humans, contract: game.contract,
    vulnerability: game.vulnerability, playActions: 52, completedTricks: 13, advisorCalls: calls,
    maxInflight, dummyHumanTurns, dummyRobotTurns, partialBatchesInjected: partials,
    noBatchFailuresInjected: failures, illegalActions: 0, finalRevision: internal(table.room).revision });
  table.room.dispose();
}, 60000);
