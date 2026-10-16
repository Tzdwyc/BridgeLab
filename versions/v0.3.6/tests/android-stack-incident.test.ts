import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { classifyDoubleAt, clearPublicMeaningCaches, isArtificialBidAt, noTrumpRangeAt, publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { legalCalls, sameCall } from '../src/core/auction';
import { applyCall, newGame } from '../src/core/game';
import { nextSeat, type AuctionEntry, type Seat } from '../src/core/types';
import { type BiddingSystem } from '../src/ai/systems';
import { decodeSession, encodeSession } from '../src/persistence/session';
import { allBiddingButtons, incidentGame, incidentSeed, incidentSession } from './fixtures/android-stack-incident';

const evidence = { incidentSeed, boards: 0, prefixes: 0, buttonExplanations: 0, historyExplanations: 0,
  appendedPrefixComparisons: 0, systems: ['sayc', 'two-over-one', 'precision'], completed: [] as object[] };
afterAll(() => {
  mkdirSync('artifacts/stack-regression', { recursive: true });
  writeFileSync('artifacts/stack-regression/incident-random-summary.json', JSON.stringify(evidence, null, 2));
});

export function explainPrefix(auction: AuctionEntry[], seat: Seat, system: BiddingSystem) {
  evidence.prefixes++;
  expect(allBiddingButtons).toHaveLength(38);
  for (const call of allBiddingButtons) {
    expect(describeCall(auction, seat, call, system).trim().length).toBeGreaterThan(0);
    evidence.buttonExplanations++;
  }
  for (let index = 0; index < auction.length; index++) {
    // Historical tooltip API receives the original prefix, not the whole later auction.
    const entry = auction[index], before = auction.slice(0, index);
    expect(describeCall(before, entry.seat, entry.call, system).trim().length).toBeGreaterThan(0);
    const original = publicCallMeaningAt(auction.slice(0, index + 1), index, system);
    expect(publicCallMeaningAt(auction, index, system)).toEqual(original);
    clearPublicMeaningCaches();
    const originalPrefix = auction.slice(0, index + 1);
    expect(isArtificialBidAt(auction, index, system)).toBe(isArtificialBidAt(originalPrefix, index, system));
    expect(noTrumpRangeAt(auction, index, system)).toEqual(noTrumpRangeAt(originalPrefix, index, system));
    expect(classifyDoubleAt(auction, index, system)).toBe(classifyDoubleAt(originalPrefix, index, system));
    evidence.historyExplanations++;
  }
}

describe('v0.3.5 exact Android stack incident and independent complete auctions', () => {
  it('renders all 38 controls including legal 2NT and disabled 1C for W:P N:2H E:X', () => {
    const game = incidentGame();
    expect(game.turn).toBe('S');
    expect(game.auction.map(entry => entry.seat)).toEqual(['W', 'N', 'E']);
    expect(legalCalls(game.auction, 'S')).toContainEqual({ kind: 'bid', level: 2, strain: 'NT' });
    expect(legalCalls(game.auction, 'S')).not.toContainEqual({ kind: 'bid', level: 1, strain: 'C' });
    for (let end = 0; end <= game.auction.length; end++) {
      const prefix = game.auction.slice(0, end), seat = end ? nextSeat(prefix.at(-1)!.seat) : game.dealer;
      explainPrefix(prefix, seat, 'sayc');
    }
    expect(describeCall(game.auction, 'S', { kind: 'bid', level: 2, strain: 'NT' }, 'sayc')).not.toContain('不叫不符合');
    const selected = chooseBid(observe(game) as BiddingObservation, 'sayc');
    expect(legalCalls(game.auction, 'S').some(call => sameCall(call, selected))).toBe(true);
  });

  it('round-trips full reported current actions with 19 explicitly synthetic continuity records', () => {
    const raw = encodeSession(incidentSession()), restored = decodeSession(raw);
    expect(restored.history).toHaveLength(19);
    expect(restored.game).toEqual(incidentGame());
    expect(encodeSession(restored)).toBe(raw);
  });

  for (const system of evidence.systems as BiddingSystem[]) {
    it(`${system}: 20 deterministic independent auctions inspect every control and original historical prefix`, () => {
      for (let board = 1; board <= 20; board++) {
        clearPublicMeaningCaches();
        let game = newGame(board, `v035-independent-stack-${system}-${board}`), steps = 0;
        while (game.phase === 'auction' && steps++ < 100) {
          explainPrefix(game.auction, game.turn, system);
          const oldMeanings = game.auction.map((_, index) => ({ meaning: publicCallMeaningAt(game.auction, index, system),
            artificial: isArtificialBidAt(game.auction.slice(0, index + 1), index, system),
            ntRange: noTrumpRangeAt(game.auction.slice(0, index + 1), index, system),
            double: classifyDoubleAt(game.auction.slice(0, index + 1), index, system) }));
          const call = chooseBid(observe(game) as BiddingObservation, system);
          expect(legalCalls(game.auction, game.turn).some(legal => sameCall(legal, call))).toBe(true);
          game = applyCall(game, game.turn, call);
          clearPublicMeaningCaches();
          oldMeanings.forEach((original, index) => {
            expect(publicCallMeaningAt(game.auction, index, system)).toEqual(original.meaning);
            expect(isArtificialBidAt(game.auction, index, system)).toBe(original.artificial);
            expect(noTrumpRangeAt(game.auction, index, system)).toEqual(original.ntRange);
            expect(classifyDoubleAt(game.auction, index, system)).toBe(original.double);
            evidence.appendedPrefixComparisons++;
          });
        }
        expect(game.phase).not.toBe('auction');
        evidence.boards++;
        evidence.completed.push({ system, board, calls: game.auction.length, phase: game.phase, contract: game.contract });
      }
    }, 120000);
  }
});
