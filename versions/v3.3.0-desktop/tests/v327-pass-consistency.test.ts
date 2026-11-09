import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bidding from '../src/ai/bidding';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { assessCandidates } from '../src/ai/constrained-sl';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { suggestSLBid, type SLBidTrace } from '../src/ai/neural/browser-model';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { legalCalls, sameCall } from '../src/core/auction';
import type { BiddingObservation } from '../src/ai/observation';
import type { AuctionEntry, Call, Card, Seat, Strain, Suit } from '../src/core/types';

vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
type System = 'sayc' | 'two-over-one';
interface SavedRow {
  id: string; group: string; system: System; frozenObservation: BiddingObservation;
  actual: Call; qualification: { allowed: boolean; reasons: string[] }; trace: SLBidTrace;
}
// The archived observations are inputs only; this suite never rewrites evidence.
const saved = JSON.parse(readFileSync('artifacts/v326-three-flows-20261108/actual-table-002.json', 'utf8')) as { rows: SavedRow[] };
const boundaries = saved.rows.filter(row => row.id === 'passed-hand-natural-new-suit-not-F1');
const cueBoundaries = saved.rows.filter(row => row.id === 'support-cue-after-X-not-michaels');
const targets = saved.rows.filter(row => row.group === 'five-frozen-targets');
const pass: Call = { kind: 'pass' };
const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function position(prefix: string, holding: string): BiddingObservation {
  const auction: AuctionEntry[] = prefix.split(' ').map((token, i) => ({ seat: seats[i % 4],
    call: token === 'P' ? pass : bid(Number(token[0]), token.slice(1) as Strain) }));
  const seat = seats[auction.length % 4];
  const hand: Card[] = holding.split('.').flatMap((cards, i) => [...cards].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat, hand, auction, legalCalls: legalCalls(auction, seat) };
}
const assessment = (obs: BiddingObservation, system: System, call: Call) => assessCandidates(obs, system).find(item => sameCall(item.call, call))!;
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('v3.2.7 qualification permits an existing nonforcing Pass replacement', () => {
  it.each(boundaries)('replaces the archived $system short 2S with its qualified existing Pass', row => {
    expect(boundaries).toHaveLength(2);
    expect(row.qualification).toMatchObject({ allowed: false, reasons: ['natural-suit-minimum'] });
    expect(analyzeAuctionSemantics(row.frozenObservation.auction, row.frozenObservation.seat, row.system).mustBid).toBe(false);
    expect(bidding.chooseBid(row.frozenObservation, row.system)).toEqual(pass);
    expect(assessment(row.frozenObservation, row.system, pass).allowed).toBe(true);
    expect(enforceBiddingConsistency(row.frozenObservation, row.actual, row.system)).toEqual({
      call: pass, family: 'natural-second-suit-length', source: 'existing-rule',
      rejectedReasons: ['natural-suit-minimum'], ruleRejectedReasons: [],
    });
  });
  it.each(cueBoundaries)('retains the archived $system independent cue boundary as separate evidence', row => {
    expect(cueBoundaries).toHaveLength(2);
    expect(row.qualification.allowed).toBe(false);
    expect(row.qualification.reasons).toContain('pending-cue-response');
    const result = enforceBiddingConsistency(row.frozenObservation, row.actual, row.system);
    expect(result?.source === 'existing-rule' && result.call.kind === 'pass').toBe(false);
    expect(assessment(row.frozenObservation, row.system, pass).allowed).toBe(false);
  });
  it.each(targets)('preserves original approved target $id / $system', row => {
    expect(targets).toHaveLength(10);
    const actual = bidding.chooseBid(row.frozenObservation, row.system);
    expect(actual).toEqual(row.actual);
    expect(assessment(row.frozenObservation, row.system, actual).allowed).toBe(true);
  });
  it.each(boundaries)('applies only through the existing default-profile entry in $system', async row => {
    vi.mocked(suggestSLBid).mockResolvedValue({ call: row.actual, trace: row.trace });
    const repaired = await suggestSystemBid(row.frozenObservation, { system: row.system, allowLookahead: false });
    expect(repaired.call).toEqual(pass);
    expect(repaired.trace?.reason).toBe('consistency:natural-second-suit-length');
    vi.mocked(suggestSLBid).mockResolvedValue({ call: row.actual, trace: { ...row.trace, profileId: 'original-sl' } });
    const original = await suggestSystemBid(row.frozenObservation, { system: row.system, allowLookahead: false });
    expect(original.call).toEqual(row.actual);
    expect(original.trace?.route).toBe(row.trace.route);
  });
  it.each(['sayc', 'two-over-one'] as const)('still rejects an inadmissible Pass substitute during a real natural F1 in %s', system => {
    const row = targets.find(item => item.id === 'B1-dev-long-0040-P1' && item.system === system)!;
    expect(assessment(row.frozenObservation, system, pass).reasons).toContain('unfulfilled-forcing-obligation');
    vi.spyOn(bidding, 'chooseBid').mockReturnValue(pass);
    const selected = bid(2, 'S');
    const result = enforceBiddingConsistency(row.frozenObservation, selected, system);
    expect(result).toMatchObject({ call: selected, family: 'natural-second-suit-length', source: 'unresolved' });
    expect(result?.ruleRejectedReasons).toContain('unfulfilled-forcing-obligation');
  });
  it.each(['sayc', 'two-over-one'] as const)('retains existing unanswered-protocol, independent-GF and public-game Pass exclusions in %s', system => {
    // Existing original target and previously used own hands; these are
    // composed integration contexts, not additional independent mother deals.
    const unanswered = targets.find(row => row.id === 'existing-weak-jump-feature-answer' && row.system === system)!;
    expect(assessment(unanswered.frozenObservation, system, pass).allowed).toBe(false);
    const gf = position('1H P 2C P', 'A8.AQJ986.Q32.K4');
    expect(analyzeAuctionSemantics(gf.auction, gf.seat, system).forcing).toBe('game');
    expect(assessment(gf, system, pass).reasons).toContain('unfulfilled-forcing-obligation');
    const publicGame = position('1C P 1H P 2C P 2H P', 'A4.KQ6.A3.AKT932');
    expect(assessment(publicGame, system, pass).reasons).toContain('explicit-public-game-strength');
  });
});
