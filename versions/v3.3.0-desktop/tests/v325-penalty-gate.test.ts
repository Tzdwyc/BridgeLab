import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyCall, assertGameIntegrity, newGameFromDeal } from '../src/core/game';
import { PASS, type Call, type Strain, type Suit } from '../src/core/types';
import { observe } from '../src/ai/observation';
import { adjustPenaltyDouble } from '../src/ai/penalty-doubles';
import { assessCompetitivePenaltyDouble } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { getSLModelState, setSLProfile, setLookaheadEnabled } from '../src/ai/neural/browser-model';
import { migrationReady, useGame } from '../src/controller/store';
import { emptySession } from '../src/persistence/session';
import { LanRoom } from '../src/online/room';
import { LAN_SUPPORTED_AGREEMENTS } from '../src/online/protocol';

// Reuse exactly the historical complete deals, not newly constructed mothers.
const existing = readFileSync('tests/penalty-doubles.test.ts', 'utf8');
const text = (name: string) => {
  const value = existing.match(new RegExp(`const ${name} = '([^']+)';`))?.[1];
  if (!value) throw Error('Missing existing fixture: ' + name);
  return value;
};
const cards = (holding: string) => holding.split('.').flatMap((ranks, index) => [...ranks].map(symbol => {
  const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
  return { suit, rank, id: `${suit}${rank}` };
}));
const call = (token: string): Call => token === 'P' ? PASS
  : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
function position(fixture: string, prefix = '1D 1S 2D 3NT') {
  const [N, E, S, W] = text(fixture).split(' ').map(cards);
  let game = newGameFromDeal(1, 'high-level-penalty', { N, E, S, W }, 'N', 'EW');
  for (const token of prefix.split(' ')) game = applyCall(game, game.turn, call(token));
  return game;
}
const records: unknown[] = [];
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost/').pathname;
    return new Response(new Uint8Array(readFileSync('public' + path)));
  });
  await migrationReady;
  await setSLProfile('seed101-epoch08'); setLookaheadEnabled(false);
});
afterAll(async () => {
  useGame.getState().setPaused(true);
  await setSLProfile('seed101-epoch08');
  mkdirSync('artifacts/v325-consistency-20261108', { recursive: true });
  writeFileSync('artifacts/v325-consistency-20261108/penalty-gate-live-regression.json', JSON.stringify({
    scope: 'Existing strong/thin 3NT and 6S complete deals only. Eight default-SL store actions, one original-SL action and eight LAN poll actions. No play, training or DDS.', records,
  }, null, 2));
  vi.unstubAllGlobals();
});

describe('v325 shares the existing high-contract defensive veto without lowering its gate', () => {
  it.each(['sayc', 'two-over-one'] as const)('vetoes the established thin 3NT double and retains sufficient defense in %s', system => {
    const thin = observe(position('thinNtDefense')), strong = observe(position('strongNtDefense'));
    if (thin.phase !== 'auction' || strong.phase !== 'auction') throw Error('Expected bidding');
    expect(assessCompetitivePenaltyDouble(thin, system, { highOnly: true })).toBe(false);
    expect(assessCompetitivePenaltyDouble(strong, system, { highOnly: true })).toBe(true);
    expect(adjustPenaltyDouble(thin, { kind: 'double' }, system)).toEqual({ call: call('5D'), reason: 'avoid-penalty-double' });
    expect(adjustPenaltyDouble(strong, { kind: 'double' }, system)).toBeUndefined();
    const major = observe(position('adequateDefense', '1H 1S 4H 4S'));
    if (major.phase !== 'auction') throw Error('Expected bidding');
    expect(adjustPenaltyDouble(major, PASS, system)).toMatchObject({ call: { kind: 'double' } });
    expect(adjustPenaltyDouble(major, call('5H'), system)).toBeUndefined();
  });

  for (const fixture of ['thinNtDefense', 'strongNtDefense']) for (const system of ['sayc', 'two-over-one'] as const) {
    it(`${fixture} ${system}: applies the decision to actual store state and LAN snapshot`, async () => {
      await setSLProfile('seed101-epoch08');
      const game = position(fixture);
      useGame.getState().setPaused(true);
      useGame.setState({ ...emptySession(), game, activeMatch: null, gameSystem: system, biddingSystem: system,
        paused: false, thinking: false, pendingRobotClaim: null, playStrength: 'basic', notice: null });
      await useGame.getState().stepAI();
      const after = useGame.getState().game!;
      expect(after.auction.length).toBe(game.auction.length + 1);
      assertGameIntegrity(after);
      const expected = fixture === 'thinNtDefense' ? call('5D') : { kind: 'double' };
      expect(after.auction.at(-1)?.call).toEqual(expected);
      const trace = getSLModelState().lastBid;
      expect(trace).toMatchObject({ baselineCall: { kind: 'double' },
        route: fixture === 'thinNtDefense' ? 'penalty-double' : 'sl-legal' });
      const room = new LanRoom({ biddingSystem: system });
      const joined = room.request({ kind: 'join', roomCode: room.roomCode, seat: 'S', nonce: 'a'.repeat(64), supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
      if (!joined.ok) throw Error('Join failed');
      Object.assign(room, { game, started: true });
      const poll = room.request({ kind: 'poll', token: joined.token, supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
      if (!poll.ok) throw Error('Poll failed');
      expect(poll.snapshot.auction.length).toBe(game.auction.length + 1);
      const obs = observe(game);
      if (obs.phase !== 'auction') throw Error('Expected bidding');
      expect(poll.snapshot.auction.at(-1)?.call).toEqual(chooseBid(obs, system));
      records.push({ fixture, system, store: after.auction.at(-1), action: after.actions.at(-1), trace,
        lan: poll.snapshot.auction.at(-1) });
      room.dispose();
    });
  }

  for (const fixture of ['twoTopTrumps', 'slamWithoutDefense']) for (const system of ['sayc', 'two-over-one'] as const) {
    it(`${fixture} ${system}: applies the small-slam defense gate to store and LAN`, async () => {
      await setSLProfile('seed101-epoch08');
      const game = position(fixture, '1H 1S 4H 6S');
      const expected: Call = fixture === 'twoTopTrumps' ? { kind: 'double' } : PASS;
      const obs = observe(game);
      if (obs.phase !== 'auction') throw Error('Expected bidding');
      expect(assessCompetitivePenaltyDouble(obs, system, { highOnly: true })).toBe(fixture === 'twoTopTrumps');
      useGame.getState().setPaused(true);
      useGame.setState({ ...emptySession(), game, activeMatch: null, gameSystem: system, biddingSystem: system,
        paused: false, thinking: false, pendingRobotClaim: null, playStrength: 'basic', notice: null });
      await useGame.getState().stepAI();
      const after = useGame.getState().game!;
      expect(after.auction.length).toBe(game.auction.length + 1);
      assertGameIntegrity(after);
      expect(after.auction.at(-1)?.call).toEqual(expected);
      const trace = getSLModelState().lastBid;
      const room = new LanRoom({ biddingSystem: system });
      const joined = room.request({ kind: 'join', roomCode: room.roomCode, seat: 'S', nonce: 'b'.repeat(64), supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
      if (!joined.ok) throw Error('Join failed');
      Object.assign(room, { game, started: true });
      const poll = room.request({ kind: 'poll', token: joined.token, supportedAgreements: LAN_SUPPORTED_AGREEMENTS });
      if (!poll.ok) throw Error('Poll failed');
      expect(poll.snapshot.auction.length).toBe(game.auction.length + 1);
      expect(poll.snapshot.auction.at(-1)?.call).toEqual(expected);
      records.push({ fixture, system, store: after.auction.at(-1), action: after.actions.at(-1), trace,
        lan: poll.snapshot.auction.at(-1) });
      room.dispose();
    });
  }

  it('keeps the original SL profile outside the new veto at the actual store entry', async () => {
    await setSLProfile('original-sl');
    const game = position('thinNtDefense');
    useGame.getState().setPaused(true);
    useGame.setState({ ...emptySession(), game, activeMatch: null, gameSystem: 'sayc', biddingSystem: 'sayc',
      paused: false, thinking: false, pendingRobotClaim: null, playStrength: 'basic', notice: null });
    await useGame.getState().stepAI();
    const after = useGame.getState().game!, trace = getSLModelState().lastBid;
    expect(trace?.profileId).toBe('original-sl');
    expect(after.auction.at(-1)?.call).toEqual(trace?.baselineCall);
    expect(trace?.route).toBe('sl-legal');
    records.push({ profile: 'original-sl', fixture: 'thinNtDefense', store: after.auction.at(-1), trace });
  });
});
