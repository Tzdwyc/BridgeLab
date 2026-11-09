import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bidding from '../src/ai/bidding';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { assessCandidates } from '../src/ai/constrained-sl';
import { publicCallMeaningAt, publicPendingResponse } from '../src/ai/bidding-semantics';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { suggestSLBid, type SLBidTrace } from '../src/ai/neural/browser-model';
import { legalCalls, sameCall } from '../src/core/auction';
import type { BiddingObservation } from '../src/ai/observation';
import type { Call, Seat, Strain, Suit } from '../src/core/types';
vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
const evidence = JSON.parse(readFileSync('artifacts/v328-hints-and-cue-20261108/ten-board-final-002/ten-board-01.json', 'utf8'));
const frozen = evidence.issues.find((row: any) => row.qualification.reasons.includes('pending-weak-minor-relay'));
const pass: Call = { kind: 'pass' }, bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function position(prefix: string, holding: string): BiddingObservation {
  const tokens = prefix.split(' '), seat = seats[tokens.length % 4];
  const auction = tokens.map((token, i) => ({ seat: seats[i % 4], call: token === 'P' ? pass : bid(Number(token[0]), token.slice(1) as Strain) }));
  const hand = holding.split('.').flatMap((cards, i) => [...cards.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2; return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  return { phase: 'auction', board: 1, seat, actingSeat: seat, vulnerability: 'None', hand, auction, legalCalls: legalCalls(auction, seat) };
}
const assessment = (obs: BiddingObservation, system: 'sayc' | 'two-over-one', selected: Call) => assessCandidates(obs, system).find(c => sameCall(c.call, selected))!;
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
describe.each(['sayc', 'two-over-one'] as const)('v3.2.8 qualified public pending protocols in %s', system => {
  it('answers the frozen 2S weak-minor relay with the existing qualified 3C', () => {
    const obs = frozen.observation as BiddingObservation, actual = bidding.chooseBid(obs, system);
    console.log('FROZEN_RELAY_EXISTING_RULE', system, JSON.stringify(actual), JSON.stringify(assessment(obs, system, actual).reasons));
    expect(publicPendingResponse(obs.auction, obs.seat, system)?.kind).toBe('weak-minor-relay');
    expect(actual).toEqual(bid(3, 'C'));
    expect(assessment(obs, system, actual).allowed).toBe(true);
    expect(enforceBiddingConsistency(obs, pass, system)).toMatchObject({ call: actual, family: 'pending-protocol-answer', source: 'existing-rule', ruleRejectedReasons: [] });
  });
  it('covers an unknown wrong reply before the old unknown-meaning early return', () => {
    const obs = frozen.observation as BiddingObservation, selected = bid(3, 'S');
    expect(publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: selected }], obs.auction.length, system).defined).toBe(false);
    expect(enforceBiddingConsistency(obs, selected, system)).toMatchObject({ call: bid(3, 'C'), family: 'pending-protocol-answer', source: 'existing-rule' });
  });
  it.each([
    ['1NT P 2D P', 'KQ3.AJ84.QJ3.976', 'transfer'],
    ['2H P 2NT P', 'K852.AJ7432.98.6', 'feature'],
    ['1H P 3H P 4NT P 5C P 5D P', 'Q6.KQJ97.AT8.962', 'queen'],
  ] as const)('uses the existing qualified answer for a rejected Pass in %s', (prefix, holding, kind) => {
    const obs = position(prefix, holding), pending = publicPendingResponse(obs.auction, obs.seat, system), rule = bidding.chooseBid(obs, system);
    expect(pending?.kind).toBe(kind);
    expect(assessment(obs, system, pass).allowed).toBe(false);
    expect(assessment(obs, system, rule).allowed, JSON.stringify({ rule, reasons: assessment(obs, system, rule).reasons })).toBe(true);
    expect(enforceBiddingConsistency(obs, pass, system)).toMatchObject({ call: rule, family: 'pending-protocol-answer', source: 'existing-rule' });
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, rule, system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });
  it('does not force a quantitative invitation that explicitly permits a qualified Pass', () => {
    const obs = position('1NT P 4NT P', 'KQ3.AJ84.QJ3.K76');
    expect(publicPendingResponse(obs.auction, obs.seat, system)?.kind).toBe('quantitative-small');
    expect(assessment(obs, system, pass).allowed).toBe(true);
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, pass, system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });
  it('keeps a released relay continuation outside the new guard', () => {
    const obs = position('1H 1NT P 2S P 3C P', 'T.QT8.K54.T98532');
    expect(publicPendingResponse(obs.auction, obs.seat, system)).toBeUndefined();
    expect(assessment(obs, system, pass).allowed).toBe(true);
    expect(enforceBiddingConsistency(obs, pass, system)).toBeUndefined();
  });
  it('preserves unresolved evidence when the existing rule has no qualified response', () => {
    const obs = frozen.observation as BiddingObservation;
    vi.spyOn(bidding, 'chooseBid').mockReturnValue(pass);
    const result = enforceBiddingConsistency(obs, pass, system);
    expect(result).toMatchObject({ call: pass, family: 'pending-protocol-answer', source: 'unresolved' });
    expect(result?.ruleRejectedReasons).toContain('pending-weak-minor-relay');
  });
  it('retains a contradictory weak-two prefix as unresolved when its existing rule cannot qualify', () => {
    // Preserve the initially exposed adverse combination: a 2H opener with
    // six spades and a singleton heart is not a consistent weak-two hand.
    // Its failure must not be repaired by choosing or ranking a new answer.
    const obs = position('2H P 2NT P', 'AJ7432.6.98.K852');
    const rule = bidding.chooseBid(obs, system);
    expect(assessment(obs, system, rule).allowed).toBe(false);
    expect(enforceBiddingConsistency(obs, pass, system)).toMatchObject({ call: pass, family: 'pending-protocol-answer', source: 'unresolved' });
  });
  it('preserves the original SL output through the existing profile gate', async () => {
    const obs = frozen.observation as BiddingObservation, trace = frozen.trace as SLBidTrace;
    vi.mocked(suggestSLBid).mockResolvedValue({ call: pass, trace: { ...trace, profileId: 'seed101-epoch08' } });
    const repaired = await suggestSystemBid(obs, { system, allowLookahead: false });
    expect(repaired.call).toEqual(bid(3, 'C'));
    expect(repaired.trace?.reason).toBe('consistency:pending-protocol-answer');
    vi.mocked(suggestSLBid).mockResolvedValue({ call: pass, trace: { ...trace, profileId: 'original-sl' } });
    const original = await suggestSystemBid(obs, { system, allowLookahead: false });
    expect(original.call).toEqual(pass);
    expect(original.trace?.route).not.toBe('agreement-flow');
  });
});
