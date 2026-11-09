import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics, isArtificialBidAt, publicCallMeaningAt, publicPendingResponse, publicPlayerConstraints, publicStrongDiamondAnswerAt, publicKeycardTrumpAt } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
const call = (s: string): Call => s === 'P' ? PASS : s === 'X' ? { kind: 'double' } : s === 'XX' ? { kind: 'redouble' }
  : { kind: 'bid', level: Number(s[0]), strain: s.slice(1) as Strain };
const auction = (s: string): AuctionEntry[] => s.split(' ').filter(Boolean).map((token, i) => ({ seat: seats[i % 4], call: call(token) }));
const meaning = (s: string, system: 'sayc' | 'two-over-one' = 'sayc') => {
  const a = auction(s); return publicCallMeaningAt(a, a.length - 1, system);
};
function observation(prefix: string, holding: string): BiddingObservation {
  const a = auction(prefix), seat = seats[a.length % 4];
  const hand: Card[] = holding.split('.').flatMap((text, i) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  expect(new Set(hand.map(card => card.id)).size).toBe(13);
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat, hand, auction: a, legalCalls: legalCalls(a, seat) };
}
const diamond = '2C P 2D P 3D P';

describe('v3.2.3 approved quiet strong-diamond response agreement', () => {
  it.each(['sayc', 'two-over-one'] as const)('%s publishes the negative, positive and release from their own prefixes', system => {
    const negative = auction(`${diamond} 3H`);
    expect(publicStrongDiamondAnswerAt(negative, 6, system)).toBe(true);
    expect(meaning(`${diamond} 3H`, system)).toMatchObject({ defined: true, artificial: true, role: 'artificial-response', hcpRange: { min: 0, max: 3 }, suitMinimums: {}, forcing: 'one-round' });
    expect(publicPlayerConstraints(negative, 'S', system).suitMinimums.H).toBe(0);
    expect(analyzeAuctionSemantics(auction(`${diamond} 3H P`), 'N', system)).toMatchObject({ mustBid: true, forcing: 'one-round' });
    expect(meaning(`${diamond} 3NT`, system)).toMatchObject({ defined: true, artificial: false, role: 'natural-nt', hcpRange: { min: 4, max: 40 }, suitMinimums: {}, forcing: 'none' });
    expect(publicPlayerConstraints(auction(`${diamond} 3NT`), 'S', system).strictBalancedShapeFamily).toBeUndefined();
    expect(analyzeAuctionSemantics(auction(`${diamond} 3NT P`), 'N', system).mustBid).toBe(false);
    expect(analyzeAuctionSemantics(auction(`${diamond} 3H P 4D P`), 'S', system)).toMatchObject({ mustBid: false, forcing: 'none' });
    expect(meaning(`${diamond} 3H P 4D P P`, system)).toMatchObject({ defined: true, role: 'pass', forcing: 'none' });
    expect(meaning(`${diamond} 4H`, system)).toMatchObject({ artificial: false, forcing: 'none', hcpRange: { min: 4, max: 40 }, suitMinimums: { H: 5 } });
    expect(describeCall(auction(diamond), 'S', call('3H'), system)).toContain('0~3个大牌点');
    expect(describeCall(auction(diamond), 'S', call('3NT'), system)).toContain('成局止叫');
  });
  it.each(['sayc', 'two-over-one'] as const)('%s actual rule calls choose negative, natural NT, shifted hearts and the safe diamond exit', system => {
    expect(chooseBid(observation(diamond, 'Q63.9874.98.7654'), system)).toEqual(call('3H'));
    expect(chooseBid(observation(diamond, 'QJ63.J874.98.765'), system)).toEqual(call('3NT'));
    expect(chooseBid(observation(diamond, '6.KJ874.98.76543'), system)).toEqual(call('4H'));
    expect(chooseBid(observation(`${diamond} 3H P`, 'KQJ.AKQ.AKQ98.76'), system)).toEqual(call('4D'));
    expect(chooseBid(observation(`${diamond} 3H P 4D P`, 'Q63.9874.98.7654'), system)).toEqual(PASS);
    expect(chooseBid(observation(`${diamond} 3NT P`, 'KQJ.AKQ.AKQ98.76'), system)).toEqual(PASS);
  });
  it('keeps other strong-2C and NT platforms outside the shifted protocol', () => {
    expect(meaning('2C P 2D P 2H P 3C')).toMatchObject({ artificial: true, hcpRange: { min: 0, max: 3 } });
    expect(meaning('2C P 2D P 3C P 3D')).toMatchObject({ artificial: true, hcpRange: { min: 0, max: 3 } });
    expect(meaning('2C P 2D P 2NT P 3H')).toMatchObject({ artificial: true, role: 'transfer' });
    const competitive = auction('2C P 2D P 3D X 3H');
    expect(publicStrongDiamondAnswerAt(competitive, 6, 'sayc')).toBe(false);
    expect(isArtificialBidAt(competitive, 6, 'sayc')).toBe(false);
  });
});

describe('v3.2.3 weak-jump inquiry response phases', () => {
  const request = '1H 2S P 2NT P';
  it('preserves the first-answer protocol and rejects premature natural game', () => {
    expect(publicPendingResponse(auction(request), 'E', 'sayc')).toMatchObject({ kind: 'feature' });
    expect(meaning(`${request} 4S`)).toMatchObject({ defined: false, role: 'unknown' });
    expect(meaning(`${request} 3C`)).toMatchObject({ defined: true, role: 'weak-feature-answer', hcpRange: { min: 9, max: 11 }, suitMinimums: {} });
  });
  it('6888 lets the asker choose the natural spade game after the feature answer', () => {
    const prefix = `${request} 3C P`;
    expect(publicPendingResponse(auction(prefix), 'W', 'sayc')).toBeUndefined();
    expect(meaning(`${prefix} X`)).toMatchObject({ defined: true, artificial: false });
    expect(chooseBid(observation(prefix, 'AQ6.J97.KQ5.QJ74'), 'sayc')).toEqual(call('4S'));
  });
  it('an original weak-two inquiry still requires its first answer', () => {
    expect(publicPendingResponse(auction('2H P 2NT P'), 'N', 'sayc')).toMatchObject({ kind: 'feature' });
    expect(meaning('2H P 2NT P 4H')).toMatchObject({ defined: false });
  });
});

describe('v3.2.3 support cue and RKCB protocol compatibility', () => {
  const meaning = (text: string) => { const a = auction(text); return publicCallMeaningAt(a, a.length-1, 'two-over-one'); };
  const prefix = '1S 2H 3H 3S 4H';
  it('recognizes the existing public heart RKCB ask through a pending cue obligation', () => {
    const a = auction(`${prefix} 4NT`);
    expect(publicKeycardTrumpAt(a, 5, 'two-over-one')).toBe('H');
    expect(meaning(`${prefix} 4NT`)).toMatchObject({ defined: true, artificial: true, role: 'keycard-ask', agreedTrump: 'H' });
    expect(analyzeAuctionSemantics(auction(`${prefix} 4NT P`), 'W', 'two-over-one')).toMatchObject({ mustBid: true, convention: 'keycard' });
    expect(publicPendingResponse(auction(`${prefix} 4NT P`), 'W', 'two-over-one')).toMatchObject({ kind: 'keycard', trump: 'H' });
    expect(chooseBid(observation(`${prefix} 4NT P`, 'K2.QJ74.A863.K65'), 'two-over-one')).toEqual(call('5C'));
  });
  it('does not waive other artificial inquiry or first-answer obligations', () => {
    expect(meaning(`${prefix} X`)).toMatchObject({ defined: false, role: 'unknown' });
    expect(meaning('1NT P 2C P 4NT')).toMatchObject({ defined: false });
    expect(meaning(`${prefix} 4NT P 5NT`)).toMatchObject({ defined: false });
    expect(meaning(`${prefix} 4NT P 5D`)).toMatchObject({ defined: true, role: 'keycard-answer' });
  });
});

