import { describe, expect, it } from 'vitest';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
import { type BiddingObservation } from '../src/ai/observation';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { analyzeAuctionSemantics, classifyDoubleAt, isArtificialBidAt, naturalSuitMinimum, noTrumpRangeAt } from '../src/ai/bidding-semantics';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function auction(start: Seat, text: string): AuctionEntry[] {
  return text.split(' ').map((token, index) => ({ seat: seats[(seats.indexOf(start) + index) % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : bid(Number(token[0]), token.slice(1) as Strain) }));
}
function observation(start: Seat, text: string, holding: string): BiddingObservation {
  const calls = auction(start, text), suitNames: Suit[] = ['S', 'H', 'D', 'C'];
  const hand: Card[] = holding.split('.').flatMap((cards, i) => [...cards.replace('-', '')].map(symbol => ({
    id: `${suitNames[i]}${symbol}`, suit: suitNames[i], rank: '23456789TJQKA'.indexOf(symbol) + 2
  })));
  if (hand.length !== 13) throw new Error('Reviewed example must have thirteen cards');
  const seat = seats[(seats.indexOf(start) + calls.length) % 4];
  return { board: 1, phase: 'auction', seat, actingSeat: seat, auction: calls, hand,
    legalCalls: legalCalls(calls, seat), vulnerability: 'None' };
}

describe('v0.3.3 reviewed competitive meanings and decisions', () => {
  it('postfix 7759 and 7646: compulsory high response is not a slam invitation; strong five-five competes again', () => {
    expect(chooseBid(observation('W', '3H P P X P 4C P', 'AJ94.A.A86.AQJ73'), 'sayc')).toEqual(bid(5, 'C'));
    expect(chooseBid(observation('S', '1H P P 1S 2D 2S P P', '-.AKQ83.AK865.AJ9'), 'sayc')).toEqual(bid(3, 'D'));
    expect(naturalSuitMinimum(auction('N', '2C P 2D P 3C P 3H P 4C'), 'N', 'C', 'sayc')).toBe(4);
  });
  it('responder natural second suit and natural NT invitations retain their public roles', () => {
    expect(noTrumpRangeAt(auction('N', '1C P 1H P 1S P 2NT'), 6, 'sayc')).toEqual({ min: 11, max: 12 });
    expect(analyzeAuctionSemantics(auction('N', '1C 1S X P 3C P 3D P'), 'N', 'sayc').mustBid).toBe(true);
    expect(analyzeAuctionSemantics(auction('S', 'P P 1D P 1H P 1S P 3C P'), 'N', 'sayc').mustBid).toBe(false);
  });
  it('postfix competition supports use adjusted invitations even after a double', () => {
    expect(chooseBid(observation('W', '1S X XX P P 2D', 'KT7.K8.T753.KQT5'), 'sayc')).toEqual(bid(3, 'S'));
    expect(chooseBid(observation('W', 'P 1H X', 'Q3.J8754.AJ92.93'), 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(observation('E', '1C X', 'J32.J.AK65.T9752'), 'sayc')).toEqual(bid(3, 'C'));
    expect(chooseBid(observation('S', 'P 1S X', 'KJT9.J952.-.K8754'), 'sayc')).toEqual(bid(3, 'S'));
    expect(chooseBid(observation('N', 'P P 1C X', 'JT8.K.876.K98542'), 'sayc')).toEqual(bid(3, 'C'));
  });
  it('postfix strong first actions over an enemy response retain takeout strength', () => {
    expect(chooseBid(observation('S', '1C P 1S', '3.AJ4.AKQJ764.K2'), 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(observation('N', '1C P 1S', '-.AQJ7654.K54.AK9'), 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(observation('N', '2S P 3S', '-.A875.A54.AKQJ75'), 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(observation('W', '1H P 2H', 'KJ98764.AQ43.-.T7'), 'sayc')).toEqual(bid(2, 'S'));
  });
  it('postfix Michaels bidder and natural overcaller can compete at the real cheapest level', () => {
    expect(chooseBid(observation('W', 'P 1D 2D X 2S 3D', 'T6432.AQ832.T9.Q'), 'sayc')).toEqual(bid(3, 'S'));
    expect(chooseBid(observation('N', 'P 1C 1H P 1S P', '52.AKJ8432.KJ.K9'), 'sayc')).toEqual(bid(2, 'H'));
    // Over enemy 3H the cheapest diamond answer is 4D, not an extras jump.
    expect(chooseBid(observation('E', 'P 1H 2D 2H 3H P', 'J9.J2.KQ763.K982'), 'sayc')).toEqual(bid(4, 'D'));
  });
  it('postfix 4463 and 4545: natural major exploration and support-adjusted transfer invitation', () => {
    expect(chooseBid(observation('W', '1C 1D P', 'AKJ8.T92.J2.AJT7'), 'sayc')).toEqual(bid(1, 'S'));
    expect(chooseBid(observation('E', '1D 1NT P 2D P 2H P 2NT P', 'A752.AKT.KQT7.T6'), 'sayc')).toEqual(bid(4, 'H'));
  });
  it('postfix takeout continuations use public NT or long-suit ranges', () => {
    expect(chooseBid(observation('N', '1D X P 1NT P', 'AQJT983.AJ3.-.K84'), 'sayc')).toEqual(bid(4, 'S'));
    expect(chooseBid(observation('E', 'P 1H X P 1S P 1NT P', 'T7432.963.A9.AT6'), 'sayc')).toEqual(bid(3, 'NT'));
    expect(chooseBid(observation('W', '1H X P 2C P 2D P', 'J75.62.A2.KT8754'), 'sayc')).toEqual(bid(3, 'C'));
  });
  it('postfix thin penalty targets cannot borrow takeout or negative-double shape', () => {
    for (const [start, prefix, hand] of [
      ['S', 'P 1NT 2S', '74.5432.AJT.KT53'],
      ['N', 'P P 1NT P 2H P 2S', '95.KQ5.K643.AQ65'],
      ['S', 'P P 1NT P 2D P 2H', 'Q986.J.A876.AK53'],
      ['N', '1D P 1H P 1S', '9.A65.JT875.AKQ6'],
      ['W', 'P P 1NT P 2H P 2S', 'Q.K9654.AKJ.J976'],
      ['S', '1C P 1D P 1H P 2C', 'AJ83.A42.9853.A8'],
    ] as const) expect(chooseBid(observation(start, prefix, hand), 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('postfix 7657: choose the eligible five-card one-level suit when the longer suit lacks two-level strength', () => {
    expect(chooseBid(observation('N', '1H', 'AJT63.8.KJ9875.3'), 'sayc')).toEqual(bid(1, 'S'));
  });
  it('postfix poor preempt-defense suits do not become three-level overcalls from HCP alone', () => {
    expect(chooseBid(observation('S', 'P 2S', 'A83.A.A743.JT986'), 'sayc')).toEqual(PASS);
    expect(chooseBid(observation('S', '2S', 'J873.J9874.K.AK8'), 'sayc')).toEqual(PASS);
    expect(chooseBid(observation('E', '2S', '9.2.AQJT987652.J'), 'sayc')).toEqual(bid(3, 'D'));
  });
  it('postfix 4620, 4668, 4635: delayed and doubled natural overcalls retain support', () => {
    expect(chooseBid(observation('N', '1D P P 1S P', '987.AJ4.K974.JT9'), 'sayc')).toEqual(bid(2, 'S'));
    expect(chooseBid(observation('N', '1D P 1H 1S P', 'A43.Q874.Q86.875'), 'sayc')).toEqual(bid(2, 'S'));
    expect(chooseBid(observation('W', '1C 1S X', 'K9653.Q54.T98.64'), 'sayc')).toEqual(bid(2, 'S'));
  });
  it('postfix 641 and 735: a nonforcing bad fit may be corrected to a true six-card suit', () => {
    expect(chooseBid(observation('E', 'P P P 1C 1H P 2D P', '732.K87543.7.KQ6'), 'sayc')).toEqual(bid(2, 'H'));
    expect(chooseBid(observation('W', 'P P 1C 1D P 1S P', '9.AQT7.AQJT53.85'), 'sayc')).toEqual(bid(2, 'D'));
    expect(chooseBid(observation('W', '1NT P P 2D P', 'Q9862.J74.-.AQT84'), 'sayc')).toEqual(bid(2, 'S'));
  });
  it('postfix 7482: enemy raise releases compulsory Michaels inquiry without promising NT game strength', () => {
    const calls = auction('S', 'P 1S 2S 3S');
    expect(analyzeAuctionSemantics(calls, 'S', 'sayc').mustBid).toBe(false);
    expect(chooseBid(observation('S', 'P 1S 2S 3S', 'K62.T32.632.AJ98'), 'sayc')).toEqual(PASS);
  });
  it('postfix public length corrections: competition repeats five, delayed preference three, two-suit advance three', () => {
    expect(naturalSuitMinimum(auction('N', '1H 2H X 2S 3H'), 'N', 'H', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1S 2NT X 3C 3S'), 'N', 'S', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1D P 1H P 1S P 2C P 2H'), 'N', 'H', 'sayc')).toBe(3);
    expect(naturalSuitMinimum(auction('N', '1D 2NT P 3H'), 'W', 'H', 'sayc')).toBe(3);
    expect(naturalSuitMinimum(auction('N', '1C 1H 1S'), 'S', 'S', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1NT P 2C P 2H P 2S'), 'S', 'S', 'sayc')).toBe(4);
    expect(naturalSuitMinimum(auction('N', '2C P 2D P 3C'), 'N', 'C', 'sayc')).toBe(4);
  });
  it('7534: Michaels does not turn a natural club raise into our game force', () => {
    const calls = auction('S', 'P P 1C 2C 3C 3D');
    expect(isArtificialBidAt(calls, 3)).toBe(true);
    expect(isArtificialBidAt(calls, 4)).toBe(false);
    expect(analyzeAuctionSemantics(calls, 'N', 'sayc').mustBid).toBe(false);
  });
  it('7411: delayed takeout of opener two suits selects the genuine five-card spade suit', () => {
    expect(chooseCompetitiveCall(observation('W', '1D P 1S P 2C P P X P', 'T9864.T8.A96.QJ2'), 'sayc'))
      .toEqual(bid(2, 'S'));
    expect(naturalSuitMinimum(auction('W', '1D P 1S P 2C P P X P 2S'), 'N', 'S', 'sayc')).toBe(4);
  });
  it('4118: sandwich and repeated technical doubles retain the takeout role', () => {
    const calls = auction('S', '1D P 1H X 2H P P X');
    expect(classifyDoubleAt(calls, 3, 'sayc')).toBe('takeout');
    expect(classifyDoubleAt(calls, 7, 'sayc')).toBe('takeout');
  });
  it('weak-jump inquiry is answered by a playable original-suit minimum', () => {
    const calls = auction('N', '1C 2H P 2NT P 3H P');
    expect(analyzeAuctionSemantics(calls, 'W', 'sayc')).toMatchObject({ mustBid: false, currentContractArtificial: false });
    expect(isArtificialBidAt(calls, 5)).toBe(false);
    expect(chooseCompetitiveCall(observation('N', '1C 2H P 2NT P 3H P', 'AKQ.82.AQJ2.J875'), 'sayc')).toEqual(PASS);
    const feature = auction('N', '1C 2H P 2NT P 3D P');
    expect(analyzeAuctionSemantics(feature, 'W', 'sayc')).toMatchObject({ mustBid: true, currentContractArtificial: true });
  });
  it('Stayman major answers are natural four-card contracts; the denial remains artificial', () => {
    for (const major of ['H', 'S'] as Suit[]) {
      const calls = auction('N', `1NT P 2C P 2${major} P`);
      expect(isArtificialBidAt(calls, 4)).toBe(false);
      expect(analyzeAuctionSemantics(calls, 'S', 'sayc').mustBid).toBe(false);
      expect(naturalSuitMinimum(calls, 'N', major, 'sayc')).toBe(4);
    }
    expect(analyzeAuctionSemantics(auction('N', '1NT P 2C P 2D P'), 'S', 'sayc').mustBid).toBe(true);
  });
  it('natural minor preference after ordinary opener NT is not a transfer request', () => {
    const calls = auction('N', '1D P 1S P 1NT P 2D P');
    expect(isArtificialBidAt(calls, 6)).toBe(false);
    expect(analyzeAuctionSemantics(calls, 'N', 'sayc').mustBid).toBe(false);
  });
  it('a reply in agreed trump can be left at the same level; nontrump replies cannot', () => {
    for (const trump of ['C', 'D', 'H', 'S'] as Suit[]) {
      const calls = auction('N', `1${trump} P 3${trump} P 4NT P 5${trump} P`);
      expect(isArtificialBidAt(calls, 6)).toBe(false);
      expect(analyzeAuctionSemantics(calls, 'N', 'sayc').mustBid).toBe(false);
    }
    const calls = auction('N', '1H P 3H P 4NT P 5C P');
    expect(isArtificialBidAt(calls, 6)).toBe(true);
    expect(analyzeAuctionSemantics(calls, 'N', 'sayc').mustBid).toBe(true);
    for (const [prefix, index] of [['1H P 2NT P 4NT P 5H P', 6], ['1D P 1H P 2C P 4NT P 5C P', 8]] as const) {
      const calls = auction('N', prefix);
      expect(isArtificialBidAt(calls, index, 'sayc')).toBe(false);
      expect(analyzeAuctionSemantics(calls, calls[index - 2].seat, 'sayc').mustBid).toBe(false);
    }
  });
  it('forced fourth-suit and reverse answers do not invent a strong NT range', () => {
    const fourth = auction('N', '1D P 1H P 1S P 2C P 2NT');
    expect(noTrumpRangeAt(fourth, 8, 'sayc')).toEqual({ min: 12, max: 21 });
    const reverse = auction('N', '1C P 1S P 2H P 2NT');
    expect(noTrumpRangeAt(reverse, 6, 'sayc')).toEqual({ min: 6, max: 10 });
  });
  it('takeout NT rebids distinguish a voluntary jump from space-forced 2NT', () => {
    expect(noTrumpRangeAt(auction('N', '1H X P 1S P 2NT'), 5, 'sayc')).toEqual({ min: 21, max: 22 });
    expect(noTrumpRangeAt(auction('N', '2S X P 3D P 3NT'), 5, 'sayc')).toBeUndefined();
    expect(noTrumpRangeAt(auction('N', '2H X P 2S P 2NT'), 5, 'sayc')).toEqual({ min: 18, max: 20 });
    expect(noTrumpRangeAt(auction('N', '1H X P 2H P 2NT'), 5, 'sayc')).toBeUndefined();
    const natural = auction('N', '1C P P X P 1H P 2NT P');
    expect(isArtificialBidAt(natural, 7, 'sayc')).toBe(false);
    expect(analyzeAuctionSemantics(natural.slice(0, 8), 'E', 'sayc').currentContractArtificial).toBe(false);
  });
  it('public suit lengths retain secondary four cards and original minor return five', () => {
    expect(naturalSuitMinimum(auction('N', '1C P 1H P 1S P 2D P 2S'), 'N', 'S', 'sayc')).toBe(4);
    expect(naturalSuitMinimum(auction('N', '1C P 1H P 1S P 2D P 3C'), 'N', 'C', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1H P 1NT P 2H'), 'N', 'H', 'sayc')).toBe(6);
    expect(naturalSuitMinimum(auction('N', '1D P 1S P 2D'), 'N', 'D', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1D P 1S P 3D'), 'N', 'D', 'sayc')).toBe(6);
    expect(naturalSuitMinimum(auction('N', '1H P 1S P 2C P 2H'), 'S', 'H', 'sayc')).toBe(2);
  });
  it('transfer acceptance promises two, request promises five in the target suit', () => {
    const calls = auction('N', '1NT P 2D P 2H');
    expect(naturalSuitMinimum(calls, 'N', 'H', 'sayc')).toBe(2);
    expect(naturalSuitMinimum(calls, 'S', 'H', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1NT P 2H P 2S P 3NT P 4S'), 'N', 'S', 'sayc')).toBe(3);
    const twoMajors = auction('N', '1NT P 2H P 2S P 3H P');
    expect(analyzeAuctionSemantics(twoMajors, 'N', 'sayc')).toMatchObject({ forcing: 'game', mustBid: true });
    expect(isArtificialBidAt(twoMajors, 6, 'sayc')).toBe(false);
  });
  it('simple response raises use actual four-card major and five-card minor promises', () => {
    expect(naturalSuitMinimum(auction('N', '1C P 1H P 2H'), 'N', 'H', 'sayc')).toBe(4);
    expect(naturalSuitMinimum(auction('N', '1C P 2C'), 'S', 'C', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '1H P 2H'), 'S', 'H', 'sayc')).toBe(3);
    expect(naturalSuitMinimum(auction('N', '1C P 1S'), 'S', 'S', 'precision')).toBe(5);
    expect(naturalSuitMinimum(auction('N', '2D X P 3D P 3S'), 'E', 'S', 'sayc')).toBe(3);
  });
  it('custom major NT response is semi-forcing five to twelve under both identifiers', () => {
    const calls = auction('N', '1H P 1NT P');
    for (const system of ['sayc', 'two-over-one'] as const) {
      expect(noTrumpRangeAt(calls, 2, system)).toEqual({ min: 5, max: 12 });
      expect(analyzeAuctionSemantics(calls, 'N', system).mustBid).toBe(false);
    }
    expect(classifyDoubleAt(auction('N', '2C X'), 1, 'sayc')).toBe('lead-directing');
  });
});
