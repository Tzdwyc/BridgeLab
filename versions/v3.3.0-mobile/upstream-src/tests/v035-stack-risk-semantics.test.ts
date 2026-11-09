import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics, classifyDoubleAt, clearPublicMeaningCaches, isArtificialBidAt, noTrumpRangeAt, publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { legalCalls, sameCall } from '../src/core/auction';
import { nextSeat, partnerOf, SEATS, type Seat, type Card, type Suit } from '../src/core/types';
import { type BiddingSystem } from '../src/ai/systems';
import { allBiddingButtons, parseAuction } from './fixtures/android-stack-incident';

const evidence = { note: 'Prefix/explanation execution counters only; semantic pass/fail is recorded by the paired Vitest JSON report.',
  cases: 0, legalPrefixes: 0, explanations: 0, historicalQueries: 0 };
afterAll(() => {
  mkdirSync('artifacts/stack-regression', { recursive: true });
  writeFileSync('artifacts/stack-regression/high-risk-prefix-summary-latest.json', JSON.stringify(evidence, null, 2));
});
function inspect(text: string, system: BiddingSystem = 'sayc', dealer: Seat = 'N') {
  const a = parseAuction(text, dealer);
  for (let end = 0; end <= a.length; end++) {
    const prefix = a.slice(0, end), actor = end ? nextSeat(prefix.at(-1)!.seat) : dealer;
    if (end < a.length) expect(legalCalls(prefix, actor).some(call => sameCall(call, a[end].call)), `${text} @${end}`).toBe(true);
    for (const button of allBiddingButtons) {
      expect(describeCall(prefix, actor, button, system).trim().length).toBeGreaterThan(0);
      evidence.explanations++;
    }
    for (let index = 0; index < prefix.length; index++) {
      expect(describeCall(prefix.slice(0, index), prefix[index].seat, prefix[index].call, system).length).toBeGreaterThan(0);
      expect(publicCallMeaningAt(prefix, index, system)).toEqual(publicCallMeaningAt(prefix.slice(0, index + 1), index, system));
      clearPublicMeaningCaches();
      const originalPrefix = prefix.slice(0, index + 1);
      expect(isArtificialBidAt(prefix, index, system), `artificial ${text} @${index}`).toBe(isArtificialBidAt(originalPrefix, index, system));
      expect(noTrumpRangeAt(prefix, index, system), `NT ${text} @${index}`).toEqual(noTrumpRangeAt(originalPrefix, index, system));
      expect(classifyDoubleAt(prefix, index, system), `double ${text} @${index}`).toBe(classifyDoubleAt(originalPrefix, index, system));
      evidence.historicalQueries++;
    }
    evidence.legalPrefixes++;
  }
  evidence.cases++;
  return a;
}
function final(text: string, system: BiddingSystem = 'sayc') {
  const a = inspect(text, system);
  return publicCallMeaningAt(a, a.length - 1, system);
}

describe('v035 stack repair preserves context-specific semantics and obligations', () => {
  for (const system of ['sayc', 'two-over-one'] as const) for (const strain of ['D', 'H', 'S'] as const) {
    for (const intervention of ['P', 'X', '3C'] as const) {
      it(`${system} weak ${strain} / ${intervention}: all seats and passed responders retain the correct 2NT meaning`, () => {
        for (const dealer of SEATS) for (const passed of [false, true]) {
          const a = inspect(`${passed ? 'P P ' : ''}2${strain} ${intervention}${intervention === '3C' ? '' : ' 2NT'}`, system, dealer);
          // 3C makes a real 2NT continuation illegal; query its disabled UI
          // explanation separately, rather than manufacture an illegal auction.
          if (intervention === '3C') {
            expect(legalCalls(a, nextSeat(a.at(-1)!.seat))).not.toContainEqual({ kind: 'bid', level: 2, strain: 'NT' });
            expect(analyzeAuctionSemantics(a, nextSeat(a.at(-1)!.seat), system).convention).not.toBe('weak-jump-inquiry');
            continue;
          }
          const index = a.length - 1, opener = a[index - 2].seat;
          expect(isArtificialBidAt(a, index, system)).toBe(intervention === 'P');
          const state = analyzeAuctionSemantics(a, opener, system);
          if (intervention === 'P') expect(state).toMatchObject({ convention: 'weak-jump-inquiry', mustBid: true, currentContractArtificial: true });
          else {
            expect(state).toMatchObject({ forcing: 'none', mustBid: false, currentContractArtificial: false });
            expect(publicCallMeaningAt(a, index, system)).toMatchObject({ defined: false, artificial: false, forcing: 'none' });
            expect(publicCallMeaningAt(a, index, system).hcpRange).toBeUndefined();
          }
        }
      });
    }
  }

  it.each(['P', 'X', '2H'] as const)('weak jump overcall followed by %s distinguishes feature inquiry from unagreed 2NT', intervention => {
    for (const dealer of SEATS) for (const passed of [false, true]) {
      const a = inspect(`${passed ? 'P P ' : ''}1C 2D ${intervention} 2NT`, 'sayc', dealer), index = a.length - 1;
      const asker = a[index].seat, overcaller = partnerOf(asker);
      expect(isArtificialBidAt(a, index, 'sayc')).toBe(intervention === 'P');
      const state = analyzeAuctionSemantics(a, overcaller, 'sayc');
      if (intervention === 'P') expect(state).toMatchObject({ convention: 'weak-jump-inquiry', mustBid: true, currentContractArtificial: true });
      else {
        expect(state).toMatchObject({ forcing: 'none', mustBid: false, currentContractArtificial: false });
        expect(publicCallMeaningAt(a, index, 'sayc')).toMatchObject({ defined: false, artificial: false, forcing: 'none' });
        expect(publicCallMeaningAt(a, index, 'sayc').hcpRange).toBeUndefined();
      }
    }
  });

  it('redouble and opponent natural interference do not resurrect an unanswered weak inquiry', () => {
    for (const text of ['2H X XX P 2NT', '1C 2D X XX 2H 2NT']) {
      const a = inspect(text);
      expect(publicCallMeaningAt(a, a.length - 1).artificial).toBe(false);
      expect(analyzeAuctionSemantics(a, partnerOf(a.at(-1)!.seat), 'sayc').convention).not.toBe('weak-jump-inquiry');
    }
  });

  it('an established 2NT inquiry survives a later X but has no unagreed reply over a natural enemy bid', () => {
    for (const opening of ['2H P 2NT', '1C 2D P 2NT']) {
      for (const interference of ['X', '3C']) {
        const a = inspect(`${opening} ${interference}`), asker = a[a.length - 2].seat;
        expect(isArtificialBidAt(a, a.length - 2)).toBe(true);
        expect(analyzeAuctionSemantics(a, partnerOf(asker), 'sayc').mustBid).toBe(interference === 'X');
      }
    }
  });

  it.each([
    ['1C 2C X', 'michaels-advance', 'W', '2H'],
    ['1S 2NT X', 'unusual-advance', 'W', '3C'],
    ['1C 1H P 2C X', 'support-cue', 'E', '2H'],
  ] as const)('%s retains the artificial-answer obligation after X and ends it after natural selection', (text, convention, actor, answer) => {
    const a = inspect(text);
    expect(analyzeAuctionSemantics(a, actor, 'sayc')).toMatchObject({ mustBid: true, currentContractArtificial: true });
    if (convention !== 'support-cue') expect(analyzeAuctionSemantics(a, actor, 'sayc').convention).toBe(convention);
    const answered = inspect(`${text} ${answer} P`);
    expect(publicCallMeaningAt(answered, a.length)).toMatchObject({ artificial: false, forcing: 'none' });
    expect(analyzeAuctionSemantics(answered, partnerOf(actor), 'sayc').mustBid).toBe(false);
  });

  it('natural enemy intervention releases the pending Michaels/Unusual choice', () => {
    for (const text of ['1C 2C 3C', '1S 2NT 3S']) {
      const a = inspect(text);
      expect(analyzeAuctionSemantics(a, 'W', 'sayc').mustBid).toBe(false);
    }
  });

  it('Stayman and transfers keep real positive meanings while completed answers release their own obligation', () => {
    expect(final('1NT P 2C')).toMatchObject({ role: 'stayman', artificial: true, forcing: 'one-round' });
    expect(final('1NT P 2D')).toMatchObject({ role: 'transfer', artificial: true, suitMinimums: { H: 5 } });
    const doubled = inspect('1NT P 2D X');
    expect(analyzeAuctionSemantics(doubled, 'N', 'sayc')).toMatchObject({ mustBid: true });
    const blocked = inspect('1NT P 2D 2S');
    expect(analyzeAuctionSemantics(blocked, 'N', 'sayc')).toMatchObject({ mustBid: false });
    expect(final('1NT P 2D P 2H')).toMatchObject({ role: 'transfer-acceptance', artificial: false, forcing: 'none' });
    const denial = inspect('1NT P 2C P 2D P');
    expect(analyzeAuctionSemantics(denial, 'S', 'sayc').mustBid).toBe(false);
  });

  it('strong 2C waiting, second negative, and a completed natural game retain their distinct obligations', () => {
    expect(final('2C')).toMatchObject({ role: 'strong-opening', artificial: true, hcpRange: { min: 22, max: 40 } });
    const waiting = inspect('2C P 2D P');
    expect(analyzeAuctionSemantics(waiting, 'N', 'sayc')).toMatchObject({ mustBid: true, convention: 'waiting-response' });
    expect(final('2C P 2D P 2H P 3C')).toMatchObject({ role: 'artificial-response', artificial: true, hcpRange: { min: 0, max: 3 } });
    const minimum = inspect('2C P 2D P 2H P 3C P 3H P');
    expect(analyzeAuctionSemantics(minimum, 'S', 'sayc').mustBid).toBe(false);
    expect(analyzeAuctionSemantics(inspect('2C P 2D P 4H P'), 'S', 'sayc').mustBid).toBe(false);
  });

  it('fourth-suit inquiry is forcing only with an unpassed responder, and natural NT answers resolve it', () => {
    expect(final('1C P 1H P 1S P 2D')).toMatchObject({ role: 'fourth-suit', artificial: true, forcing: 'one-round' });
    expect(final('1C P 1H P 1S P 2D P 2NT')).toMatchObject({ role: 'fourth-suit-nt-answer', artificial: false, hcpRange: { min: 12, max: 14 } });
    const passed = inspect('P P 1C P 1H P 1S P 2D P');
    expect(analyzeAuctionSemantics(passed, 'S', 'sayc').mustBid).toBe(false);
  });

  it('same low new minor is natural in SAYC and a new-minor inquiry in 2/1', () => {
    const text = '1C P 1S P 1NT P 2D P';
    const sayc = inspect(text, 'sayc'), two = inspect(text, 'two-over-one');
    expect(publicCallMeaningAt(sayc, 6, 'sayc')).toMatchObject({ artificial: false, forcing: 'none', suitMinimum: 5 });
    expect(analyzeAuctionSemantics(sayc, 'N', 'sayc').mustBid).toBe(false);
    expect(isArtificialBidAt(two, 6, 'two-over-one')).toBe(true);
    expect(analyzeAuctionSemantics(two, 'N', 'two-over-one')).toMatchObject({ convention: 'new-minor', mustBid: true });
  });

  it('RKCB remains artificial after X while quantitative 4NT has no fabricated keycard obligation', () => {
    const rkcb = inspect('1S P 3S P 4NT X');
    expect(publicCallMeaningAt(rkcb, 4)).toMatchObject({ artificial: true });
    expect(analyzeAuctionSemantics(rkcb, 'S', 'sayc')).toMatchObject({ mustBid: true, convention: 'keycard' });
    const quantitative = inspect('1NT P 4NT P');
    expect(publicCallMeaningAt(quantitative, 2)).toMatchObject({ artificial: false, invitation: true, forcing: 'none' });
    expect(analyzeAuctionSemantics(quantitative, 'N', 'sayc').mustBid).toBe(false);
  });

  it('a real 10-HCP responder with two keys and the trump queen answers doubled RKCB 1430 with 5S', () => {
    const a = inspect('1S P 3S P 4NT X');
    const hand: Card[] = ['KQ2', 'A432', 'J876', '32'].flatMap((holding, suitIndex) =>
      [...holding].map(symbol => {
        const suit = (['S', 'H', 'D', 'C'] as Suit[])[suitIndex], rank = '23456789TJQKA'.indexOf(symbol) + 2;
        return { suit, rank, id: `${suit}${rank}` };
      }));
    expect(hand).toHaveLength(13);
    expect(chooseBid({ phase: 'auction', board: 1, vulnerability: 'None', seat: 'S', actingSeat: 'S', hand,
      auction: a, legalCalls: legalCalls(a, 'S') }, 'sayc')).toEqual({ kind: 'bid', level: 5, strain: 'S' });
  });

  it('the same 2C is a strong artificial opening in SAYC and a limited natural club opening in Precision', () => {
    expect(final('2C', 'sayc')).toMatchObject({ artificial: true, hcpRange: { min: 22, max: 40 } });
    expect(final('2C', 'precision')).toMatchObject({ artificial: false, hcpRange: { min: 11, max: 15 }, suitMinimums: { C: 5 } });
    const shape = inspect('2D P 2NT P 3D P', 'precision');
    expect(publicCallMeaningAt(shape, 4, 'precision')).toMatchObject({ artificial: true,
      suitMinimums: { S: 4, H: 4, C: 5 }, suitMaximums: { S: 4, H: 4, D: 0, C: 5 } });
    expect(analyzeAuctionSemantics(shape, 'S', 'precision').mustBid).toBe(true);
  });
});
