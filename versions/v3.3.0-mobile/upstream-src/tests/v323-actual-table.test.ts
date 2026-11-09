import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { robotStep, robotStepWithAdvisor } from '../src/controller/robot';
import { chooseLanBid } from '../src/ai/lan-bidding';
import { getSLModelState, setLookaheadEnabled } from '../src/ai/neural/browser-model';
import { assertGameIntegrity, replay, toRecord } from '../src/core/game';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { describeCall } from '../src/ai/bidding';
import { emptySession, encodeSession } from '../src/persistence/session';
import { biddingFixtures, fixtureGame, parseCall } from './fixtures/v323-bidding';
import { LanRoom } from '../src/online/room';
import { LAN_SUPPORTED_AGREEMENTS } from '../src/online/protocol';

const records: unknown[] = [];
const sessions: unknown[] = [];
const advisor = { advise: vi.fn(async () => { throw Error('No play search in bidding verification'); }) };
beforeAll(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost/').pathname;
    return new Response(new Uint8Array(readFileSync(new URL('../public' + path, import.meta.url))));
  });
  setLookaheadEnabled(false);
});
afterAll(() => {
  mkdirSync('artifacts/v323-actual-table', { recursive: true });
  writeFileSync('artifacts/v323-actual-table/controller-calls.json', JSON.stringify(records, null, 2));
  writeFileSync('artifacts/v323-actual-table/production-sessions.json', JSON.stringify(sessions, null, 2));
  vi.unstubAllGlobals();
});

for (const row of biddingFixtures) {
  it(`${row.id}: desktop and LAN apply the expected call to the table`, async () => {
    const before = fixtureGame(row);
    const desktop = await robotStepWithAdvisor(before, row.system, 'basic', advisor, false);
    const lan = robotStep(before, { bid: observation => chooseLanBid(observation, row.system), play: () => { throw Error('No play'); } }, row.system);
    const room = new LanRoom({ biddingSystem: row.system });
    const joined = room.request({ kind: 'join', roomCode: room.roomCode, seat: 'S', nonce: 'a'.repeat(64), supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
    if (!joined.ok) throw Error('Fixture host join rejected');
    // Install only the frozen starting position; the real authority poll must
    // select and apply the robot action, including public snapshot projection.
    Object.assign(room, { game: before, started: true });
    const polled = room.request({ kind: 'poll', token: joined.token, supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
    if (!polled.ok) throw Error('Fixture host poll rejected');
    records.push({ id: row.id, route: 'LAN-room-poll', expected: parseCall(row.expected),
      actual: polled.snapshot.auction.at(-1)?.call, snapshot: polled.snapshot });
    expect(polled.snapshot.auction.length).toBe(before.auction.length + 1);
    expect(polled.snapshot.auction.at(-1)?.call).toEqual(parseCall(row.expected));
    expect(polled.snapshot.seats[before.turn]).toBe('robot');
    room.dispose();
    sessions.push({ id: row.id, expected: row.expected, system: row.system, turn: before.turn,
      raw: encodeSession({ ...emptySession(), game: before, biddingSystem: row.system, gameSystem: row.system, delay: 1100, playStrength: 'basic' }) });
    for (const [route, result] of [['desktop', desktop], ['LAN', lan]] as const) {
      const action = result.game.actions.at(-1)!;
      const entry = result.game.auction.at(-1)!;
      const meaning = publicCallMeaningAt(result.game.auction, result.game.auction.length - 1, row.system);
      records.push({ id: row.id, route, expected: parseCall(row.expected), actual: entry.call,
        seat: entry.seat, action, warning: result.warning, meaning,
        description: describeCall(before.auction, before.turn, entry.call, row.system),
        ...(route === 'desktop' ? { model: getSLModelState().lastBid } : {}), record: toRecord(result.game) });
      assertGameIntegrity(result.game);
      expect(result.warning).toBeNull();
      expect(action.kind).toBe('call');
      expect(entry.seat).toBe(before.turn);
      expect(result.game.actions.length).toBe(before.actions.length + 1);
      expect(replay(toRecord(result.game)).auction).toEqual(result.game.auction);
      expect(entry.call).toEqual(parseCall(row.expected));
      expect(meaning.defined).toBe(true);
    }
    expect(advisor.advise).not.toHaveBeenCalled();
  });
}
