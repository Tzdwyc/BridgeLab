import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, type Vulnerability, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const DOUBLE: Call = { kind: 'double' };
const suits: Suit[] = ['S', 'H', 'D', 'C'];
const ranks = '23456789TJQKA';
const stats = { explicitPenaltyCases: 0, falsePenaltyMatrix: 0, classificationCases: 0 };

function holding(spades: string, hearts: string, diamonds: string, clubs: string): Card[] {
  const cards = [spades, hearts, diamonds, clubs].flatMap((text, suitIndex) => [...text].map(symbol => ({
    id: `${suits[suitIndex]}${ranks.indexOf(symbol) + 2}`,
    suit: suits[suitIndex],
    rank: ranks.indexOf(symbol) + 2
  })));
  if (cards.length !== 13 || cards.some(card => card.rank < 2)) throw new Error('Bad explicit hand');
  return cards;
}

function syntheticHand(shape: readonly [number, number, number, number], target: number): Card[] | undefined {
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
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
  const cards = visit(0, target);
  return cards && cards.length === 13 ? cards : undefined;
}

function observation(calls: Call[], hand: Card[], vulnerability: Vulnerability = 'None'): BiddingObservation {
  let game = newGame(1, 'v031-double-audit');
  for (const call of calls) game = applyCall(game, game.turn, call);
  return { ...(observe(game) as BiddingObservation), hand, vulnerability };
}

function allShapes(): Array<readonly [number, number, number, number]> {
  const result: Array<readonly [number, number, number, number]> = [];
  for (let spades = 0; spades <= 7; spades++) for (let hearts = 0; hearts <= 7; hearts++) {
    for (let diamonds = 0; diamonds <= 7; diamonds++) {
      const clubs = 13 - spades - hearts - diamonds;
      if (clubs >= 0 && clubs <= 7) result.push([spades, hearts, diamonds, clubs]);
    }
  }
  return result;
}

afterAll(() => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/bidding-double-audit.json', JSON.stringify({
    version: '0.3.2', system: 'SAYC＋2/1进局逼叫＋RKCB 1430', generatedAt: new Date().toISOString(), stats,
    rules: [
      '直接对花色开叫及阻击叫的加倍保持技术性',
      '直接对1NT的加倍为惩罚性并要求15+ HCP及至少3个快速赢墩',
      '竞争后的惩罚性加倍要求4+张敌方将牌、至少两个将牌大牌、足够快速赢墩与点力',
      '对手有局时只降低一点HCP门槛，不降低将牌和快速赢墩门槛'
    ]
  }, null, 2));
});

describe('v0.3.1 SAYC double classification and penalty safety', () => {
  const competitivePartscore = [bid(1, 'H'), bid(1, 'S'), bid(2, 'H'), bid(2, 'S')];

  it('uses a conservative trump-stack penalty double and rejects superficially strong alternatives', () => {
    const penalty = holding('AQJ9', 'AK987', 'A84', '2');
    const shortTrump = holding('2', 'AKQJ9', 'AK84', 'Q32');
    const weakStack = holding('KQJ9', 'Q9876', '84', '32');
    expect(evaluateHand(penalty).hcp).toBe(18);
    expect(chooseBid(observation(competitivePartscore, penalty), 'sayc')).toEqual(DOUBLE);
    expect(chooseBid(observation(competitivePartscore, shortTrump), 'sayc')).not.toEqual(DOUBLE);
    expect(chooseBid(observation(competitivePartscore, weakStack), 'sayc')).not.toEqual(DOUBLE);
    stats.explicitPenaltyCases += 3;
  });

  it('uses vulnerability only as a one-point adjustment, never as a substitute for defensive shape', () => {
    const borderline = holding('AQT9', 'K9876', 'A84', '2');
    expect(evaluateHand(borderline).hcp).toBe(13);
    expect(chooseBid(observation(competitivePartscore, borderline, 'None'), 'sayc')).not.toEqual(DOUBLE);
    expect(chooseBid(observation(competitivePartscore, borderline, 'EW'), 'sayc')).toEqual(DOUBLE);
    const noTrumpStack = holding('2', 'AKQJ9', 'A84', 'KQ32');
    expect(chooseBid(observation(competitivePartscore, noTrumpStack, 'EW'), 'sayc')).not.toEqual(DOUBLE);
    stats.explicitPenaltyCases += 3;
  });

  it('applies the stricter game-level threshold before doubling a sacrifice', () => {
    const fourteen = holding('AQT9', 'K9876', 'A84', 'J');
    const auction = [bid(1, 'H'), bid(1, 'S'), bid(4, 'H'), bid(4, 'S')];
    expect(evaluateHand(fourteen).hcp).toBe(14);
    expect(chooseBid(observation(auction, fourteen, 'None'), 'sayc')).not.toEqual(DOUBLE);
    expect(chooseBid(observation(auction, fourteen, 'EW'), 'sayc')).toEqual(DOUBLE);
    stats.explicitPenaltyCases += 2;
  });

  it('audits more than one thousand non-penalty shapes and never doubles without four trumps or minimum strength', () => {
    for (const shape of allShapes()) {
      if (shape[1] < 5) continue;
      for (let hcp = 8; hcp <= 21; hcp++) {
        const hand = syntheticHand(shape, hcp);
        if (!hand) continue;
        if (shape[0] <= 3 || hcp <= 13) {
          const call = chooseBid(observation(competitivePartscore, hand), 'sayc');
          stats.falsePenaltyMatrix++;
          expect(call).not.toEqual(DOUBLE);
        }
      }
    }
    expect(stats.falsePenaltyMatrix).toBeGreaterThan(1000);
  });

  it('labels takeout, negative, conventional and penalty doubles by auction context', () => {
    const takeout = describeCall(observation([bid(1, 'D')], holding('AKJ9', 'QJ87', '2', 'QJ87')).auction, 'E', DOUBLE, 'sayc');
    const oneNtPenalty = describeCall(observation([bid(1, 'NT')], holding('AKJ9', 'QJ87', 'A2', 'Q87')).auction, 'E', DOUBLE, 'sayc');
    const negative = describeCall(observation([bid(1, 'D'), bid(1, 'H')], holding('KJ87', '2', 'QJ87', 'A987')).auction, 'S', DOUBLE, 'sayc');
    const michaels = describeCall(observation([bid(1, 'S'), bid(2, 'S')], holding('KJ87', 'QJ8', 'A87', 'Q87')).auction, 'S', DOUBLE, 'sayc');
    const penalty = describeCall(observation(competitivePartscore, holding('AQJ9', 'AK987', 'A84', '2')).auction, 'N', DOUBLE, 'sayc');
    expect(takeout).toContain('技术性加倍');
    expect(oneNtPenalty).toContain('惩罚性加倍');
    expect(negative).toContain('负加倍');
    expect(michaels).toContain('Michaels');
    expect(penalty).toContain('惩罚性加倍');
    stats.classificationCases += 5;
  });

  it('requires fifteen points and defensive tricks before directly doubling 1NT', () => {
    const fourteen = holding('AQ9', 'KJ87', 'A82', '987');
    const fifteen = holding('AQ9', 'KQ87', 'A82', '987');
    const softFifteen = holding('AQ9', 'KJ87', 'K82', 'Q87');
    expect(evaluateHand(fourteen).hcp).toBe(14);
    expect(evaluateHand(fifteen).hcp).toBe(15);
    expect(chooseBid(observation([bid(1, 'NT')], fourteen), 'sayc')).toEqual(PASS);
    expect(chooseBid(observation([bid(1, 'NT')], fifteen), 'sayc')).toEqual(DOUBLE);
    expect(evaluateHand(softFifteen).hcp).toBe(15);
    expect(chooseBid(observation([bid(1, 'NT')], softFifteen), 'sayc')).toEqual(PASS);
    expect(describeCall(observation([bid(1, 'NT')], fifteen).auction, 'E', DOUBLE, 'sayc')).toContain('快速赢墩');
    stats.explicitPenaltyCases += 3;
  });
});
