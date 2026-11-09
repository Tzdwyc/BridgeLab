import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bidding from '../src/ai/bidding';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { assessCandidates } from '../src/ai/constrained-sl';
import { analyzeAuctionSemantics, publicPendingResponse } from '../src/ai/bidding-semantics';
import { suggestSLBid, type SLBidTrace } from '../src/ai/neural/browser-model';
import { legalCalls, sameCall } from '../src/core/auction';
import type { BiddingObservation } from '../src/ai/observation';
import type { AuctionEntry, Call, Seat, Strain } from '../src/core/types';

vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
type System = 'sayc' | 'two-over-one';
interface Row { id: string; system: System; actual: Call; frozenObservation: BiddingObservation; trace: SLBidTrace }
const evidence = JSON.parse(readFileSync('artifacts/v327-two-fixes-20261108/actual-table-001.json', 'utf8')) as { rows: Row[] };
const saved = (id: string, system: System) => evidence.rows.find(row => row.id === id && row.system === system)!;
const pass: Call = { kind: 'pass' };
const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function context(prefix: string, original: BiddingObservation): BiddingObservation {
  const tokens = prefix.split(' '), seat = seats[tokens.length % 4];
  const auction: AuctionEntry[] = tokens.map((token, i) => ({ seat: seats[i % 4], call: token === 'P' ? pass : bid(Number(token[0]), token.slice(1) as Strain) }));
  return { ...original, seat, actingSeat: seat, auction, legalCalls: legalCalls(auction, seat) };
}
const assessed = (obs: BiddingObservation, system: System, selected: Call) => assessCandidates(obs, system).find(item => sameCall(item.call, selected))!;
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe.each(['sayc', 'two-over-one'] as const)('v3.2.8 pending public cue execution in %s', system => {
  it('replaces the saved illegal Pass by the qualified existing 2H response', () => {
    const row = saved('enemy-natural-diamonds-not-our-second-suit', system), obs = row.frozenObservation;
    expect(row.actual).toEqual(pass);
    expect(publicPendingResponse(obs.auction, obs.seat, system)?.kind).toBe('cue-response');
    expect(bidding.chooseBid(obs, system)).toEqual(bid(2, 'H'));
    expect(assessed(obs, system, bid(2, 'H')).allowed).toBe(true);
    expect(enforceBiddingConsistency(obs, pass, system)).toEqual({ call: bid(2, 'H'), family: 'pending-cue-answer', source: 'existing-rule',
      rejectedReasons: ['pending-cue-response', 'unfulfilled-forcing-obligation'], ruleRejectedReasons: [] });
  });
  it('refuses an existing-rule substitute that still fails the public obligation', () => {
    const row = saved('enemy-natural-diamonds-not-our-second-suit', system);
    vi.spyOn(bidding, 'chooseBid').mockReturnValue(pass);
    const result = enforceBiddingConsistency(row.frozenObservation, pass, system);
    expect(result).toMatchObject({ call: pass, family: 'pending-cue-answer', source: 'unresolved' });
    expect(result?.ruleRejectedReasons).toContain('unfulfilled-forcing-obligation');
  });
  it('also completes the pending cue when a legal double fails the natural-answer obligation', () => {
    const row = saved('enemy-natural-diamonds-not-our-second-suit', system);
    const selected: Call = { kind: 'double' };
    expect(assessed(row.frozenObservation, system, selected).reasons).toContain('pending-cue-response');
    expect(enforceBiddingConsistency(row.frozenObservation, selected, system)).toMatchObject({
      call: bid(2, 'H'), family: 'pending-cue-answer', source: 'existing-rule', ruleRejectedReasons: [],
    });
  });
  it.each(['D', 'H'] as const)('keeps a qualified natural 2%s answer without consulting another rule choice', strain => {
    const obs = saved('support-cue-after-X-not-michaels', system).frozenObservation;
    const selected = bid(2, strain);
    expect(assessed(obs, system, selected).allowed).toBe(true);
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, selected, system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });
  it('uses the existing default-profile gate and preserves original SL output', async () => {
    const row = saved('enemy-natural-diamonds-not-our-second-suit', system);
    vi.mocked(suggestSLBid).mockResolvedValue({ call: pass, trace: row.trace });
    const repaired = await suggestSystemBid(row.frozenObservation, { system, allowLookahead: false });
    expect(repaired.call).toEqual(bid(2, 'H'));
    expect(repaired.trace).toMatchObject({ profileId: row.trace.profileId, loadedWeightsSHA256: row.trace.loadedWeightsSHA256,
      rawTopAction: row.trace.rawTopAction, route: 'agreement-flow', reason: 'consistency:pending-cue-answer' });
    vi.mocked(suggestSLBid).mockResolvedValue({ call: pass, trace: { ...row.trace, profileId: 'original-sl' } });
    const original = await suggestSystemBid(row.frozenObservation, { system, allowLookahead: false });
    expect(original.call).toEqual(pass);
    expect(original.trace?.route).toBe('sl-legal');
  });
  it('leaves an F1 released by an enemy natural game outside this repair', () => {
    const row = saved('enemy-natural-diamonds-not-our-second-suit', system);
    const obs = context('1C 1H P 2C 5C', row.frozenObservation);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, system).mustBid).toBe(false);
    expect(publicPendingResponse(obs.auction, obs.seat, system)).toBeUndefined();
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, pass, system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });
  it('keeps independent game forcing even after an opposing game', () => {
    const row = saved('existing-strong-GF-cannot-pass', system);
    const obs = context('2C P 2D P 3D P 3S 4H', row.frozenObservation);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, system)).toMatchObject({ forcing: 'game', mustBid: true });
    expect(assessed(obs, system, pass).reasons).toContain('unfulfilled-forcing-obligation');
    expect(enforceBiddingConsistency(obs, pass, system)?.source).not.toBe('existing-rule');
  });
  it('allows a completed nonforcing cue answer to stop without reopening the question', () => {
    const row = saved('enemy-natural-diamonds-not-our-second-suit', system);
    const obs = context('1C 1H P 2C P 2D P', row.frozenObservation);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, system).mustBid).toBe(false);
    expect(publicPendingResponse(obs.auction, obs.seat, system)).toBeUndefined();
    expect(assessed(obs, system, pass).allowed).toBe(true);
    expect(enforceBiddingConsistency(obs, pass, system)).toBeUndefined();
  });
});

