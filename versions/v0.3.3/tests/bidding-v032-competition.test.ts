import { describe, expect, it } from 'vitest';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
import { type BiddingObservation } from '../src/ai/observation';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { analyzeAuctionSemantics, classifyDoubleAt, isArtificialBidAt, isNegativeDoubleAt, noTrumpRangeAt } from '../src/ai/bidding-semantics';

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
  if (hand.length !== 13) throw new Error('Explicit reviewed hand must have 13 cards');
  const seat = seats[(seats.indexOf(start) + calls.length) % 4];
  return { board: 1, phase: 'auction', seat, actingSeat: seat, auction: calls, hand,
    legalCalls: legalCalls(calls, seat), vulnerability: 'None' };
}
const choose = (start: Seat, text: string, hand: string) => chooseCompetitiveCall(observation(start, text, hand), 'sayc');

describe('v0.3.2 reviewed competition decisions, own hand and public auction only', () => {
  it('3867: 15 HCP with four enemy clubs and two hearts is not a shape-free balancing double', () => {
    const obs = observation('W', '1C P P', 'T986.42.AQJ.AKJ9');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('3391: seven HCP, a singleton and nine known hearts give an eleven-support-point invitation', () => {
    const obs = observation('S', 'P 1H 1S', 'T.A852.874.K9532');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'H'));
  });
  it('2678: a natural three-level major over Unusual needs ten HCP, even for a passed hand', () => {
    const prefix = 'P P P 1D 2NT';
    const below = observation('S', prefix, 'Q9862.K42.865.A7');
    expect(chooseCompetitiveCall(below, 'sayc')).toEqual(PASS);
    expect(chooseBid(below, 'sayc')).toEqual(PASS);
    const enough = observation('S', prefix, 'K9862.K42.865.A7');
    expect(chooseCompetitiveCall(enough, 'sayc')).toEqual(bid(3, 'S'));
    expect(chooseBid(enough, 'sayc')).toEqual(bid(3, 'S'));
  });
  it('2720: an eighteen-point opener and a negative double confirm enough for the spade game', () => {
    const initial = observation('W', '1C 1H X P', 'AKQ8.T74.A8.AJ96');
    expect(chooseCompetitiveCall(initial, 'sayc')).toEqual(bid(4, 'S'));
    expect(chooseBid(initial, 'sayc')).toEqual(bid(4, 'S'));
    const invited = observation('W', '1C 1H X P 1S P 3S P', 'AKQ8.T74.A8.AJ96');
    expect(chooseBid(invited, 'sayc')).toEqual(bid(4, 'S'));
  });
  it('2712: seven spades and a club void need a natural overcall, not a minimum takeout double', () => {
    expect(choose('N', '2D', 'AQT8432.KT8.KJ.8')).toEqual(bid(2, 'S'));
  });
  it('374: four-heart support and a singleton permit a simple raise despite only four HCP', () => {
    expect(choose('S', 'P P 1H X', 'T432.T764.A754.7')).toEqual(bid(2, 'H'));
  });
  it('2688: a six-heart 18-HCP opener shows extras after the negative double', () => {
    expect(choose('N', 'P 1H 1S X P', 'Q4.AQ9632.KQ.AJ4')).toEqual(bid(3, 'H'));
  });
  it('2625: doubler cannot leave the last enemy heart contract redoubled with only Kx in hearts', () => {
    expect(choose('E', 'P 1H X XX P P', 'T865.K5.AK62.K43')).toEqual(bid(1, 'S'));
  });
  it('4027: advancer may wait after XX, then the strong redoubler may penalize a four-card AJ trump stack', () => {
    expect(analyzeAuctionSemantics(auction('W', 'P 1C X XX'), 'W', 'sayc').mustBid).toBe(false);
    expect(choose('W', 'P 1C X XX P P 1S', 'AJ97.KT43.A9.965')).toEqual({ kind: 'double' });
  });
  it('2721 and 2680: no false strong rebid or penalty double from superficial HCP', () => {
    expect(choose('E', 'P P 1D X 2D P P', 'A54.KQ943.76.A92')).toEqual(PASS);
    expect(choose('N', 'P 1C 1H X P 2C P P 2H P P', 'A763.97.KQ7.8765')).not.toEqual({ kind: 'double' });
  });
  it('3916: a strong seven-card fit can invite after enemy reentry without pretending partner promised four', () => {
    expect(choose('N', 'P 1D X P 1S 2D', 'AKQJT85.K9.T.AJ7')).toEqual(bid(3, 'S'));
  });
  it('minor NT invitation uses 11–12 and does not create a game force', () => {
    const calls = auction('N', '1C P 2NT P');
    expect(noTrumpRangeAt(calls, 2, 'sayc')).toEqual({ min: 11, max: 12 });
    expect(analyzeAuctionSemantics(calls, 'N', 'sayc').mustBid).toBe(false);
    expect(noTrumpRangeAt(auction('N', '1C P 3NT'), 2, 'sayc')).toEqual({ min: 13, max: 21 });
  });
  it('passed natural new suits and an enemy further natural bid do not impose ordinary F1', () => {
    expect(analyzeAuctionSemantics(auction('S', 'P P 1C P 1H P'), 'N', 'sayc').mustBid).toBe(false);
    expect(analyzeAuctionSemantics(auction('N', '1C 1D 1H 2D'), 'N', 'sayc').mustBid).toBe(false);
    expect(analyzeAuctionSemantics(auction('N', '1C P 1S P 2H 3D'), 'S', 'sayc').mustBid).toBe(false);
  });
  it('Michaels and Unusual doubled artificial calls require removal; a natural enemy bid releases it', () => {
    expect(analyzeAuctionSemantics(auction('N', '1H 2H X'), 'W', 'sayc').mustBid).toBe(true);
    expect(analyzeAuctionSemantics(auction('N', '1D 2NT X'), 'W', 'sayc').mustBid).toBe(true);
    expect(analyzeAuctionSemantics(auction('E', '1D 2NT 3S'), 'N', 'sayc').mustBid).toBe(false);
  });
  it('2604, 2661, 3917: support-cue and NT-transfer doubles are lead directing, not takeout', () => {
    const cue = auction('N', '1H 1S P 2H X');
    expect(classifyDoubleAt(cue, 4)).toBe('lead-directing');
    expect(isArtificialBidAt(cue, 3)).toBe(true);
    const transfer = auction('E', '1D 1NT P 2D X');
    expect(classifyDoubleAt(transfer, 4)).toBe('lead-directing');
    expect(classifyDoubleAt(auction('E', '1D 1NT P 2D X 2H P P X'), 8)).toBe('penalty');
    expect(classifyDoubleAt(auction('E', 'P P 1H 2D P 2H X'), 6)).toBe('lead-directing');
    expect(classifyDoubleAt(auction('N', '1H 2H X'), 2)).toBe('two-suit-strength');
    expect(classifyDoubleAt(auction('N', '1H 2NT X'), 2)).toBe('two-suit-strength');
  });
  it('4027 and 4010: XX escape X is penalty; a completed negative response clears the obligation', () => {
    const penalty = auction('W', 'P 1C X XX P P 1S X');
    expect(classifyDoubleAt(penalty, 7)).toBe('penalty');
    expect(isNegativeDoubleAt(penalty, 7)).toBe(false);
    const negative = auction('S', '1S 2H X P');
    expect(classifyDoubleAt(negative, 2)).toBe('negative');
    expect(analyzeAuctionSemantics(negative, 'S', 'sayc').mustBid).toBe(true);
    expect(analyzeAuctionSemantics(auction('S', '1S 2H X P 2S P'), 'N', 'sayc').mustBid).toBe(false);
    expect(choose('S', '1S 2H', 'J853.T9.KQJ2.KQ4')).toEqual(bid(4, 'S'));
  });
  it('3936: a known four-card major fit opposite a natural weak-two overcall cannot be passed with 16 HCP', () => {
    expect(choose('N', '2D 2H P', 'AKQ.T954.KJ.K854')).toEqual(bid(4, 'H'));
  });
  it('Michaels inquiry and support cue preserve answer obligation through an artificial-call double', () => {
    expect(choose('N', '1H 2H P 2NT X', 'AKJ84.7.AQ982.65')).toEqual(bid(3, 'D'));
    expect(analyzeAuctionSemantics(auction('N', '1H 1S P 2H X'), 'E', 'sayc').mustBid).toBe(true);
    expect(classifyDoubleAt(auction('N', '1NT P 2D X'), 3)).toBe('lead-directing');
    expect(isArtificialBidAt(auction('N', '1NT P 2D X'), 2)).toBe(true);
  });
  it('forced lowest takeout response may use three cards when no unbid suit contains four', () => {
    expect(choose('N', '1H X P', '876.9753.864.975')).toEqual(bid(1, 'S'));
  });
  it('2635: advancer supports a strong takeout doubler free new suit, without assigning that range to cue answers', () => {
    expect(choose('W', 'P 2H X P 3D P 3S P', '964.A5.J7653.K65')).toEqual(bid(4, 'S'));
    // Change the first response to a cue: 3S now answers a forcing inquiry,
    // so a seven-point hand may not fabricate a 17-HCP partner minimum.
    expect(choose('W', 'P 2H X P 3H P 3S P', '964.A5.J7653.Q65')).not.toEqual(bid(4, 'S'));
  });
  it('7124: transfer double requires the transferred bid suit as a lead holding, not generic HCP', () => {
    const poorDiamonds = observation('N', '1NT P 2D', 'QT9.KT92.94.AKQ6');
    expect(chooseCompetitiveCall(poorDiamonds, 'sayc')).toEqual(PASS);
    expect(chooseBid(poorDiamonds, 'sayc')).toEqual(PASS);
    expect(choose('N', '1NT P 2D', 'QT9.KT92.AKJ4.65')).toEqual({ kind: 'double' });
  });
  it('Stayman and keycard replies need genuine suit quality; RKCB 4NT is artificial but natural NT 4NT is quantitative', () => {
    const poorClubs = 'AKQ9.KT92.94.876';
    expect(choose('N', '1NT P 2C', poorClubs)).toEqual(PASS);
    expect(choose('N', '1NT P 2C', 'QT9.KT92.94.AKQ6')).toEqual({ kind: 'double' });
    const rkcbAsk = auction('N', '1H P 3H P 4NT');
    expect(isArtificialBidAt(rkcbAsk, 4)).toBe(true);
    expect(choose('N', '1H P 3H P 4NT', 'QT9.KT92.94.AKQ6')).toEqual(PASS);
    const keyAnswer = observation('N', '1H P 3H P 4NT P 5C', poorClubs);
    expect(isArtificialBidAt(keyAnswer.auction, 6)).toBe(true);
    expect(chooseCompetitiveCall(keyAnswer, 'sayc')).toEqual(PASS);
    expect(chooseBid(keyAnswer, 'sayc')).toEqual(PASS);
    expect(choose('N', '1H P 3H P 4NT P 5C', 'QT9.KT92.94.AKQ6')).toEqual({ kind: 'double' });
    expect(isArtificialBidAt(auction('N', '1NT P 4NT'), 2)).toBe(false);
    expect(isArtificialBidAt(auction('N', '1NT P 4NT P 5C'), 4)).toBe(false);
    // A Stayman major answer shows real four-card length. A later raise
    // establishes that major, so 4NT changes from quantitative to RKCB.
    expect(isArtificialBidAt(auction('N', '1NT P 2C P 2H'), 4)).toBe(false);
    expect(isArtificialBidAt(auction('N', '1NT P 2C P 2H P 3H P 4NT'), 8)).toBe(true);
    expect(analyzeAuctionSemantics(auction('N', '1H P 2NT P'), 'N', 'sayc').forcing).toBe('game');
  });
  it('2687: a real strong jump over the current enemy contract creates persistent GF, not a fictitious jump over responder', () => {
    const strong = auction('W', '1C P 1D 1H 2S 3H');
    expect(analyzeAuctionSemantics(strong, 'E', 'sayc').forcing).toBe('game');
    expect(analyzeAuctionSemantics(auction('W', '1C P 1D 1H 2S 3H P P'), 'W', 'sayc').mustBid).toBe(true);
    expect(chooseBid(observation('W', '1C P 1D 1H 2S 3H P P', 'AKQ3.A943.-.AQT73'), 'sayc')).toEqual(bid(3, 'NT'));
    // 2S directly over 2H is cheapest, not a strength jump.
    expect(analyzeAuctionSemantics(auction('W', '1C P 1D 2H 2S P'), 'E', 'sayc').forcing).not.toBe('game');
  });
  it('2730: a forced cue answer may have only three cards, so four-card support cannot fabricate a fit', () => {
    const obs = observation('S', '2D X P 3D P 3S P', 'KQ87.AK62.J9.J72');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(4, 'S'));
    expect(chooseBid(obs, 'sayc')).not.toEqual(bid(4, 'S'));
  });
  it('five-card support confirms eight trumps opposite the three-card forced cue-answer minimum', () => {
    const obs = observation('S', '2D X P 3D P 3S P', 'KQ987.AK6.J9.J72');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'S'));
  });
  it('2718: an artificial two-minor intervention does not prevent showing a game-going five-card major', () => {
    expect(chooseBid(observation('S', 'P 1NT 2NT', 'QT3.AKJ65.982.83'), 'sayc')).toEqual(bid(3, 'H'));
  });
  it('2625: four top enemy trumps count as defensive winners, while short or weak trumps still reject penalty', () => {
    const prefix = 'P 1H X XX P P 1S P P';
    const strong = observation('E', prefix, 'AKQJ.QT762.T.QJ8');
    expect(chooseCompetitiveCall(strong, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(strong, 'sayc')).toEqual({ kind: 'double' });
    expect(choose('E', prefix, 'AK.QJT76.Q54.QJ8')).not.toEqual({ kind: 'double' });
    expect(choose('E', prefix, '9876.AKQJ2.A.876')).not.toEqual({ kind: 'double' });
  });
  it('2695 and forced cue NT answers: public ranges distinguish minimum passed-hand NT from voluntary strong NT', () => {
    expect(noTrumpRangeAt(auction('W', 'P P 1D P 2C P 2NT'), 6, 'sayc')).toEqual({ min: 12, max: 14 });
    expect(noTrumpRangeAt(auction('W', 'P P 1D P 2C P 3NT'), 6, 'sayc')).toEqual({ min: 18, max: 19 });
    expect(noTrumpRangeAt(auction('N', '1H X P 2H P 2NT'), 5, 'sayc')).toBeUndefined();
  });
});
