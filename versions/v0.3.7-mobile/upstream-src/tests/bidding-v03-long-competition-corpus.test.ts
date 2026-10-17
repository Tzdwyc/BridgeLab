import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { applyCall, newGame } from '../src/core/game';
import { sameCall } from '../src/core/auction';
import { type Call, type Card, type Strain, type Suit, PASS, sideOf } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const DOUBLE: Call = { kind: 'double' };
const suits: Suit[] = ['S', 'H', 'D', 'C'];
const stats = {
  generatedBoards: 0, completedBoards: 0, stepChecks: 0, competitiveAuctions: 0,
  severeAuctions: 0, longAuctions: 0, forcingStepChecks: 0, openingPassChecks: 0,
  semiForcingChecks: 0, penaltyDoubleChecks: 0, forcedPasses: 0, violations: 0
};
const samples: Array<{ seed: number; auction: string; calls: number; sides: string[] }> = [];
const forcedPassSamples: Array<{ seed: number; seat: string; convention: string; auction: string }> = [];
const violationSamples: Array<{ seed: number; seat: string; reason: string; auction: string; proposed: string }> = [];

function hand(shape: readonly [number, number, number, number], target: number): Card[] {
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

function observation(calls: Call[], testHand: Card[]): BiddingObservation {
  let game = newGame(1, 'v03-long-competition');
  for (const call of calls) game = applyCall(game, game.turn, call);
  return { ...(observe(game) as BiddingObservation), hand: testHand };
}

function label(call: Call): string {
  if (call.kind === 'pass') return 'Pass';
  if (call.kind === 'double') return 'X';
  if (call.kind === 'redouble') return 'XX';
  return `${call.level}${call.strain}`;
}

function reachesGame(call: Call) {
  return call.kind === 'bid' && (call.strain === 'NT' ? call.level >= 3
    : call.strain === 'H' || call.strain === 'S' ? call.level >= 4 : call.level >= 5);
}

function recordViolation(seed: number, seat: string, reason: string, auction: Call[], proposed: Call) {
  stats.violations++;
  if (violationSamples.length < 100) violationSamples.push({
    seed, seat, reason, auction: auction.map(label).join('-'), proposed: label(proposed)
  });
}

afterAll(() => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/bidding-long-competition-corpus.json', JSON.stringify({
    version: '0.3.1', system: 'SAYC＋2/1进局逼叫＋RKCB 1430', generatedAt: new Date().toISOString(),
    stats, samples, forcedPassSamples, violationSamples
  }, null, 2));
});

describe('long and heavily contested SAYC examples', () => {
  it('honors a negative double even after advancer raises the overcall', () => {
    for (let hcp = 13; hcp <= 18; hcp++) {
      expect(chooseBid(observation([bid(1, 'D'), bid(1, 'S'), DOUBLE, bid(2, 'S')], hand([2, 4, 5, 2], hcp)), 'sayc')).toEqual(bid(3, 'H'));
    }
  });

  it('competes with a known fit without treating a minimum simple raise as game force', () => {
    for (let hcp = 13; hcp <= 17; hcp++) {
      expect(chooseBid(observation([bid(1, 'H'), bid(1, 'S'), bid(2, 'H'), bid(2, 'S')], hand([3, 5, 3, 2], hcp)), 'sayc')).toEqual(bid(3, 'H'));
    }
    expect(chooseBid(observation([bid(1, 'H'), bid(1, 'S'), bid(2, 'H'), bid(3, 'S')], hand([2, 5, 3, 3], 19)), 'sayc')).toEqual(bid(4, 'H'));
  });

  it('keeps forcing cuebid, strong-double and trial-bid continuations alive', () => {
    expect(chooseBid(observation([bid(1, 'D'), bid(1, 'S'), PASS, bid(2, 'D'), PASS], hand([5, 4, 1, 3], 13)), 'sayc')).toEqual(bid(2, 'H'));
    expect(chooseBid(observation([bid(1, 'D'), DOUBLE, PASS, bid(1, 'H'), PASS], hand([5, 3, 2, 3], 17)), 'sayc')).toEqual(bid(1, 'S'));
    expect(chooseBid(observation([bid(1, 'D'), PASS, bid(1, 'H'), PASS, bid(2, 'H'), PASS, bid(2, 'S'), PASS], hand([3, 4, 4, 2], 14)), 'sayc')).toEqual(bid(4, 'H'));
    expect(chooseBid(observation([bid(1, 'H'), DOUBLE, bid(1, 'S'), bid(2, 'H'), PASS], hand([4, 1, 4, 4], 13)), 'sayc')).toEqual(bid(3, 'D'));
  });

  it('runs 10000 complete four-robot auctions and audits every decision step', () => {
    for (let seed = 0; seed < 10000; seed++) {
      let game = newGame(seed % 4 + 1, `v03-sayc-contested-${seed}`);
      const gameForceSides = new Set<string>();
      stats.generatedBoards++;
      for (let guard = 0; guard < 100 && game.phase === 'auction'; guard++) {
        const semantics = analyzeAuctionSemantics(game.auction, game.turn, 'sayc');
        const obs = observe(game) as BiddingObservation;
        const call = chooseBid(obs, 'sayc');
        const currentSeat = game.turn;
        const evaluation = evaluateHand(game.initialHands[currentSeat]);
        const priorCalls = game.auction.map(entry => entry.call);
        const firstBidIndex = game.auction.findIndex(entry => entry.call.kind === 'bid');
        const activeAuction = firstBidIndex < 0 ? [] : game.auction.slice(firstBidIndex);
        stats.stepChecks++;
        expect(obs.legalCalls.some(legal => sameCall(legal, call))).toBe(true);
        if (firstBidIndex < 0 && call.kind === 'pass') {
          stats.openingPassChecks++;
          const twoLongest = Object.values(evaluation.lengths).sort((a, b) => b - a).slice(0, 2);
          if (evaluation.hcp >= 13 || (evaluation.hcp === 12 && twoLongest[0] + twoLongest[1] >= 8)) {
            recordViolation(seed, currentSeat, `opening pass with ${evaluation.hcp} HCP and Rule-of-20 values`, priorCalls, call);
          }
        }
        if (activeAuction.length === 4 && activeAuction[0].seat === currentSeat
          && activeAuction[0].call.kind === 'bid' && activeAuction[0].call.level === 1
          && (activeAuction[0].call.strain === 'H' || activeAuction[0].call.strain === 'S')
          && activeAuction[1].call.kind === 'pass'
          && activeAuction[2].call.kind === 'bid' && activeAuction[2].call.level === 1 && activeAuction[2].call.strain === 'NT'
          && activeAuction[3].call.kind === 'pass') {
          stats.semiForcingChecks++;
          if (call.kind === 'pass' && (!evaluation.balanced || evaluation.hcp >= 18)) {
            recordViolation(seed, currentSeat, `invalid pass over semi-forcing 1NT with ${evaluation.hcp} HCP/${Object.values(evaluation.lengths).join('-')}`, priorCalls, call);
          }
        }
        if (semantics.mustBid && call.kind === 'pass') {
          stats.forcedPasses++;
          if (forcedPassSamples.length < 30) forcedPassSamples.push({ seed, seat: game.turn, convention: semantics.convention, auction: game.auction.map(entry => label(entry.call)).join('-') });
          recordViolation(seed, currentSeat, `Pass while ${semantics.forcing}/${semantics.convention} is forcing`, priorCalls, call);
        }
        if (semantics.forcing === 'game') {
          stats.forcingStepChecks++;
          gameForceSides.add(sideOf(currentSeat));
        }
        if (call.kind === 'double') {
          const explanation = describeCall(game.auction, currentSeat, call, 'sayc');
          if (explanation.includes('惩罚性加倍')) {
            stats.penaltyDoubleChecks++;
            const lastBid = [...game.auction].reverse().find(entry => entry.call.kind === 'bid');
            if (lastBid?.call.kind === 'bid' && lastBid.call.strain === 'NT' && evaluation.hcp < 15) {
              recordViolation(seed, currentSeat, `penalty double of notrump with only ${evaluation.hcp} HCP`, priorCalls, call);
            }
            if (lastBid?.call.kind === 'bid' && lastBid.call.strain !== 'NT') {
              const trump = lastBid.call.strain;
              const ourBids = game.auction.filter(entry => sideOf(entry.seat) === sideOf(currentSeat) && entry.call.kind === 'bid');
              const theirBids = game.auction.filter(entry => sideOf(entry.seat) !== sideOf(currentSeat) && entry.call.kind === 'bid');
              const trumpCards = game.initialHands[currentSeat].filter(card => card.suit === trump);
              if (ourBids.length >= 2 && theirBids.length >= 2
                && (trumpCards.length < 4 || trumpCards.filter(card => card.rank >= 11).length < 2)) {
                recordViolation(seed, currentSeat, `penalty double without four trumps and two trump honors in ${trump}`, priorCalls, call);
              }
            }
          }
        }
        game = applyCall(game, game.turn, call);
      }
      expect(game.phase).not.toBe('auction');
      stats.completedBoards++;
      if (game.contract && gameForceSides.has(sideOf(game.contract.declarer)) && !reachesGame({
        kind: 'bid', level: game.contract.level, strain: game.contract.strain
      })) recordViolation(seed, game.contract.declarer, 'game-forcing side stopped below game', game.auction.map(entry => entry.call), {
        kind: 'bid', level: game.contract.level, strain: game.contract.strain
      });
      const actions = game.auction.filter(entry => entry.call.kind !== 'pass');
      const bidSides = [...new Set(actions.filter(entry => entry.call.kind === 'bid').map(entry => sideOf(entry.seat)))];
      const perSide = bidSides.map(side => actions.filter(entry => sideOf(entry.seat) === side).length);
      const highest = Math.max(0, ...actions.flatMap(entry => entry.call.kind === 'bid' ? [entry.call.level] : []));
      const competitive = bidSides.length === 2;
      const severe = competitive && perSide.every(count => count >= 2) && (highest >= 3 || actions.some(entry => entry.call.kind === 'double' || entry.call.kind === 'redouble'));
      const long = game.auction.length >= 12;
      if (competitive) stats.competitiveAuctions++;
      if (severe) stats.severeAuctions++;
      if (long) stats.longAuctions++;
      if ((severe || long) && samples.length < 30) samples.push({ seed, auction: game.auction.map(entry => label(entry.call)).join('-'), calls: game.auction.length, sides: bidSides });
    }
    expect(stats.forcedPasses).toBe(0);
    expect(stats.violations, JSON.stringify(violationSamples.slice(0, 20), null, 2)).toBe(0);
    expect(stats.stepChecks).toBeGreaterThan(40000);
    expect(stats.openingPassChecks).toBeGreaterThan(1000);
    expect(stats.semiForcingChecks).toBeGreaterThan(0);
    expect(stats.forcingStepChecks).toBeGreaterThan(0);
    expect(stats.competitiveAuctions).toBeGreaterThan(0);
    expect(stats.severeAuctions).toBeGreaterThan(0);
    expect(stats.longAuctions).toBeGreaterThan(0);
  });
});
