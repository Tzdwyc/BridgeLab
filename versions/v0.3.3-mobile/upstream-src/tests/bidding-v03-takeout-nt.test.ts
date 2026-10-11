import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { applyCall, newGame, newGameFromDeal } from '../src/core/game';
import { type Call, type Card, type Hands, type Strain, type Suit, PASS } from '../src/core/types';

const rankSymbols = '23456789TJQKA';

function holding(spades: string, hearts: string, diamonds: string, clubs: string): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const cards = [spades, hearts, diamonds, clubs].flatMap((text, suitIndex) => [...text].map(symbol => {
    const rank = rankSymbols.indexOf(symbol) + 2;
    if (rank < 2) throw new Error(`Bad rank ${symbol}`);
    return { id: `${suits[suitIndex]}${rank}`, suit: suits[suitIndex], rank };
  }));
  if (cards.length !== 13) throw new Error('Hand must contain 13 cards');
  return cards;
}

const reportedHands: Hands = {
  S: holding('Q5', 'AKJ87', 'JT96', 'J3'),
  W: holding('KT43', 'Q2', 'A43', 'KT85'),
  N: holding('AJ762', '5', 'K752', 'A96'),
  E: holding('98', 'T9643', 'Q8', 'Q742')
};

const label = (call: Call): string => call.kind === 'pass' ? 'P' : call.kind === 'double' ? 'X' : call.kind === 'redouble' ? 'XX' : `${call.level}${call.strain}`;
const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const DOUBLE: Call = { kind: 'double' };
const REDOUBLE: Call = { kind: 'redouble' };

function syntheticHand(shape: readonly [number, number, number, number], target: number): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((sum, rank) => sum + rank - 10, 0);
      const low = shape[index] - honors.length;
      if (low < 0 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (rest) return [...honors, ...Array.from({ length: low }, (_, n) => 10 - n)]
        .map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })).concat(rest);
    }
    return null;
  };
  const result = visit(0, target);
  if (!result || result.length !== 13) throw new Error(`Cannot construct ${shape.join('-')}/${target}`);
  return result;
}

function observation(calls: Call[], hand: Card[]): BiddingObservation {
  let game = newGame(1, 'takeout-nt-matrix');
  for (const call of calls) game = applyCall(game, game.turn, call);
  return { ...(observe(game) as BiddingObservation), hand };
}

describe('SAYC takeout-doubler no-trump continuations', () => {
  it('keeps the reported 12-HCP doubler out of invented 2NT and 3NT contracts', () => {
    expect(evaluateHand(reportedHands.W).hcp).toBe(12);
    let game = newGameFromDeal(1, 'reported-takeout-nt', reportedHands, 'S', 'None');
    const prefix: Call[] = [bid(1, 'H'), DOUBLE, REDOUBLE, bid(2, 'C'), bid(2, 'D')];
    for (const call of prefix) game = applyCall(game, game.turn, call);
    expect(chooseCompetitiveCall(observe(game) as BiddingObservation, 'sayc')).toEqual({ kind: 'pass' });
    game = applyCall(game, game.turn, chooseBid(observe(game) as BiddingObservation, 'sayc'));
    game = applyCall(game, game.turn, bid(3, 'D'));
    while (game.phase === 'auction') game = applyCall(game, game.turn, chooseBid(observe(game) as BiddingObservation, 'sayc'));
    expect(game.auction.map(entry => label(entry.call))).toEqual(['1H', 'X', 'XX', '2C', '2D', 'P', '3D', 'P', 'P', 'P']);
  });

  it.each([
    { hcp: 12, shape: [4, 3, 3, 3] as const },
    { hcp: 15, shape: [4, 3, 3, 3] as const },
    { hcp: 17, shape: [5, 3, 3, 2] as const }
  ])('does not invent no-trump after a weak forced response with $hcp HCP and $shape', ({ hcp, shape }) => {
    const call = chooseBid(observation([bid(1, 'H'), DOUBLE, REDOUBLE, bid(2, 'C'), bid(2, 'D')], syntheticHand(shape, hcp)), 'sayc');
    expect(call.kind !== 'bid' || call.strain !== 'NT').toBe(true);
  });

  it('does not compound an earlier bad 2NT by raising itself to 3NT', () => {
    const calls = [bid(1, 'H'), DOUBLE, REDOUBLE, bid(2, 'C'), bid(2, 'D'), bid(2, 'NT'), bid(3, 'D'), PASS, PASS];
    expect(chooseBid(observation(calls, reportedHands.W), 'sayc')).toEqual(PASS);
  });

  it('requires 18-20 HCP, all enemy stoppers and a non-weak partner action for a takeout-double NT rebid', () => {
    const stopped18 = holding('AK3', 'AQ2', 'KJ4', 'J985');
    const stopped17 = holding('AK3', 'AQ2', 'KJ4', 'T985');
    const missingHeartStop18 = holding('AKQ', '982', 'AQ3', 'QJ94');
    expect(evaluateHand(stopped18)).toMatchObject({ hcp: 18, balanced: true });
    expect(evaluateHand(stopped17)).toMatchObject({ hcp: 17, balanced: true });
    expect(evaluateHand(missingHeartStop18)).toMatchObject({ hcp: 18, balanced: true });
    expect(chooseBid(observation([bid(1, 'H'), DOUBLE, PASS, bid(2, 'S'), bid(3, 'H')], stopped18), 'sayc')).toEqual(bid(3, 'NT'));
    expect(chooseBid(observation([bid(1, 'H'), DOUBLE, PASS, bid(2, 'H'), PASS], stopped17), 'sayc')).not.toEqual(bid(2, 'NT'));
    expect(chooseBid(observation([bid(1, 'H'), DOUBLE, PASS, bid(2, 'H'), PASS], missingHeartStop18), 'sayc')).not.toEqual(bid(2, 'NT'));
    expect(chooseBid(observation([bid(1, 'H'), DOUBLE, REDOUBLE, bid(2, 'C'), bid(2, 'D')], holding('AK3', 'AQ2', 'KJ4', 'Q985')), 'sayc')).toEqual(PASS);
  });
});

describe('SAYC Rule of 20 opening boundary', () => {
  it('opens the reported 12-HCP 5-3-3-2 hand one heart', () => {
    const north = holding('AT2', 'AT652', 'AT8', '76');
    expect(evaluateHand(north)).toMatchObject({ hcp: 12, balanced: true });
    expect(chooseBid(observation([], north), 'sayc')).toEqual(bid(1, 'H'));
  });

  it.each([
    { hcp: 12, shape: [5, 3, 3, 2] as const, opens: true },
    { hcp: 12, shape: [4, 4, 3, 2] as const, opens: true },
    { hcp: 12, shape: [6, 3, 2, 2] as const, opens: true },
    { hcp: 12, shape: [4, 3, 3, 3] as const, opens: false },
    { hcp: 11, shape: [6, 4, 2, 1] as const, opens: false },
    { hcp: 13, shape: [4, 3, 3, 3] as const, opens: true }
  ])('$hcp HCP with $shape has opens=$opens', ({ hcp, shape, opens }) => {
    const call = chooseBid(observation([], syntheticHand(shape, hcp)), 'sayc');
    expect(call.kind === 'bid').toBe(opens);
    if (!opens) expect(call).toEqual(PASS);
  });
});
