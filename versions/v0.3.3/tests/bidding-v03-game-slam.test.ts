import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { type BiddingSystem } from '../src/ai/systems';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, PASS } from '../src/core/types';

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
      return [...ranks, ...Array.from({ length: low }, (_, offset) => 10 - offset)]
        .map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })).concat(rest);
    }
    return null;
  };
  const cards = visit(0, target);
  if (!cards || cards.length !== 13) throw new Error(`Cannot construct ${shape.join('-')} with ${target} HCP`);
  expect(evaluateHand(cards).hcp).toBe(target);
  return cards;
}

function cards(...holdings: string[]): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const ranks = '23456789TJQKA';
  const result = holdings.flatMap((holding, index) => holding.split('').map(symbol => {
    const rank = ranks.indexOf(symbol) + 2;
    return { id: `${suits[index]}${rank}`, suit: suits[index], rank };
  }));
  if (result.length !== 13) throw new Error('Explicit hand must contain 13 cards');
  return result;
}

function observation(calls: Call[], testHand: Card[]): BiddingObservation {
  let game = newGame(1, 'v03-game-slam');
  for (const call of calls) game = applyCall(game, game.turn, call);
  const obs = observe(game) as BiddingObservation;
  obs.hand = testHand;
  return obs;
}

function expectBid(calls: Call[], shape: [number, number, number, number], hcp: number, expected: Call, system: BiddingSystem = 'two-over-one') {
  expect(chooseBid(observation(calls, hand(shape, hcp)), system)).toEqual(expected);
}

describe('v0.3 game and slam thresholds', () => {
  it('raises the reported 12-HCP 5-4 opener directly to 4H after a 2/1 response', () => {
    const north = cards('A9543', 'AT87', 'J63', 'K');
    expect(evaluateHand(north).hcp).toBe(12);
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(2, 'H'), PASS], north), 'two-over-one')).toEqual(bid(4, 'H'));
  });

  it.each([11, 12, 13, 14])('2/1 fast arrival: a minimum %i-HCP opener raises responder\'s major directly to game', hcp => {
    expectBid([bid(1, 'S'), PASS, bid(2, 'H'), PASS], [5, 4, 3, 1], hcp, bid(4, 'H'));
  });

  it.each([15, 16, 17, 18])('2/1 slow arrival: an extra-value %i-HCP opener leaves slam room at 3H', hcp => {
    expectBid([bid(1, 'S'), PASS, bid(2, 'H'), PASS], [5, 4, 3, 1], hcp, bid(3, 'H'));
  });

  it('does not launch RKCB after a minimum opener uses fast arrival in responder\'s major', () => {
    const south = cards('JT', 'KQ654', 'Q52', 'AQT');
    expect(evaluateHand(south).hcp).toBe(14);
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(2, 'H'), PASS, bid(4, 'H'), PASS], south), 'two-over-one')).toEqual(PASS);
  });

  it('treats a three-level major raise after a 2/1 response as extra values when responder evaluates slam', () => {
    const responder = cards('AQT', 'AKQJ6', 'KJ2', 'Q2');
    expect(evaluateHand(responder).hcp).toBe(22);
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(2, 'H'), PASS, bid(3, 'H'), PASS], responder), 'two-over-one')).toEqual(bid(4, 'NT'));
  });

  it('2/1 1NT: 25 combined points bid 3NT', () => {
    expectBid([bid(1, 'NT'), PASS], [3, 3, 4, 3], 10, bid(3, 'NT'));
  });

  it('2/1 1NT: 33 combined points bid 6NT', () => {
    expectBid([bid(1, 'NT'), PASS], [3, 3, 4, 3], 18, bid(6, 'NT'));
  });

  it('2/1 1NT: 37 combined points bid 7NT', () => {
    expectBid([bid(1, 'NT'), PASS], [3, 3, 4, 3], 22, bid(7, 'NT'));
  });

  it('Precision 1NT: 25 combined points bid 3NT', () => {
    expectBid([bid(1, 'NT'), PASS], [3, 3, 4, 3], 12, bid(3, 'NT'), 'precision');
  });

  it('Precision 1NT: 33 combined points bid 6NT', () => {
    expectBid([bid(1, 'NT'), PASS], [3, 3, 4, 3], 20, bid(6, 'NT'), 'precision');
  });

  it('Precision 1NT: 37 combined points bid 7NT', () => {
    expectBid([bid(1, 'NT'), PASS], [3, 3, 4, 3], 24, bid(7, 'NT'), 'precision');
  });

  it('2/1 2NT: 25 combined points bid 3NT', () => {
    expectBid([bid(2, 'NT'), PASS], [3, 3, 4, 3], 5, bid(3, 'NT'));
  });

  it('2/1 2NT: 33 combined points bid 6NT', () => {
    expectBid([bid(2, 'NT'), PASS], [3, 3, 4, 3], 13, bid(6, 'NT'));
  });

  it('2/1 2NT: 37 combined points bid 7NT', () => {
    expectBid([bid(2, 'NT'), PASS], [3, 3, 4, 3], 17, bid(7, 'NT'));
  });

  it('strong 2C then 2NT: 33 minimum combined points bid 6NT', () => {
    expectBid([bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'NT'), PASS], [3, 3, 4, 3], 11, bid(6, 'NT'));
  });

  it('strong 2C then 2NT: 37 minimum combined points bid 7NT', () => {
    expectBid([bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'NT'), PASS], [3, 3, 4, 3], 15, bid(7, 'NT'));
  });

  it('Precision strong club then 1NT: 33 minimum combined points bid 6NT', () => {
    expectBid([bid(1, 'C'), PASS, bid(1, 'D'), PASS, bid(1, 'NT'), PASS], [3, 3, 4, 3], 17, bid(6, 'NT'), 'precision');
  });

  it('Precision strong club then 1NT: 37 minimum combined points bid 7NT', () => {
    expectBid([bid(1, 'C'), PASS, bid(1, 'D'), PASS, bid(1, 'NT'), PASS], [3, 3, 4, 3], 21, bid(7, 'NT'), 'precision');
  });

  it('a 25-point major fit accepts a limit raise', () => {
    expectBid([bid(1, 'S'), PASS, bid(3, 'S'), PASS], [5, 3, 3, 2], 15, bid(4, 'S'));
  });

  it('a 25-point major fit still reaches game after competition', () => {
    expectBid([bid(1, 'S'), bid(2, 'H'), bid(3, 'S'), PASS], [5, 2, 3, 3], 15, bid(4, 'S'));
  });

  it('an established 2/1 game force survives later interference', () => {
    expectBid([bid(1, 'S'), PASS, bid(2, 'D'), bid(2, 'H')], [5, 2, 4, 2], 13, bid(5, 'D'));
  });

  it('a Precision positive response remains game forcing after interference', () => {
    expectBid([bid(1, 'C'), PASS, bid(1, 'S'), bid(2, 'H')], [3, 3, 4, 3], 16, bid(4, 'S'), 'precision');
  });

  it('Jacoby shortness sequence with 33 combined points continues with Blackwood', () => {
    expectBid([bid(1, 'S'), PASS, bid(2, 'NT'), PASS, bid(3, 'C'), PASS], [4, 3, 3, 3], 21, bid(4, 'NT'));
  });

  it('a 2/1 fit with 33 combined points continues with Blackwood', () => {
    expectBid([bid(1, 'S'), PASS, bid(2, 'D'), PASS, bid(2, 'S'), PASS], [3, 3, 4, 3], 21, bid(4, 'NT'));
  });

  it('a Precision positive five-card suit plus 25 HCP opener continues with Blackwood', () => {
    expectBid([bid(1, 'C'), PASS, bid(1, 'S'), PASS], [3, 3, 4, 3], 25, bid(4, 'NT'), 'precision');
  });

  it('a strong-2C suit rebid plus 11 HCP support continues with Blackwood', () => {
    expectBid([bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'S'), PASS], [3, 3, 4, 3], 11, bid(4, 'NT'));
  });

  it('RKCB answers 5C with one keycard (the trump king)', () => {
    const obs = observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS], cards('KQJ98', 'KQJ', 'QJ9', '98'));
    expect(chooseBid(obs)).toEqual(bid(5, 'C'));
  });

  it('RKCB also answers 5C with four keycards', () => {
    const obs = observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS], cards('A9876', 'A32', 'A54', 'A2'));
    expect(chooseBid(obs)).toEqual(bid(5, 'C'));
  });

  it('does not ask for a trump queen already in the asker\'s hand', () => {
    const obs = observation(
      [bid(1, 'S'), PASS, bid(2, 'NT'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS],
      cards('AKQ2', 'AKJ', 'QJ9', 'KJ9')
    );
    expect(evaluateHand(obs.hand).hcp).toBe(24);
    expect(chooseBid(obs)).toEqual(bid(6, 'S'));
  });

  it('three partner aces plus one own ace bid the small slam', () => {
    const obs = observation(
      [bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'S'), PASS],
      cards('AKQ98', 'KQJ', 'QJ9', '98')
    );
    expect(chooseBid(obs)).toEqual(bid(6, 'S'));
  });

  it('a 5C response is not guessed as 1 or 4: asker requests the trump queen', () => {
    const obs = observation(
      [bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS],
      cards('AKT98', 'A32', 'QJ9', '98')
    );
    expect(chooseBid(obs)).toEqual(bid(5, 'D'));
  });
});
