import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { countKeycards, evaluateSuitFit, hasTrumpQueen, rkcb1430Response } from '../src/ai/suit-evaluation';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });

function hand(shape: readonly [number, number, number, number], target: number): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === suits.length) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((sum, rank) => sum + rank - 10, 0);
      const low = shape[index] - honors.length;
      if (low < 0 || low > 9 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (!rest) continue;
      return [...honors, ...Array.from({ length: low }, (_, offset) => 10 - offset)]
        .map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })).concat(rest);
    }
    return null;
  };
  const result = visit(0, target);
  if (!result || result.length !== 13) throw new Error(`Cannot construct ${shape.join('-')} with ${target} HCP`);
  expect(evaluateHand(result).hcp).toBe(target);
  return result;
}

function keycardHand(keycards: number, queen: boolean, sideKing?: Suit): Card[] {
  const target: Record<Suit, number> = { S: 5, H: 3, D: 3, C: 2 };
  const selected: Record<Suit, number[]> = { S: [], H: [], D: [], C: [] };
  const keycardRanks: [Suit, number][] = [['S', 13], ['S', 14], ['H', 14], ['D', 14], ['C', 14]];
  for (const [suit, rank] of keycardRanks.slice(0, keycards)) selected[suit].push(rank);
  if (queen) selected.S.push(12);
  if (sideKing && sideKing !== 'S') selected[sideKing].push(13);
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    for (let rank = 2; selected[suit].length < target[suit]; rank++) if (!selected[suit].includes(rank)) selected[suit].push(rank);
  }
  return (['S', 'H', 'D', 'C'] as Suit[]).flatMap(suit => selected[suit].map(rank => ({ id: `${suit}${rank}`, suit, rank })));
}

function explicitHand(...holdings: string[]): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C']; const ranks = '23456789TJQKA';
  const result = holdings.flatMap((holding, index) => holding.split('').map(symbol => ({ id: `${suits[index]}${ranks.indexOf(symbol) + 2}`, suit: suits[index], rank: ranks.indexOf(symbol) + 2 })));
  if (result.length !== 13) throw new Error('Explicit hand must contain 13 cards');
  return result;
}

function observation(calls: Call[], testHand: Card[]): BiddingObservation {
  let game = newGame(1, 'v03-fit-rkcb');
  for (const call of calls) game = applyCall(game, game.turn, call);
  const result = observe(game) as BiddingObservation;
  result.hand = testHand;
  return result;
}

describe('v0.3 suit-contract adjustment points', () => {
  it.each([
    { shape: [5, 3, 3, 2] as const, partner: 3, short: 1, extra: 0, label: 'doubleton = 1' },
    { shape: [5, 4, 3, 1] as const, partner: 3, short: 3, extra: 0, label: 'singleton with four-plus trumps = 3' },
    { shape: [3, 5, 4, 1] as const, partner: 5, short: 2, extra: 0, label: 'singleton with three trumps = 2' },
    { shape: [5, 4, 4, 0] as const, partner: 3, short: 4, extra: 0, label: 'void = 4' },
    { shape: [6, 3, 3, 1] as const, partner: 3, short: 3, extra: 1, label: 'ninth known trump = 1 extra' },
    { shape: [7, 3, 2, 1] as const, partner: 3, short: 4, extra: 2, label: 'tenth known trump adds another point' }
  ])('$label', ({ shape, partner, short, extra }) => {
    const testHand = hand(shape, 10);
    expect(evaluateSuitFit(testHand, 'S', partner)).toMatchObject({ hcp: 10, shortnessPoints: short, extraTrumpPoints: extra, adjustmentPoints: short + extra, totalPoints: 10 + short + extra });
  });

  it('does not count shortness before an eight-card fit is publicly known', () => {
    expect(evaluateSuitFit(hand([5, 4, 4, 0], 10), 'S', 2)).toMatchObject({ adjustmentPoints: 0, totalPoints: 10, knownCombinedTrumps: 7 });
  });

  it('uses adjusted points for simple, limit and game-forcing major raises', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS], hand([3, 4, 4, 2], 8)))).toEqual(bid(2, 'S'));
    expect(chooseBid(observation([bid(1, 'S'), PASS], hand([3, 4, 4, 2], 9)))).toEqual(bid(3, 'S'));
    expect(chooseBid(observation([bid(1, 'S'), PASS], hand([4, 4, 4, 1], 9)))).toEqual(bid(2, 'NT'));
  });

  it('accepts a limit raise when shortness and the ninth trump lift an 11-HCP opener above the game boundary', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS], hand([6, 4, 3, 0], 11)))).toEqual(bid(4, 'S'));
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS], hand([5, 3, 3, 2], 13)))).toEqual(PASS);
  });

  it('uses the same fit evaluator for weak-two raises and natural minor support', () => {
    // Ten HCP plus shortness does not guarantee game opposite a public five-point weak two.
    expect(chooseBid(observation([bid(2, 'S'), PASS], hand([4, 4, 4, 1], 10)))).toEqual(bid(3, 'S'));
    expect(chooseBid(observation([bid(1, 'D'), PASS], hand([2, 2, 5, 4], 8)))).toEqual(bid(3, 'D'));
    expect(chooseBid(observation([bid(1, 'D'), PASS], hand([2, 2, 5, 4], 8)), 'precision')).toEqual(bid(2, 'D'));
  });

  const raiseShapes = [
    [3, 4, 3, 3], [3, 5, 4, 1], [3, 6, 4, 0],
    [4, 3, 3, 3], [4, 4, 4, 1], [4, 5, 4, 0],
    [5, 3, 3, 2], [5, 4, 3, 1], [5, 4, 4, 0],
    [6, 3, 3, 1], [6, 4, 2, 1], [6, 4, 3, 0]
  ] as const;
  const raiseCases = raiseShapes.flatMap(shape => [6, 8, 10, 12].map(hcp => ({ shape, hcp })));
  it.each(raiseCases)('direct 1S raise matrix: $shape with $hcp HCP follows adjusted points', ({ shape, hcp }) => {
    const testHand = hand(shape, hcp);
    const adjusted = evaluateSuitFit(testHand, 'S', 5).totalPoints;
    const expected = shape[0] >= 4 && adjusted >= 13 ? bid(2, 'NT') : adjusted >= 13 ? bid(4, 'S') : adjusted >= 10 ? bid(3, 'S') : bid(2, 'S');
    expect(chooseBid(observation([bid(1, 'S'), PASS], testHand))).toEqual(expected);
  });
});

describe('v0.3 RKCB 1430 and trump-queen inquiry', () => {
  it.each([
    { keycards: 0, queen: false, answer: bid(5, 'D') },
    { keycards: 1, queen: false, answer: bid(5, 'C') },
    { keycards: 2, queen: false, answer: bid(5, 'H') },
    { keycards: 2, queen: true, answer: bid(5, 'S') },
    { keycards: 3, queen: false, answer: bid(5, 'D') },
    { keycards: 4, queen: false, answer: bid(5, 'C') },
    { keycards: 5, queen: false, answer: bid(5, 'H') },
    { keycards: 5, queen: true, answer: bid(5, 'S') }
  ])('$keycards keycards, queen=$queen -> $answer', ({ keycards, queen, answer }) => {
    const testHand = keycardHand(keycards, queen);
    expect(countKeycards(testHand, 'S')).toBe(keycards);
    expect(hasTrumpQueen(testHand, 'S')).toBe(queen);
    expect(rkcb1430Response(keycards, queen)).toEqual(answer);
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS], testHand))).toEqual(answer);
  });

  it('uses the next step over 5C and 5D to ask for the trump queen', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS], keycardHand(3, false)))).toEqual(bid(5, 'D'));
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'D'), PASS], keycardHand(4, false)))).toEqual(bid(5, 'H'));
  });

  it('signs off safely instead of asking for the queen while two or more keycards may be missing', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS], keycardHand(2, false)))).toEqual(bid(5, 'S'));
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'D'), PASS], keycardHand(3, false)))).toEqual(bid(5, 'S'));
  });

  it('answers the queen inquiry by signing off without Q, bidding six of trumps with Q, or showing a side king below six of trumps', () => {
    const overFiveClubs = [bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS, bid(5, 'D'), PASS];
    expect(chooseBid(observation(overFiveClubs, keycardHand(1, false)))).toEqual(bid(5, 'S'));
    expect(chooseBid(observation(overFiveClubs, keycardHand(1, true)))).toEqual(bid(6, 'S'));
    expect(chooseBid(observation(overFiveClubs, keycardHand(1, true, 'H')))).toEqual(bid(6, 'H'));
    const overFiveDiamonds = [bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'D'), PASS, bid(5, 'H'), PASS];
    expect(chooseBid(observation(overFiveDiamonds, keycardHand(3, false)))).toEqual(bid(5, 'S'));
    expect(chooseBid(observation(overFiveDiamonds, keycardHand(3, true)))).toEqual(bid(6, 'S'));
  });

  it('returns to the agreed trump after a queen-and-side-king response', () => {
    const asker = explicitHand('AKJ98', 'A32', 'QJ9', 'K8');
    const auction = [
      bid(1, 'S'), PASS, bid(2, 'D'), PASS, bid(2, 'H'), PASS, bid(4, 'S'), PASS,
      bid(4, 'NT'), PASS, bid(5, 'C'), PASS, bid(5, 'D'), PASS, bid(6, 'H'), PASS
    ];
    expect(chooseBid(observation(auction, asker), 'sayc')).toEqual(bid(6, 'S'));
  });

  it('uses 5NT to ask for side kings only when all five keycards and the trump queen are known', () => {
    const asker = explicitHand('AKQJ9', 'AKQ', 'KQJ', 'KQ');
    expect(countKeycards(asker, 'S')).toBe(3); expect(hasTrumpQueen(asker, 'S')).toBe(true);
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'S'), PASS], asker))).toEqual(bid(5, 'NT'));
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'H'), PASS], keycardHand(2, false)))).not.toEqual(bid(5, 'NT'));
  });

  it('answers 5NT with the cheapest side king and never repeats the trump king', () => {
    const auction = [bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'S'), PASS, bid(5, 'NT'), PASS];
    expect(chooseBid(observation(auction, keycardHand(2, true, 'H')))).toEqual(bid(6, 'H'));
    expect(chooseBid(observation(auction, keycardHand(2, true)))).toEqual(bid(6, 'S'));
    expect(chooseBid(observation(auction, explicitHand('AKQ98', 'K32', 'KJ9', 'K8')))).toEqual(bid(6, 'C'));
  });

  it('signs off in six after a no-side-king answer and bids the grand slam after a shown king', () => {
    const asker = explicitHand('AKQJ9', 'AKQ', 'KQJ', 'KQ');
    const prefix = [bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS, bid(5, 'S'), PASS, bid(5, 'NT'), PASS];
    expect(chooseBid(observation([...prefix, bid(6, 'S'), PASS], asker))).toEqual(PASS);
    expect(chooseBid(observation([...prefix, bid(6, 'H'), PASS], asker))).toEqual(bid(7, 'S'));
  });
});
