import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { newGame, applyCall } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Card, type Call, type Strain, type Suit, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });

function hand(shape: [number, number, number, number], target: number): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const ranks = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = ranks.reduce((sum, rank) => sum + rank - 10, 0);
      const low = shape[index] - ranks.length;
      if (low < 0 || low > 9 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (!rest) continue;
      return [...[...ranks, ...Array.from({ length: low }, (_, n) => 10 - n)].map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })), ...rest];
    }
    return null;
  };
  const cards = visit(0, target);
  if (!cards || cards.length !== 13) throw new Error(`Unconstructable ${shape}/${target} hand`);
  expect(evaluateHand(cards).hcp).toBe(target);
  return cards;
}

function observation(calls: Call[], shape: [number, number, number, number], hcp: number): BiddingObservation {
  let game = newGame(1, 'v03-bidding-semantics');
  for (const call of calls) game = applyCall(game, game.turn, call);
  const obs = observe(game) as BiddingObservation;
  obs.hand = hand(shape, hcp);
  return obs;
}

describe('v0.3 public auction semantics', () => {
  it('returns to opener\'s five-card major after 1M-1NT when the second suit is a singleton', () => {
    const calls = [PASS, PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS, bid(2, 'D'), PASS];
    const north = [
      ...'A7'.split('').map(symbol => ({ suit: 'S' as const, rank: '23456789TJQKA'.indexOf(symbol) + 2, id: `S${symbol}` })),
      ...'Q8632'.split('').map(symbol => ({ suit: 'H' as const, rank: '23456789TJQKA'.indexOf(symbol) + 2, id: `H${symbol}` })),
      { suit: 'D' as const, rank: 5, id: 'D5' },
      ...'AJT74'.split('').map(symbol => ({ suit: 'C' as const, rank: '23456789TJQKA'.indexOf(symbol) + 2, id: `C${symbol}` }))
    ];
    expect(evaluateHand(north).hcp).toBe(11);
    expect(chooseBid(observation(calls, [2, 5, 1, 5], 11), 'two-over-one')).toEqual(bid(2, 'S'));
    const obs = observation(calls, [2, 5, 1, 5], 11); obs.hand = north;
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'S'));
  });

  it.each([
    { opening: 'H' as const, rebid: 'C' as const, shape: [4, 2, 5, 2] as [number, number, number, number] },
    { opening: 'H' as const, rebid: 'D' as const, shape: [4, 2, 2, 5] as [number, number, number, number] },
    { opening: 'S' as const, rebid: 'C' as const, shape: [2, 4, 5, 2] as [number, number, number, number] },
    { opening: 'S' as const, rebid: 'D' as const, shape: [2, 4, 2, 5] as [number, number, number, number] },
    { opening: 'S' as const, rebid: 'H' as const, shape: [2, 2, 4, 5] as [number, number, number, number] }
  ])('uses false preference across 1$opening-1NT-2$rebid families', ({ opening, rebid, shape }) => {
    expect(chooseBid(observation([bid(1, opening), PASS, bid(1, 'NT'), PASS, bid(2, rebid), PASS], shape, 9), 'two-over-one')).toEqual(bid(2, opening));
  });

  it.each([
    { system: 'sayc' as const, rebid: 'C' as const, shape: [5, 2, 4, 2] as [number, number, number, number], hcp: 6 },
    { system: 'sayc' as const, rebid: 'C' as const, shape: [5, 2, 4, 2] as [number, number, number, number], hcp: 9 },
    { system: 'sayc' as const, rebid: 'D' as const, shape: [5, 2, 2, 4] as [number, number, number, number], hcp: 8 },
    { system: 'two-over-one' as const, rebid: 'C' as const, shape: [5, 2, 4, 2] as [number, number, number, number], hcp: 9 },
    { system: 'two-over-one' as const, rebid: 'D' as const, shape: [5, 2, 2, 4] as [number, number, number, number], hcp: 7 }
  ])('$system gives a two-card heart preference after 1H-1S-2$rebid with $hcp HCP and no minor fit', ({ system, rebid, shape, hcp }) => {
    const calls = [bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, rebid), PASS];
    expect(chooseBid(observation(calls, shape, hcp), system)).toEqual(bid(2, 'H'));
  });

  it('uses the fourth suit with the reported 11-HCP shape instead of passing opener\'s 2C rebid', () => {
    const calls = [bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, 'C'), PASS];
    expect(chooseBid(observation(calls, [5, 2, 4, 2], 11), 'sayc')).toEqual(bid(2, 'D'));
    expect(chooseBid(observation(calls, [5, 2, 4, 2], 11), 'two-over-one')).toEqual(bid(2, 'D'));
  });

  it('passes a weak hand with a real four-card fit for opener\'s low rebid', () => {
    const calls = [bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, 'D'), PASS];
    expect(chooseBid(observation(calls, [5, 2, 4, 2], 8), 'sayc')).toEqual(PASS);
  });

  it('invites in NT with a balanced ten points without assuming opener has four diamonds', () => {
    // A low minor rebid after 1M-1NT can be three cards. Four diamonds in
    // responder's hand do not by themselves establish an eight-card fit.
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(1, 'NT'), PASS, bid(2, 'D'), PASS], [2, 3, 4, 4], 10), 'two-over-one')).toEqual(bid(2, 'NT'));
  });

  it('uses the 18-19 opener rebid range: the reported 8-HCP hand raises 2NT to 3NT', () => {
    const calls = [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(2, 'NT'), PASS];
    expect(chooseBid(observation(calls, [5, 2, 3, 3], 8), 'two-over-one')).toEqual(bid(3, 'NT'));
  });

  it('keeps a strong 2C suit sequence forcing through the artificial 3C second negative', () => {
    const calls = [bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'H'), PASS, bid(3, 'C'), PASS];
    const obs = observation(calls, [2, 6, 3, 2], 22);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'two-over-one')).toMatchObject({ forcing: 'one-round', mustBid: true, currentContractArtificial: true });
    expect(chooseBid(obs, 'two-over-one')).toEqual(bid(3, 'H'));
  });

  it('does not use Stayman over 2NT below game, and never passes the artificial 3D answer', () => {
    expect(chooseBid(observation([bid(2, 'NT'), PASS], [4, 4, 3, 2], 4), 'two-over-one')).toEqual(PASS);
    const calls = [bid(2, 'NT'), PASS, bid(3, 'C'), PASS, bid(3, 'D'), PASS];
    const obs = observation(calls, [4, 4, 3, 2], 5);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'two-over-one')).toMatchObject({ mustBid: true, currentContractArtificial: true });
    expect(chooseBid(obs, 'two-over-one')).toEqual(bid(3, 'NT'));
  });

  it('restores the natural 1C-1D response', () => {
    expect(chooseBid(observation([bid(1, 'C'), PASS], [2, 2, 5, 4], 6), 'two-over-one')).toEqual(bid(1, 'D'));
  });

  it('keeps a strong-club response forcing through interference without raising artificial clubs', () => {
    const calls = [bid(1, 'C'), bid(1, 'S')];
    const positive = observation(calls, [2, 5, 3, 3], 8);
    expect(analyzeAuctionSemantics(positive.auction, positive.seat, 'precision')).toMatchObject({ forcing: 'one-round', convention: 'strong-opening', mustBid: true, currentContractArtificial: true });
    expect(chooseBid(positive, 'precision')).toEqual(bid(2, 'H'));
    expect(chooseBid(observation(calls, [3, 3, 4, 3], 0), 'precision')).toEqual({ kind: 'double' });
    const established = observation([...calls, bid(2, 'H'), PASS], [3, 3, 3, 4], 16);
    expect(analyzeAuctionSemantics(established.auction, established.seat, 'precision')).toMatchObject({ forcing: 'game', mustBid: true });
    expect(chooseBid(established, 'precision')).toEqual(bid(4, 'H'));
  });

  it('requires extras for a reverse but permits the same 2H rebid with 17 HCP', () => {
    const calls = [bid(1, 'D'), PASS, bid(1, 'S'), PASS];
    expect(chooseBid(observation(calls, [1, 4, 5, 3], 13), 'two-over-one')).toEqual(bid(2, 'D'));
    expect(chooseBid(observation(calls, [1, 4, 5, 3], 17), 'two-over-one')).toEqual(bid(2, 'H'));
    const forced = observation([...calls, bid(2, 'H'), PASS], [5, 2, 3, 3], 6);
    expect(analyzeAuctionSemantics(forced.auction, forced.seat, 'two-over-one')).toMatchObject({ forcing: 'one-round', convention: 'reverse', mustBid: true });
    expect(chooseBid(forced, 'two-over-one')).toEqual(bid(2, 'S'));
  });

  it('never treats the opponents suit as a natural five-card overcall', () => {
    expect(chooseBid(observation([bid(1, 'S')], [5, 2, 3, 3], 12), 'two-over-one')).toEqual(PASS);
  });

  it('uses the latest no-trump rebid range for quantitative 4NT', () => {
    const calls = [bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'NT'), PASS, bid(4, 'NT'), PASS];
    expect(chooseBid(observation(calls, [4, 3, 3, 3], 22), 'two-over-one')).toEqual(PASS);
    expect(chooseBid(observation(calls, [4, 3, 3, 3], 24), 'two-over-one')).toEqual(bid(6, 'NT'));
  });

  it('makes a descriptive 3D raise rather than leaping to 5D in a 2/1 game force', () => {
    const calls = [bid(1, 'S'), PASS, bid(2, 'D'), PASS];
    const obs = observation(calls, [5, 3, 4, 1], 12);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'two-over-one')).toMatchObject({ forcing: 'game', mustBid: true });
    expect(chooseBid(obs, 'two-over-one')).toEqual(bid(3, 'D'));
  });

  it('answers fourth-suit and new-minor forces instead of passing', () => {
    const fourthSuit = [bid(1, 'C'), PASS, bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, 'D'), PASS];
    const fourthObs = observation(fourthSuit, [4, 3, 1, 5], 12);
    expect(analyzeAuctionSemantics(fourthObs.auction, fourthObs.seat, 'two-over-one')).toMatchObject({ forcing: 'one-round', convention: 'fourth-suit', mustBid: true });
    expect(chooseBid(fourthObs, 'two-over-one')).toEqual(bid(2, 'H'));
    const newMinor = [bid(1, 'C'), PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS, bid(2, 'D'), PASS];
    const newMinorObs = observation(newMinor, [3, 2, 3, 5], 12);
    expect(analyzeAuctionSemantics(newMinorObs.auction, newMinorObs.seat, 'two-over-one')).toMatchObject({ forcing: 'one-round', convention: 'new-minor', mustBid: true });
    expect(chooseBid(newMinorObs, 'two-over-one')).toEqual(bid(2, 'S'));
  });

  it('continues after every precision 2D shape answer instead of stopping in an artificial strain', () => {
    for (const answer of ['D', 'H', 'S'] as const) {
      const calls = [bid(2, 'D'), PASS, bid(2, 'NT'), PASS, bid(3, answer), PASS];
      expect(chooseBid(observation(calls, [3, 3, 4, 3], 11), 'precision')).toEqual(bid(3, 'NT'));
    }
  });
});
