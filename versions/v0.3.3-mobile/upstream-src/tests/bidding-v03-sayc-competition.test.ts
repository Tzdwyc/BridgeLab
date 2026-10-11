import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { applyCall, newGame, newGameFromDeal } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Hands, type Strain, type Suit, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const DOUBLE: Call = { kind: 'double' };

function hand(shape: readonly [number, number, number, number], target: number): Card[] {
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
  expect(evaluateHand(result).hcp).toBe(target);
  return result;
}

function holdings(spades: string, hearts: string, diamonds: string, clubs: string): Card[] {
  const ranks = '23456789TJQKA'; const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const result = [spades, hearts, diamonds, clubs].flatMap((holding, index) => holding.split('').map(symbol => {
    const rank = ranks.indexOf(symbol) + 2;
    if (rank < 2) throw new Error(`Bad rank ${symbol}`);
    return { id: `${suits[index]}${rank}`, suit: suits[index], rank };
  }));
  if (result.length !== 13) throw new Error('Explicit hand must contain 13 cards');
  return result;
}

function observation(calls: Call[], testHand: Card[]): BiddingObservation {
  let game = newGame(1, 'v03-sayc-competition');
  for (const call of calls) game = applyCall(game, game.turn, call);
  const obs = observe(game) as BiddingObservation;
  obs.hand = testHand;
  return obs;
}

const decide = (calls: Call[], shape: readonly [number, number, number, number], hcp: number) =>
  chooseBid(observation(calls, hand(shape, hcp)), 'sayc');

describe('SAYC direct natural competition', () => {
  it.each([8, 12, 16])('uses a simple five-card overcall with %i HCP', hcp => {
    const testHand = hcp === 8 ? holdings('KJ987', 'Q765', '432', 'Q')
      : hcp === 12 ? holdings('AQ987', 'K765', '432', 'K') : holdings('AKQ98', 'A765', '432', 'K');
    expect(evaluateHand(testHand).hcp).toBe(hcp);
    expect(chooseBid(observation([bid(1, 'D')], testHand), 'sayc')).toEqual(bid(1, 'S'));
  });

  it('passes below the simple-overcall floor and doubles before showing a 17-point long suit', () => {
    expect(decide([bid(1, 'D')], [5, 4, 3, 1], 7)).toEqual(PASS);
    expect(decide([bid(1, 'D')], [5, 4, 3, 1], 17)).toEqual(DOUBLE);
  });

  it('uses 1NT only with 15-18 balanced and a stopper', () => {
    const stopped = holdings('AKJ', 'QJ9', 'A73', 'T984');
    const unstopped = holdings('AKJ', 'AQ9', '873', 'J984');
    expect(evaluateHand(stopped).hcp).toBe(15);
    expect(evaluateHand(unstopped).hcp).toBe(15);
    expect(chooseBid(observation([bid(1, 'D')], stopped), 'sayc')).toEqual(bid(1, 'NT'));
    expect(chooseBid(observation([bid(1, 'D')], unstopped), 'sayc')).not.toEqual(bid(1, 'NT'));
  });

  it('uses a weak jump overcall with a six-card suit and 6-10 HCP', () => {
    const sixSpades = holdings('AQ9876', '43', '52', '732');
    expect(evaluateHand(sixSpades).hcp).toBe(6);
    expect(chooseBid(observation([bid(1, 'D')], sixSpades), 'sayc')).toEqual(bid(2, 'S'));
    const sevenHearts = holdings('A2', 'KQ98743', '65', '84');
    expect(evaluateHand(sevenHearts).hcp).toBe(9);
    expect(chooseBid(observation([bid(1, 'S')], sevenHearts), 'sayc')).toEqual(bid(3, 'H'));
  });

  it('does not use a three-level jump overcall with only six cards', () => {
    const sixHearts = holdings('A32', 'KQ9874', '65', '84');
    expect(evaluateHand(sixHearts).hcp).toBe(9);
    expect(chooseBid(observation([bid(1, 'S')], sixHearts), 'sayc')).toEqual(PASS);
  });

  it('requires sounder values for a non-jump two-level overcall', () => {
    expect(decide([bid(1, 'S')], [3, 5, 3, 2], 9)).toEqual(PASS);
    expect(chooseBid(observation([bid(1, 'S')], holdings('876', 'KQJ98', 'A76', '54')), 'sayc')).toEqual(bid(2, 'H'));
  });

  it('recognizes the same direct competition after one or two opening passes', () => {
    expect(chooseBid(observation([PASS, bid(1, 'D')], holdings('AQ987', 'K765', '432', 'K')), 'sayc')).toEqual(bid(1, 'S'));
    expect(decide([PASS, PASS, bid(1, 'C')], [5, 5, 2, 1], 8)).toEqual(bid(2, 'C'));
  });
});

describe('SAYC Michaels cuebids and Unusual 2NT', () => {
  it('cuebids a minor with both majors and a major with the other major plus a minor', () => {
    expect(decide([bid(1, 'C')], [5, 5, 2, 1], 8)).toEqual(bid(2, 'C'));
    expect(decide([bid(1, 'D')], [5, 5, 1, 2], 10)).toEqual(bid(2, 'D'));
    expect(decide([bid(1, 'H')], [5, 1, 5, 2], 10)).toEqual(bid(2, 'H'));
    expect(decide([bid(1, 'S')], [1, 5, 2, 5], 10)).toEqual(bid(2, 'S'));
  });

  it('uses 2NT for the two lowest unbid suits', () => {
    expect(decide([bid(1, 'S')], [1, 2, 5, 5], 9)).toEqual(bid(2, 'NT'));
    expect(decide([bid(1, 'D')], [2, 5, 1, 5], 9)).toEqual(bid(2, 'NT'));
  });

  it('advancer selects a shown major or asks for the unknown minor', () => {
    expect(decide([bid(1, 'C'), bid(2, 'C'), PASS], [3, 4, 3, 3], 4)).toEqual(bid(2, 'H'));
    expect(decide([bid(1, 'H'), bid(2, 'H'), PASS], [2, 3, 4, 4], 7)).toEqual(bid(2, 'NT'));
    expect(decide([bid(1, 'H'), bid(2, 'H'), PASS, bid(2, 'NT'), PASS], [5, 1, 5, 2], 10)).toEqual(bid(3, 'D'));
  });

  it('advancer chooses the longer of the two suits shown by Unusual 2NT', () => {
    expect(decide([bid(1, 'S'), bid(2, 'NT'), PASS], [3, 2, 5, 3], 5)).toEqual(bid(3, 'D'));
  });

  it('removes a doubled Michaels cuebid in the reported deal instead of passing 2H doubled', () => {
    const hands: Hands = {
      N: holdings('53', 'Q32', 'AKJT9', '852'),
      E: holdings('986', 'J8', '6', 'KJT9763'),
      S: holdings('AQ2', 'A97654', '73', 'Q4'),
      W: holdings('KJT74', 'KT', 'Q8542', 'A')
    };
    let game = newGameFromDeal(11, 'v031-reported-doubled-michaels', hands, 'S', 'Both');
    for (const call of [bid(1, 'H'), bid(2, 'H'), DOUBLE]) game = applyCall(game, game.turn, call);
    expect(game.turn).toBe('E');
    expect(analyzeAuctionSemantics(game.auction, game.turn, 'sayc')).toMatchObject({
      forcing: 'one-round',
      convention: 'michaels-advance',
      mustBid: true,
      currentContractArtificial: true
    });
    const call = chooseBid(observe(game) as BiddingObservation, 'sayc');
    expect(call).toEqual(bid(2, 'S'));
    expect(describeCall(game.auction, game.turn, call, 'sayc')).toContain('人工扣叫被加倍后仍不得Pass');
  });
});

describe('SAYC doubles and cuebid responses', () => {
  it('makes shape and strong-hand takeout doubles', () => {
    expect(decide([bid(1, 'D')], [4, 4, 1, 4], 13)).toEqual(DOUBLE);
    expect(decide([bid(1, 'D')], [5, 4, 3, 1], 17)).toEqual(DOUBLE);
  });

  it('separates weak, invitational and forcing responses to a takeout double', () => {
    expect(decide([bid(1, 'D'), DOUBLE, PASS], [3, 5, 2, 3], 0)).toEqual(bid(1, 'H'));
    expect(decide([bid(1, 'D'), DOUBLE, PASS], [3, 5, 2, 3], 9)).toEqual(bid(2, 'H'));
    expect(decide([bid(1, 'D'), DOUBLE, PASS], [3, 4, 2, 4], 12)).toEqual(bid(2, 'D'));
  });

  it('lets a strong doubler show the long suit on the next round', () => {
    expect(decide([bid(1, 'D'), DOUBLE, PASS, bid(1, 'H'), PASS], [5, 3, 2, 3], 17)).toEqual(bid(1, 'S'));
  });

  it('uses negative doubles through 2S and bids a five-card one-level major naturally', () => {
    expect(decide([bid(1, 'D'), bid(1, 'H')], [4, 3, 3, 3], 6)).toEqual(DOUBLE);
    expect(decide([bid(1, 'D'), bid(1, 'H')], [5, 2, 3, 3], 6)).toEqual(bid(1, 'S'));
    expect(decide([bid(1, 'D'), bid(1, 'S')], [2, 5, 3, 3], 10)).toEqual(bid(2, 'H'));
    expect(decide([bid(1, 'D'), bid(1, 'S')], [3, 4, 3, 3], 8)).toEqual(DOUBLE);
    expect(decide([bid(1, 'D'), bid(2, 'S')], [3, 4, 3, 3], 8)).toEqual(DOUBLE);
    // Three-card support and a weak hand can make the direct simple raise;
    // do not require a negative double merely because both minors are four.
    expect(decide([bid(1, 'H'), bid(1, 'S')], [2, 3, 4, 4], 6)).toEqual(bid(2, 'H'));
  });

  it('forces to game over a three-level jump and reaches the cold minor slam from the reported deal', () => {
    const west = holdings('AK972', 'QT2', 'KQT', 'T6');
    const east = holdings('', 'AKJ8', '63', 'AKQ8742');
    expect(evaluateHand(west).hcp).toBe(14); expect(evaluateHand(east).hcp).toBe(17);
    expect(chooseBid(observation([bid(1, 'C'), bid(3, 'S')], west), 'sayc')).toEqual(bid(3, 'NT'));
    expect(chooseBid(observation([bid(1, 'C'), bid(3, 'S'), bid(3, 'NT'), PASS], east), 'sayc')).toEqual(bid(4, 'C'));
    expect(chooseBid(observation([bid(1, 'C'), bid(3, 'S'), bid(3, 'NT'), PASS, bid(4, 'C'), PASS], west), 'sayc')).toEqual(bid(4, 'NT'));
    expect(chooseBid(observation([bid(1, 'C'), bid(3, 'S'), bid(3, 'NT'), PASS, bid(4, 'C'), PASS, bid(4, 'NT'), PASS], east), 'sayc')).toEqual(bid(5, 'D'));
    expect(chooseBid(observation([bid(1, 'C'), bid(3, 'S'), bid(3, 'NT'), PASS, bid(4, 'C'), PASS, bid(4, 'NT'), PASS, bid(5, 'D'), PASS], west), 'sayc')).toEqual(bid(6, 'C'));
  });

  it('does not pass game-going hands after partner opens and RHO preempts at the three level', () => {
    const stopped = holdings('AQ3', 'KJ4', 'Q982', 'J76');
    const noStopper = holdings('Q32', 'AKJ54', 'A82', '76');
    expect(evaluateHand(stopped).hcp).toBe(13); expect(evaluateHand(noStopper).hcp).toBe(14);
    expect(chooseBid(observation([bid(1, 'D'), bid(3, 'H')], stopped), 'sayc')).toEqual(bid(3, 'NT'));
    expect(chooseBid(observation([bid(1, 'C'), bid(3, 'S')], noStopper), 'sayc')).not.toEqual(PASS);
  });

  it('uses a forcing new suit over partner preempt and explores the reported diamond slam', () => {
    const west = holdings('4', '', 'AJT9874', 'K9543');
    const east = holdings('AQ', 'KQJ543', 'K5', 'AT2');
    expect(evaluateHand(west).hcp).toBe(8); expect(evaluateHand(east).hcp).toBe(19);
    expect(chooseBid(observation([], west), 'sayc')).toEqual(bid(3, 'D'));
    expect(chooseBid(observation([bid(3, 'D'), PASS], east), 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(observation([bid(3, 'D'), PASS, bid(3, 'H'), PASS], west), 'sayc')).toEqual(bid(4, 'D'));
    expect(chooseBid(observation([bid(3, 'D'), PASS, bid(3, 'H'), PASS, bid(4, 'D'), PASS], east), 'sayc')).toEqual(bid(4, 'NT'));
    expect(chooseBid(observation([bid(3, 'D'), PASS, bid(3, 'H'), PASS, bid(4, 'D'), PASS, bid(4, 'NT'), PASS], west), 'sayc')).toEqual(bid(5, 'C'));
    expect(chooseBid(observation([bid(3, 'D'), PASS, bid(3, 'H'), PASS, bid(4, 'D'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS], east), 'sayc')).toEqual(bid(5, 'D'));
    expect(chooseBid(observation([bid(3, 'D'), PASS, bid(3, 'H'), PASS, bid(4, 'D'), PASS, bid(4, 'NT'), PASS, bid(5, 'C'), PASS, bid(5, 'D'), PASS], west), 'sayc')).toEqual(bid(6, 'D'));
  });

  it('uses opener cuebid as the only forcing response to a natural overcall', () => {
    expect(decide([bid(1, 'D'), bid(1, 'S'), PASS], [3, 3, 4, 3], 10)).toEqual(bid(2, 'D'));
    expect(decide([bid(1, 'D'), bid(1, 'S'), PASS, bid(2, 'D'), PASS], [5, 3, 2, 3], 8)).toEqual(bid(2, 'S'));
    expect(decide([bid(1, 'D'), bid(1, 'S'), PASS, bid(2, 'D'), PASS], [5, 4, 1, 3], 13)).toEqual(bid(2, 'H'));
  });

  it('redoubles with 10+ after an opposing takeout double and otherwise bids naturally', () => {
    expect(decide([bid(1, 'S'), DOUBLE], [3, 3, 4, 3], 10)).toEqual({ kind: 'redouble' });
    expect(decide([bid(1, 'S'), DOUBLE], [3, 4, 3, 3], 7)).toEqual(bid(2, 'S'));
  });

  it('does not misread an opposing Michaels or Unusual 2NT call as a negative double situation', () => {
    expect(decide([bid(1, 'S'), bid(2, 'S')], [3, 3, 4, 3], 10)).toEqual(DOUBLE);
    expect(decide([bid(1, 'H'), bid(2, 'NT')], [3, 3, 4, 3], 10)).toEqual(DOUBLE);
  });
});

describe('SAYC preempts and defenses', () => {
  it('opens seven-card suits at the three level and six-card red suits with a weak two', () => {
    expect(decide([], [7, 2, 2, 2], 7)).toEqual(bid(3, 'S'));
    const weakHearts = holdings('43', 'KQ9876', '532', '84');
    expect(evaluateHand(weakHearts).hcp).toBe(5);
    expect(chooseBid(observation([], weakHearts), 'sayc')).toEqual(bid(2, 'H'));
    expect(decide([], [2, 2, 2, 7], 8)).toEqual(bid(3, 'C'));
  });

  it('requires reasonable suit quality for a weak two and uses four-level preempts with eight cards', () => {
    const poorHearts = holdings('AKQ', '987654', '32', '98');
    expect(evaluateHand(poorHearts).hcp).toBe(9);
    expect(chooseBid(observation([], poorHearts), 'sayc')).toEqual(PASS);
    expect(decide([], [8, 2, 2, 1], 8)).toEqual(bid(4, 'S'));
  });

  it('defends a weak two with 2NT, takeout double or a sound natural overcall', () => {
    const stopped = holdings('AKJ', 'A73', 'QJ9', 'T984');
    expect(chooseBid(observation([bid(2, 'H')], stopped), 'sayc')).toEqual(bid(2, 'NT'));
    expect(decide([bid(2, 'H')], [4, 1, 4, 4], 13)).toEqual(DOUBLE);
    // The shape/HCP generator puts every honor outside spades: T9876 is not a sound overcall.
    expect(decide([bid(2, 'H')], [5, 3, 3, 2], 12)).toEqual(PASS);
    const soundSpades = holdings('KQJ98', 'AQ9', '432', '87');
    expect(evaluateHand(soundSpades).hcp).toBe(12);
    expect(chooseBid(observation([bid(2, 'H')], soundSpades), 'sayc')).toEqual(bid(2, 'S'));
  });

  it('uses a takeout double against a three-level preempt with sufficient shape and strength', () => {
    expect(decide([bid(3, 'H')], [4, 1, 4, 4], 15)).toEqual(DOUBLE);
  });

  it('keeps Stayman and Jacoby transfers on after a direct 1NT overcall', () => {
    expect(decide([bid(1, 'D'), bid(1, 'NT'), PASS], [4, 3, 3, 3], 8)).toEqual(bid(2, 'C'));
    expect(decide([bid(1, 'D'), bid(1, 'NT'), PASS], [5, 2, 3, 3], 5)).toEqual(bid(2, 'H'));
    expect(decide([bid(1, 'D'), bid(1, 'NT'), PASS, bid(2, 'C'), PASS], [4, 4, 3, 2], 16)).toEqual(bid(2, 'H'));
  });

  it('balances with lighter values after an opening and two passes', () => {
    const balancingNt = holdings('AQ3', 'J98', 'K73', 'J984');
    expect(evaluateHand(balancingNt).hcp).toBe(11);
    expect(chooseBid(observation([bid(1, 'D'), PASS, PASS], balancingNt), 'sayc')).toEqual(bid(1, 'NT'));
    expect(decide([bid(1, 'D'), PASS, PASS], [4, 4, 1, 4], 9)).toEqual(DOUBLE);
  });

  it('explains artificial competitive calls by their public SAYC meaning', () => {
    const michaels = describeCall(observation([bid(1, 'D')], hand([5, 5, 1, 2], 10)).auction, 'E', bid(2, 'D'), 'sayc');
    expect(michaels).toContain('Michaels');
  });
});
