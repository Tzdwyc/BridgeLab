import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { sameCall } from '../src/core/auction';
import { type BiddingSystem } from '../src/ai/systems';
import { type Call, type Card, type Strain, type Suit, PASS, sideOf } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const DOUBLE: Call = { kind: 'double' };
type Shape = readonly [number, number, number, number];
const suits: Suit[] = ['S', 'H', 'D', 'C'];
const counts: Record<string, number> = {};
const failures: string[] = [];
const reviews: string[] = [];
const handCache = new Map<string, Card[][]>();
const observationCache = new Map<string, BiddingObservation>();

function hands(shape: Shape, target: number, limit = 3): Card[][] {
  const key = `${shape.join('-')}/${target}/${limit}`;
  const cached = handCache.get(key);
  if (cached) return cached;
  const results: Card[][] = [];
  const visit = (index: number, remaining: number, built: Card[]) => {
    if (results.length >= limit) return;
    if (index === 4) {
      if (remaining === 0 && built.length === 13) results.push(built);
      return;
    }
    for (let mask = 0; mask < 16 && results.length < limit; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((sum, rank) => sum + rank - 10, 0);
      const low = shape[index] - honors.length;
      if (low < 0 || low > 9 || points > remaining) continue;
      const ranks = [...honors, ...Array.from({ length: low }, (_, offset) => 10 - offset)];
      visit(index + 1, remaining - points, built.concat(ranks.map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank }))));
    }
  };
  visit(0, target, []);
  for (const result of results) expect(evaluateHand(result).hcp).toBe(target);
  handCache.set(key, results);
  return results;
}

function observation(calls: Call[], hand: Card[]): BiddingObservation {
  const key = JSON.stringify(calls);
  let base = observationCache.get(key);
  if (!base) {
    let game = newGame(1, `v03-corpus-${observationCache.size}`);
    for (const call of calls) game = applyCall(game, game.turn, call);
    base = observe(game) as BiddingObservation;
    observationCache.set(key, base);
  }
  return { ...base, hand };
}

function label(call: Call): string {
  if (call.kind === 'pass') return 'Pass';
  if (call.kind === 'double') return 'X';
  if (call.kind === 'redouble') return 'XX';
  return `${call.level}${call.strain}`;
}

function verify(category: string, calls: Call[], shape: Shape, hcp: number, expected: Call,
  system: BiddingSystem = 'sayc', limit = 3) {
  const variants = hands(shape, hcp, limit);
  if (!variants.length) return;
  for (const testHand of variants) {
    const actual = chooseBid(observation(calls, testHand), system);
    counts[category] = (counts[category] ?? 0) + 1;
    if (!sameCall(actual, expected)) failures.push(`${category}: ${system} ${shape.join('-')}/${hcp} after ${calls.map(label).join('-')} expected ${label(expected)}, got ${label(actual)}`);
  }
}

function permutations(values: number[]): Shape[] {
  const found = new Set<string>();
  const result: Shape[] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (!rest.length) {
      const key = prefix.join('-');
      if (!found.has(key)) { found.add(key); result.push(prefix as unknown as Shape); }
      return;
    }
    rest.forEach((value, index) => walk([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)]));
  };
  walk([], values);
  return result;
}

function generatedShapes(maximumSuitLength = 7): Shape[] {
  const result: Shape[] = [];
  for (let spades = 0; spades <= maximumSuitLength; spades++) {
    for (let hearts = 0; hearts <= maximumSuitLength; hearts++) {
      for (let diamonds = 0; diamonds <= maximumSuitLength; diamonds++) {
        const clubs = 13 - spades - hearts - diamonds;
        if (clubs >= 0 && clubs <= maximumSuitLength) result.push([spades, hearts, diamonds, clubs]);
      }
    }
  }
  return result;
}

function reachesGame(call: Call) {
  if (call.kind !== 'bid') return false;
  if (call.strain === 'NT') return call.level >= 3;
  if (call.strain === 'H' || call.strain === 'S') return call.level >= 4;
  return call.level >= 5;
}

afterAll(() => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/bidding-convention-corpus.json', JSON.stringify({
    version: '0.3.1', system: 'SAYC＋2/1进局逼叫＋RKCB 1430', generatedAt: new Date().toISOString(),
    totalCases: Object.values(counts).reduce((sum, value) => sum + value, 0), categories: counts,
    failures: failures.slice(0, 100), reviewCases: reviews.slice(0, 100)
  }, null, 2));
});

describe('large SAYC convention-card corpus', () => {
  it('opens balanced ranges and natural one-level suits across shapes and honor placements', () => {
    const failureStart = failures.length;
    const balanced = [...permutations([4, 3, 3, 3]), ...permutations([4, 4, 3, 2]), ...permutations([5, 3, 3, 2])];
    for (const shape of balanced) {
      for (const hcp of [15, 16, 17]) verify('balanced 1NT opening', [], shape, hcp, bid(1, 'NT'));
      for (const hcp of [20, 21]) verify('balanced 2NT opening', [], shape, hcp, bid(2, 'NT'));
      for (const hcp of [22, 23, 24]) verify('balanced strong 2C opening', [], shape, hcp, bid(2, 'C'));
      for (const hcp of [25, 26, 27]) verify('balanced 3NT opening', [], shape, hcp, bid(3, 'NT'));
    }
    const natural: Array<{ shape: Shape; strain: Strain }> = [
      { shape: [5, 4, 3, 1], strain: 'S' }, { shape: [4, 5, 3, 1], strain: 'H' },
      { shape: [5, 5, 2, 1], strain: 'S' }, { shape: [1, 4, 5, 3], strain: 'D' },
      { shape: [1, 4, 3, 5], strain: 'C' }, { shape: [4, 4, 4, 1], strain: 'D' }
    ];
    for (const item of natural) for (let hcp = 13; hcp <= 19; hcp++) verify('natural one-level opening', [], item.shape, hcp, bid(1, item.strain));
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('handles 1NT and 2NT responses at sign-off, invitation, game and slam thresholds', () => {
    const failureStart = failures.length;
    for (let hcp = 0; hcp <= 21; hcp++) {
      verify('1NT spade transfer', [bid(1, 'NT'), PASS], [5, 4, 3, 1], hcp, bid(2, 'H'));
      verify('1NT heart transfer', [bid(1, 'NT'), PASS], [4, 5, 3, 1], hcp, bid(2, 'D'));
      verify('2NT spade transfer', [bid(2, 'NT'), PASS], [5, 4, 3, 1], hcp, bid(3, 'H'));
      verify('2NT heart transfer', [bid(2, 'NT'), PASS], [4, 5, 3, 1], hcp, bid(3, 'D'));
    }
    for (let hcp = 8; hcp <= 17; hcp++) verify('1NT Stayman', [bid(1, 'NT'), PASS], [4, 4, 4, 1], hcp, bid(2, 'C'));
    for (let hcp = 5; hcp <= 12; hcp++) verify('2NT Stayman', [bid(2, 'NT'), PASS], [4, 4, 4, 1], hcp, bid(3, 'C'));
    for (let hcp = 0; hcp <= 22; hcp++) {
      const expected = hcp >= 22 ? bid(7, 'NT') : hcp >= 18 ? bid(6, 'NT') : hcp >= 10 ? bid(3, 'NT') : hcp >= 8 ? bid(2, 'NT') : PASS;
      verify('1NT quantitative ladder', [bid(1, 'NT'), PASS], [3, 3, 4, 3], hcp, expected);
    }
    for (let hcp = 0; hcp <= 17; hcp++) {
      const expected = hcp >= 17 ? bid(7, 'NT') : hcp >= 13 ? bid(6, 'NT') : hcp >= 5 ? bid(3, 'NT') : PASS;
      verify('2NT quantitative ladder', [bid(2, 'NT'), PASS], [3, 3, 4, 3], hcp, expected);
    }
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('responds to one-level major openings according to support and new-suit ranges', () => {
    const failureStart = failures.length;
    for (const opening of ['H', 'S'] as const) {
      const threeSupport: Shape = opening === 'S' ? [3, 3, 4, 3] : [3, 3, 4, 3];
      const fourSupport: Shape = opening === 'S' ? [4, 3, 3, 3] : [3, 4, 3, 3];
      for (let hcp = 6; hcp <= 12; hcp++) {
        verify('three-card major raise', [bid(1, opening), PASS], threeSupport, hcp, bid(hcp >= 10 ? 3 : 2, opening));
        verify('four-card major raise', [bid(1, opening), PASS], fourSupport, hcp, hcp >= 12 ? bid(2, 'NT') : bid(hcp >= 9 ? 3 : 2, opening));
      }
      for (let hcp = 13; hcp <= 17; hcp++) verify('Jacoby 2NT four-card raise', [bid(1, opening), PASS], fourSupport, hcp, bid(2, 'NT'));
    }
    for (let hcp = 6; hcp <= 17; hcp++) verify('one-over-one spade response', [bid(1, 'H'), PASS], [4, 2, 4, 3], hcp, bid(1, 'S'));
    for (let hcp = 5; hcp <= 12; hcp++) {
      verify('weak major 1NT response', [bid(1, 'S'), PASS], [2, 3, 4, 4], hcp, bid(1, 'NT'));
      verify('two-level major requires ten', [bid(1, 'S'), PASS], [2, 5, 3, 3], hcp, bid(1, 'NT'));
    }
    for (let hcp = 13; hcp <= 17; hcp++) verify('game-forcing two-level major response', [bid(1, 'S'), PASS], [2, 5, 3, 3], hcp, bid(2, 'H'));
    for (let hcp = 13; hcp <= 15; hcp++) verify('show a four-card minor before no-trump', [bid(1, 'S'), PASS], [2, 3, 4, 4], hcp, bid(2, 'D'));
    for (let hcp = 16; hcp <= 18; hcp++) verify('descriptive game-force response without support', [bid(1, 'S'), PASS], [2, 3, 4, 4], hcp, bid(2, 'D'));
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('audits the 5-12 semi-forcing 1NT response and every opener shape continuation', () => {
    const failureStart = failures.length;
    const shapes = generatedShapes();
    const suitIndex: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
    for (const shape of shapes) {
      for (let hcp = 5; hcp <= 12; hcp++) {
        if (shape[suitIndex.S] > 2) continue;
        const variants = hands(shape, hcp, 3);
        if (!variants.length) continue;
        for (const testHand of variants) {
          const actual = chooseBid(observation([bid(1, 'S'), PASS], testHand), 'sayc');
          counts['semi-forcing 1NT response matrix'] = (counts['semi-forcing 1NT response matrix'] ?? 0) + 1;
          if (!sameCall(actual, bid(1, 'NT'))) failures.push(`semi-forcing 1NT response matrix: ${shape.join('-')}/${hcp} expected 1NT, got ${label(actual)}`);
        }
      }
      if (shape[suitIndex.S] < 5) continue;
      for (let hcp = 12; hcp <= 19; hcp++) {
        const variants = hands(shape, hcp, 3);
        if (!variants.length) continue;
        const evaluation = evaluateHand(variants[0]);
        const sideSuitRank: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3 };
        const sideSuits = (['H', 'D', 'C'] as Suit[]).filter(suit => shape[suitIndex[suit]] >= 4)
          .sort((a, b) => shape[suitIndex[b]] - shape[suitIndex[a]] || sideSuitRank[b] - sideSuitRank[a]);
        const expected = evaluation.balanced && hcp >= 18 ? bid(2, 'NT')
          : sideSuits.length ? bid(2, sideSuits[0])
            : shape[suitIndex.S] >= 6 ? bid(2, 'S') : PASS;
        const calls = [bid(1, 'S'), PASS, bid(1, 'NT'), PASS];
        for (const testHand of variants) {
          const actual = chooseBid(observation(calls, testHand), 'sayc');
          counts['semi-forcing opener rebid matrix'] = (counts['semi-forcing opener rebid matrix'] ?? 0) + 1;
          if (!sameCall(actual, expected)) failures.push(`semi-forcing opener rebid matrix: ${shape.join('-')}/${hcp} expected ${label(expected)}, got ${label(actual)}`);
        }
      }
    }
    expect(counts['semi-forcing 1NT response matrix']).toBeGreaterThan(1000);
    expect(counts['semi-forcing opener rebid matrix']).toBeGreaterThan(2000);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('separates natural five-card major responses from four-card negative doubles', () => {
    const failureStart = failures.length;
    const shapes = generatedShapes();
    const suitIndex: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
    for (const opening of ['C', 'D'] as const) {
      for (const shape of shapes) {
        for (let hcp = 6; hcp <= 16; hcp++) {
          const variants = hands(shape, hcp, 3);
          if (!variants.length) continue;
          for (const testHand of variants) {
            if (shape[suitIndex.S] >= 5) {
              const actual = chooseBid(observation([bid(1, opening), bid(1, 'H')], testHand), 'sayc');
              counts['natural spade response over 1H'] = (counts['natural spade response over 1H'] ?? 0) + 1;
              if (!sameCall(actual, bid(1, 'S'))) failures.push(`natural spade response over 1H: 1${opening}-(1H), ${shape.join('-')}/${hcp} expected 1S, got ${label(actual)}`);
            }
            if (shape[suitIndex.H] === 4) {
              const actual = chooseBid(observation([bid(1, opening), bid(1, 'S')], testHand), 'sayc');
              counts['four-heart negative double'] = (counts['four-heart negative double'] ?? 0) + 1;
              if (!sameCall(actual, DOUBLE)) failures.push(`four-heart negative double: 1${opening}-(1S), ${shape.join('-')}/${hcp} expected X, got ${label(actual)}`);
            }
            if (shape[suitIndex.H] >= 5 && hcp >= 10) {
              const actual = chooseBid(observation([bid(1, opening), bid(1, 'S')], testHand), 'sayc');
              counts['natural two-heart response'] = (counts['natural two-heart response'] ?? 0) + 1;
              if (!sameCall(actual, bid(2, 'H'))) failures.push(`natural two-heart response: 1${opening}-(1S), ${shape.join('-')}/${hcp} expected 2H, got ${label(actual)}`);
            }
          }
        }
      }
    }
    expect(counts['natural spade response over 1H']).toBeGreaterThan(1000);
    expect(counts['four-heart negative double']).toBeGreaterThan(1000);
    expect(counts['natural two-heart response']).toBeGreaterThan(500);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('opens every generated 13+ hand and every 12-HCP Rule-of-20 hand', () => {
    const failureStart = failures.length;
    for (const shape of generatedShapes()) {
      const twoLongest = [...shape].sort((a, b) => b - a).slice(0, 2);
      for (let hcp = 12; hcp <= 21; hcp++) {
        if (hcp === 12 && twoLongest[0] + twoLongest[1] < 8) continue;
        const variants = hands(shape, hcp, 3);
        if (!variants.length) continue;
        for (const testHand of variants) {
          const actual = chooseBid(observation([], testHand), 'sayc');
          counts['opening floor matrix'] = (counts['opening floor matrix'] ?? 0) + 1;
          if (actual.kind === 'pass') failures.push(`opening floor matrix: ${shape.join('-')}/${hcp} passed`);
        }
      }
    }
    expect(counts['opening floor matrix']).toBeGreaterThan(9000);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('keeps an uncontested 2/1 game force alive through later interference at every level', () => {
    const failureStart = failures.length;
    const shapes = generatedShapes();
    const openerContexts: Call[][] = [
      [bid(1, 'S'), PASS, bid(2, 'D'), bid(2, 'H')],
      [bid(1, 'S'), PASS, bid(2, 'D'), bid(3, 'H')],
      [bid(1, 'S'), PASS, bid(2, 'D'), bid(4, 'H')],
      [bid(1, 'H'), PASS, bid(2, 'C'), bid(2, 'S')],
      [bid(1, 'H'), PASS, bid(2, 'D'), bid(3, 'S')]
    ];
    const responderContexts: Call[][] = [
      [bid(1, 'S'), PASS, bid(2, 'D'), bid(2, 'H'), bid(2, 'S'), bid(3, 'H')],
      [bid(1, 'S'), PASS, bid(2, 'C'), bid(2, 'H'), bid(3, 'C'), bid(3, 'H')],
      [bid(1, 'H'), PASS, bid(2, 'D'), bid(2, 'S'), bid(3, 'D'), bid(3, 'S')]
    ];
    for (const calls of [...openerContexts, ...responderContexts]) {
      for (const shape of shapes) {
        for (let hcp = 13; hcp <= 20; hcp++) {
          const variants = hands(shape, hcp, 3);
          if (!variants.length) continue;
          for (const testHand of variants) {
            const obs = observation(calls, testHand);
            const semantics = analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc');
            const actual = chooseBid(obs, 'sayc');
            counts['interfered 2/1 game-force step'] = (counts['interfered 2/1 game-force step'] ?? 0) + 1;
            const prefix = `${shape.join('-')}/${hcp} after ${calls.map(label).join('-')}`;
            if (!semantics.mustBid || semantics.forcing !== 'game') failures.push(`interfered 2/1 game-force step: force lost for ${prefix}`);
            if (actual.kind === 'pass') failures.push(`interfered 2/1 game-force step: Pass for ${prefix}`);
            if (!obs.legalCalls.some(legal => sameCall(legal, actual))) failures.push(`interfered 2/1 game-force step: illegal ${label(actual)} for ${prefix}`);
          }
        }
      }
    }
    expect(counts['interfered 2/1 game-force step']).toBeGreaterThan(10000);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('audits every generated SAYC two-over-one step after opener rebids below game', () => {
    const failureStart = failures.length;
    const contexts: Array<{ opening: 'H' | 'S'; response: Suit; rebid: Strain }> = [
      { opening: 'S', response: 'H', rebid: 'C' }, { opening: 'S', response: 'H', rebid: 'D' },
      { opening: 'S', response: 'H', rebid: 'S' }, { opening: 'S', response: 'H', rebid: 'NT' },
      { opening: 'S', response: 'D', rebid: 'C' }, { opening: 'S', response: 'D', rebid: 'H' },
      { opening: 'S', response: 'D', rebid: 'S' }, { opening: 'S', response: 'D', rebid: 'NT' },
      { opening: 'S', response: 'C', rebid: 'D' }, { opening: 'S', response: 'C', rebid: 'H' },
      { opening: 'S', response: 'C', rebid: 'S' }, { opening: 'S', response: 'C', rebid: 'NT' },
      { opening: 'H', response: 'D', rebid: 'C' }, { opening: 'H', response: 'D', rebid: 'H' },
      { opening: 'H', response: 'D', rebid: 'S' }, { opening: 'H', response: 'D', rebid: 'NT' },
      { opening: 'H', response: 'C', rebid: 'D' }, { opening: 'H', response: 'C', rebid: 'H' },
      { opening: 'H', response: 'C', rebid: 'S' }, { opening: 'H', response: 'C', rebid: 'NT' }
    ];
    const shapes = generatedShapes();
    const suitIndex: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
    for (const context of contexts) {
      const responseLevel = 2;
      const strainOrder: Record<Strain, number> = { C: 0, D: 1, H: 2, S: 3, NT: 4 };
      const rebidLevel = strainOrder[context.rebid] > strainOrder[context.response] ? 2 : 3;
      const calls = [bid(1, context.opening), PASS, bid(responseLevel, context.response), PASS, bid(rebidLevel, context.rebid), PASS];
      for (const shape of shapes) {
        const responseMinimum = context.response === 'H' ? 5 : 4;
        if (shape[suitIndex[context.response]] < responseMinimum) continue;
        for (let hcp = 10; hcp <= 17; hcp++) {
          const variants = hands(shape, hcp, 1);
          if (!variants.length) continue;
          const obs = observation(calls, variants[0]);
          const semantics = analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc');
          const actual = chooseBid(obs, 'sayc');
          counts['SAYC 2/1 step audit'] = (counts['SAYC 2/1 step audit'] ?? 0) + 1;
          const prefix = `${shape.join('-')}/${hcp} after ${calls.map(label).join('-')}`;
          if (!semantics.mustBid) failures.push(`SAYC 2/1 step audit: forcing state lost for ${prefix}`);
          if (!obs.legalCalls.some(legal => sameCall(legal, actual))) failures.push(`SAYC 2/1 step audit: illegal ${label(actual)} for ${prefix}`);
          if (actual.kind === 'pass') failures.push(`SAYC 2/1 step audit: Pass for ${prefix}`);
          const continuedCalls = [...calls, actual, PASS];
          const continued = observation(continuedCalls, variants[0]);
          const continuedSemantics = analyzeAuctionSemantics(continued.auction, continued.seat, 'sayc');
          if (!reachesGame(actual) && !continuedSemantics.mustBid) failures.push(`SAYC 2/1 step audit: game force disappeared after ${label(actual)} for ${prefix}`);
          const openerSupport = shape[suitIndex[context.opening]];
          const rebidSupport = context.rebid === 'NT' ? 0 : shape[suitIndex[context.rebid as Suit]];
          if (context.rebid !== context.opening && context.rebid !== 'NT' && openerSupport >= 3 && rebidSupport < 4
            && actual.kind === 'bid' && actual.strain !== context.opening && actual.strain !== 'NT') {
            failures.push(`SAYC 2/1 step audit: ignored known 5-3 ${context.opening} fit for ${label(actual)} on ${prefix}`);
          }
        }
      }
    }
    expect(counts['SAYC 2/1 step audit']).toBeGreaterThan(10000);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('rebids opener shapes and gives weak two-card preference without passing a 5-2 fit', () => {
    const failureStart = failures.length;
    for (let hcp = 12; hcp <= 16; hcp++) {
      verify('opener shows clubs after hearts', [bid(1, 'H'), PASS, bid(1, 'S'), PASS], [2, 5, 2, 4], hcp, bid(2, 'C'));
      verify('opener shows diamonds after hearts', [bid(1, 'H'), PASS, bid(1, 'S'), PASS], [2, 5, 4, 2], hcp, bid(2, 'D'));
      verify('opener rebids six-card heart', [bid(1, 'H'), PASS, bid(1, 'S'), PASS], [2, 6, 3, 2], hcp, bid(2, 'H'));
    }
    for (let hcp = 6; hcp <= 9; hcp++) {
      verify('one-over-one club false preference', [bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, 'C'), PASS], [5, 2, 4, 2], hcp, bid(2, 'H'));
      verify('one-over-one diamond false preference', [bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, 'D'), PASS], [5, 2, 2, 4], hcp, bid(2, 'H'));
      verify('forcing-NT club false preference', [bid(1, 'S'), PASS, bid(1, 'NT'), PASS, bid(2, 'C'), PASS], [2, 4, 5, 2], hcp, bid(2, 'S'), 'two-over-one');
      verify('SAYC 1NT club false preference', [bid(1, 'S'), PASS, bid(1, 'NT'), PASS, bid(2, 'C'), PASS], [2, 4, 5, 2], hcp, bid(2, 'S'));
    }
    for (let hcp = 10; hcp <= 11; hcp++) verify('fourth-suit continuation', [bid(1, 'H'), PASS, bid(1, 'S'), PASS, bid(2, 'C'), PASS], [5, 2, 4, 2], hcp, bid(2, 'D'));
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('keeps SAYC minor-opening notrump responses quantitative across five-card support shapes', () => {
    const failureStart = failures.length;
    const fiveClubBalanced: Shape[] = [[2, 3, 3, 5], [3, 2, 3, 5], [3, 3, 2, 5]];
    const fiveDiamondBalanced: Shape[] = [[2, 3, 5, 3], [3, 2, 5, 3], [3, 3, 5, 2]];
    for (const shape of fiveClubBalanced) {
      for (let hcp = 13; hcp <= 15; hcp++) verify('SAYC minor 2NT with five-card support', [bid(1, 'C'), PASS], shape, hcp, bid(2, 'NT'));
      for (let hcp = 16; hcp <= 18; hcp++) verify('SAYC minor 3NT with five-card support', [bid(1, 'C'), PASS], shape, hcp, bid(3, 'NT'));
    }
    for (const shape of fiveDiamondBalanced) {
      for (let hcp = 13; hcp <= 15; hcp++) verify('SAYC minor 2NT with five-card support', [bid(1, 'D'), PASS], shape, hcp, bid(2, 'NT'));
      for (let hcp = 16; hcp <= 18; hcp++) verify('SAYC minor 3NT with five-card support', [bid(1, 'D'), PASS], shape, hcp, bid(3, 'NT'));
    }
    for (let hcp = 13; hcp <= 15; hcp++) {
      verify('four-card major remains ahead of minor 2NT', [bid(1, 'C'), PASS], [4, 3, 2, 4], hcp, bid(1, 'S'));
      verify('four-card major remains ahead of minor 2NT', [bid(1, 'C'), PASS], [3, 4, 2, 4], hcp, bid(1, 'H'));
      verify('four-card major remains ahead of minor 2NT', [bid(1, 'D'), PASS], [4, 3, 4, 2], hcp, bid(1, 'S'));
      verify('four-card major remains ahead of minor 2NT', [bid(1, 'D'), PASS], [3, 4, 4, 2], hcp, bid(1, 'H'));
    }
    expect(counts['SAYC minor 2NT with five-card support']).toBeGreaterThan(40);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('keeps public game values alive through longer natural continuations', () => {
    const failureStart = failures.length;
    for (let hcp = 13; hcp <= 19; hcp++) verify('minor 2NT response accepted', [bid(1, 'D'), PASS, bid(2, 'NT'), PASS], [3, 3, 4, 3], hcp, bid(3, 'NT'));
    for (let hcp = 18; hcp <= 19; hcp++) verify('18-19 opener rebids after 1NT response', [bid(1, 'D'), PASS, bid(1, 'NT'), PASS], [3, 3, 4, 3], hcp, bid(2, 'NT'));
    verify('responder invites after natural 1NT rebid', [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS], [4, 3, 3, 3], 11, bid(2, 'NT'));
    verify('responder invites opposite Rule-of-20 12-14 natural 1NT rebid', [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS], [4, 3, 3, 3], 12, bid(2, 'NT'));
    verify('responder bids publicly proven game after natural 1NT rebid', [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS], [4, 3, 3, 3], 13, bid(3, 'NT'));
    verify('14-point opener accepts rebid invitation', [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS, bid(2, 'NT'), PASS], [3, 3, 4, 3], 14, bid(3, 'NT'));
    verify('responder places four-card major fit in game', [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(2, 'S'), PASS], [4, 3, 3, 3], 12, bid(4, 'S'));
    verify('two-level responder places supported minor in game', [bid(1, 'D'), PASS, bid(2, 'C'), PASS, bid(3, 'C'), PASS], [3, 3, 3, 4], 13, bid(3, 'NT'));
    verify('opener answers responder trial bid', [bid(1, 'D'), PASS, bid(1, 'H'), PASS, bid(2, 'H'), PASS, bid(2, 'S'), PASS], [3, 4, 4, 2], 14, bid(4, 'H'));
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('keeps strong 2C, weak-two and direct competition thresholds coherent', () => {
    const failureStart = failures.length;
    for (let hcp = 0; hcp <= 15; hcp++) verify('strong 2C waiting response', [bid(2, 'C'), PASS], [4, 3, 3, 3], hcp, bid(2, 'D'));
    for (let hcp = 22; hcp <= 24; hcp++) verify('strong 2C balanced rebid', [bid(2, 'C'), PASS, bid(2, 'D'), PASS], [4, 3, 3, 3], hcp, bid(2, 'NT'));
    for (let hcp = 25; hcp <= 27; hcp++) verify('strong 2C 25-27 rebid', [bid(2, 'C'), PASS, bid(2, 'D'), PASS], [4, 3, 3, 3], hcp, bid(3, 'NT'));
    for (let hcp = 8; hcp <= 16; hcp++) verify('one-level natural overcall', [bid(1, 'D')], [5, 4, 3, 1], hcp, bid(1, 'S'));
    verify('below overcall floor', [bid(1, 'D')], [5, 4, 3, 1], 7, PASS);
    for (let hcp = 17; hcp <= 19; hcp++) verify('strong hand doubles first', [bid(1, 'D')], [5, 4, 3, 1], hcp, DOUBLE);
    for (let hcp = 10; hcp <= 16; hcp++) verify('sound two-level overcall', [bid(1, 'S')], [3, 5, 3, 2], hcp, bid(2, 'H'));
    for (let hcp = 6; hcp <= 9; hcp++) verify('weak two-level overcall passes', [bid(1, 'S')], [3, 5, 3, 2], hcp, PASS);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('removes every doubled Michaels and Unusual 2NT artificial contract across generated shapes', () => {
    const failureStart = failures.length;
    const shapes = generatedShapes();
    const suitIndex: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
    const bidOrder: Suit[] = ['C', 'D', 'H', 'S'];
    const contexts = (['C', 'D', 'H', 'S'] as Suit[]).flatMap(opening => [
      { convention: 'michaels' as const, opening, intervention: bid(2, opening) },
      { convention: 'unusual' as const, opening, intervention: bid(2, 'NT') }
    ]);
    for (const context of contexts) {
      const calls = [bid(1, context.opening), context.intervention, DOUBLE];
      for (const shape of shapes) {
        for (let hcp = 0; hcp <= 15; hcp++) {
          const variants = hands(shape, hcp, 1);
          if (!variants.length) continue;
          const obs = observation(calls, variants[0]);
          const semantics = analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc');
          const actual = chooseBid(obs, 'sayc');
          let expectedStrain: Strain;
          if (context.convention === 'michaels') {
            if (context.opening === 'C' || context.opening === 'D') {
              expectedStrain = shape[suitIndex.S] >= shape[suitIndex.H] ? 'S' : 'H';
            } else {
              const otherMajor: Suit = context.opening === 'H' ? 'S' : 'H';
              expectedStrain = shape[suitIndex[otherMajor]] >= 3 ? otherMajor : 'NT';
            }
          } else {
            const shown = bidOrder.filter(suit => suit !== context.opening).slice(0, 2);
            expectedStrain = shape[suitIndex[shown[1]]] > shape[suitIndex[shown[0]]] ? shown[1] : shown[0];
          }
          const publicGame = context.convention === 'michaels' && (context.opening === 'H' || context.opening === 'S')
            && expectedStrain !== 'NT' && shape[suitIndex[expectedStrain]] >= 3 && hcp >= 15;
          const expected = obs.legalCalls.find(call => call.kind === 'bid' && call.strain === expectedStrain && (!publicGame || call.level === 4));
          const prefix = `${context.convention} over 1${context.opening}, ${shape.join('-')}/${hcp}`;
          counts['doubled two-suiter advance'] = (counts['doubled two-suiter advance'] ?? 0) + 1;
          if (!semantics.mustBid || !semantics.currentContractArtificial) failures.push(`doubled two-suiter advance: forcing state lost for ${prefix}`);
          if (!obs.legalCalls.some(legal => sameCall(legal, actual))) failures.push(`doubled two-suiter advance: illegal ${label(actual)} for ${prefix}`);
          if (actual.kind === 'pass') failures.push(`doubled two-suiter advance: Pass for ${prefix}`);
          if (!expected || !sameCall(actual, expected)) failures.push(`doubled two-suiter advance: expected ${expected ? label(expected) : expectedStrain}, got ${label(actual)} for ${prefix}`);
        }
      }
    }
    expect(counts['doubled two-suiter advance']).toBeGreaterThan(10000);
    expect(failures.slice(failureStart)).toEqual([]);
  });

  it('audits 10000 uncontested full-deal auctions without treating hidden combined HCP as public knowledge', () => {
    const failureStart = failures.length;
    for (let index = 0; index < 10000; index++) {
      let game = newGame(1, `v03-sayc-full-corpus-${index}`);
      const north = evaluateHand(game.initialHands.N); const south = evaluateHand(game.initialHands.S);
      for (let guard = 0; guard < 80 && game.phase === 'auction'; guard++) {
        const call = game.turn === 'N' || game.turn === 'S' ? chooseBid(observe(game) as BiddingObservation, 'sayc') : PASS;
        game = applyCall(game, game.turn, call);
      }
      counts['uncontested full-deal auction'] = (counts['uncontested full-deal auction'] ?? 0) + 1;
      if (game.phase === 'auction') {
        failures.push(`uncontested full-deal auction: seed ${index} did not terminate`);
        continue;
      }
      const noFiveCardMajor = north.lengths.S < 5 && north.lengths.H < 5 && south.lengths.S < 5 && south.lengths.H < 5;
      if (!north.balanced || !south.balanced || !noFiveCardMajor) continue;
      const combined = north.hcp + south.hcp;
      if (combined < 25) continue;
      const contract = game.contract;
      const requiredLevel = combined >= 37 ? 7 : combined >= 33 ? 6 : contract?.strain === 'NT' ? 3 : contract && (contract.strain === 'H' || contract.strain === 'S') ? 4 : 5;
      if (!contract || sideOf(contract.declarer) !== 'NS' || contract.level < requiredLevel) {
        const northShape = suits.map(suit => north.lengths[suit]).join('-'); const southShape = suits.map(suit => south.lengths[suit]).join('-');
        reviews.push(`uncontested review: seed ${index}, balanced NS ${north.hcp}(${northShape})+${south.hcp}(${southShape}), auction ${game.auction.map(entry => label(entry.call)).join('-')}, double-dummy-known HCP suggests level ${requiredLevel}+, got ${contract ? `${contract.level}${contract.strain}` : 'passed out'}`);
      }
    }
    expect(failures.slice(failureStart)).toEqual([]);
  });
});
