import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Card, type Seat, type Strain, type Suit, PASS, SEATS } from '../src/core/types';
import { legalCalls } from '../src/core/auction';
import { chooseBid } from '../src/ai/bidding';
import { assessCandidates } from '../src/ai/constrained-sl';
import { analyzeAuctionSemantics, isArtificialBidAt, isNaturalNoTrumpAt, naturalSuitMinimum,
  noTrumpRangeAt, publicCallMeaningAt, publicKeycardTrumpAt, publicOpeningFourNTAt,
  publicOpeningMinorChoiceBefore, publicPendingResponse, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import type { BiddingObservation } from '../src/ai/observation';
import { writeFileSync } from 'node:fs';

function auction(text: string): AuctionEntry[] {
  return text.split(' ').map((token, index) => ({ seat: SEATS[index % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain } }));
}
function hand(pbn: string): Card[] {
  return pbn.split('.').flatMap((ranks, index) => [...ranks].map(rank => ({
    suit: (['S', 'H', 'D', 'C'] as Suit[])[index], rank: '23456789TJQKA'.indexOf(rank) + 2,
    id: `${index}-${rank}`,
  })));
}
function observation(text: string, pbn: string): BiddingObservation {
  const calls = auction(text), seat: Seat = SEATS[calls.length % 4];
  return { phase: 'auction', board: 1, seat, actingSeat: seat, vulnerability: 'None', auction: calls,
    hand: hand(pbn), legalCalls: legalCalls(calls, seat) };
}
const b = (level: number, strain: Strain) => ({ kind: 'bid' as const, level, strain });

describe('explicit hybrid-card opening 4NT minor choice, no neural forward', () => {
  it('prefers the actual four-card minor over a singleton in a forced choice', () => {
    const obs = observation('4NT P', 'KQJ72.963.AK43.A');
    const rule = chooseBid(obs, 'sayc');
    const candidates = assessCandidates(obs, 'sayc').filter(c => c.call.kind === 'bid'
      && c.call.level === 5 && ['C', 'D'].includes(c.call.strain));
    writeFileSync('artifacts/v325-consistency-20261108/fournt-four-card-choice-probe.json', JSON.stringify({ rule, candidates }, null, 2));
    expect(rule).toEqual(b(5, 'D'));
    expect(candidates.every(c => c.allowed)).toBe(true);
  });
  for (const system of ['sayc', 'two-over-one'] as const) {
    it(`${system}: first real 4NT promises both five-card minors without an NT point window`, () => {
      for (const text of ['4NT', 'P 4NT', 'P P 4NT', 'P P P 4NT']) {
        const calls = auction(text), index = calls.length - 1, opener = calls[index].seat;
        expect(publicOpeningFourNTAt(calls, index, system)).toBe(true);
        expect(publicCallMeaningAt(calls, index, system)).toMatchObject({ role: 'unusual',
          artificial: true, suitMinimums: { C: 5, D: 5 }, forcing: 'one-round', intent: 'inquiry' });
        expect(publicCallMeaningAt(calls, index, system).hcpRange).toBeUndefined();
        expect(noTrumpRangeAt(calls, index, system)).toBeUndefined();
        expect(isNaturalNoTrumpAt(calls, index, system)).toBe(false);
        expect(publicPlayerConstraints(calls, opener, system).suitMinimums).toEqual({ C: 5, D: 5, H: 0, S: 0 });
      }
    });

    it(`${system}: requires a natural minimum minor choice, including after a double`, () => {
      for (const text of ['4NT P', '4NT X']) {
        const calls = auction(text);
        expect(publicPendingResponse(calls, 'S', system)).toMatchObject({ kind: 'minor-choice',
          allowedCalls: [b(5, 'C'), b(5, 'D')], allowedRoles: ['two-suit-choice'], naturalOnly: true });
        expect(analyzeAuctionSemantics(calls, 'S', system)).toMatchObject({ mustBid: true,
          forcing: 'one-round', currentContractArtificial: true });
        const obs = observation(text, 'Q3.Q.KQ83.KQJT76');
        expect(chooseBid(obs, system)).toEqual(b(5, 'C'));
        const candidates = assessCandidates(obs, system);
        expect(candidates.find(x => x.call.kind === 'pass')?.allowed).toBe(false);
        for (const suit of ['C', 'D'] as const) {
          expect(candidates.find(x => x.call.kind === 'bid' && x.call.level === 5 && x.call.strain === suit)?.allowed).toBe(true);
          const answered = [...calls, { seat: 'S' as Seat, call: b(5, suit) }];
          const m = publicCallMeaningAt(answered, 2, system);
          expect(m).toMatchObject({ role: 'two-suit-choice', artificial: false, forcing: 'none',
            hcpRange: { min: 0, max: 40 }, suitMinimums: {}, intent: 'answer' });
          expect(m.supportRange).toBeUndefined();
          expect(isArtificialBidAt(answered, 2, system)).toBe(false);
          expect(analyzeAuctionSemantics(answered, 'N', system)).toMatchObject({ mustBid: false,
            forcing: 'none', currentContractArtificial: false });
          expect(naturalSuitMinimum(answered, 'S', suit, system)).toBe(0);
        }
      }
    });

    it(`${system}: permits forced zero-point short-minor choice and prefers actual minor length`, () => {
      const weak = observation('4NT P', 'T98765.98765.2.2');
      expect(chooseBid(weak, system)).toEqual(b(5, 'C'));
      expect(assessCandidates(weak, system).filter(x => x.allowed).map(x => x.call)).toEqual([b(5, 'C'), b(5, 'D')]);
      expect(chooseBid(observation('4NT X', 'Q3.Q.KQJT76.KQ83'), system)).toEqual(b(5, 'D'));
      const stopped = auction('4NT P 5C P');
      expect(publicPendingResponse(stopped, 'N', system)).toBeUndefined();
      expect(analyzeAuctionSemantics(stopped, 'N', system).mustBid).toBe(false);
    });

    it(`${system}: excludes later quantitative, keycard and enemy-intervened auctions`, () => {
      const quantitative = auction('1NT P 4NT');
      expect(publicOpeningFourNTAt(quantitative, 2, system)).toBe(false);
      expect(publicCallMeaningAt(quantitative, 2, system)).toMatchObject({ role: 'natural-nt', artificial: false, invitation: true });
      const rkcb = auction('1S P 3S P 4NT');
      expect(publicOpeningFourNTAt(rkcb, 4, system)).toBe(false);
      expect(publicKeycardTrumpAt(rkcb, 4, system)).toBe('S');
      expect(isArtificialBidAt(rkcb, 4, system)).toBe(true);
      expect(publicOpeningMinorChoiceBefore(auction('4NT 5H'), 'S', system)).toBeUndefined();
      expect(publicOpeningMinorChoiceBefore(auction('4NT P 5C P'), 'N', system)).toBeUndefined();
      expect(publicKeycardTrumpAt(auction('4NT'), 0, system)).toBeUndefined();
    });
  }

  it('keeps precision outside the opening-4NT extension', () => {
    const calls = auction('4NT P');
    expect(publicOpeningFourNTAt(calls, 0, 'precision')).toBe(false);
    expect(publicOpeningMinorChoiceBefore(calls, 'S', 'precision')).toBeUndefined();
    expect(publicPendingResponse(calls, 'S', 'precision')).toBeUndefined();
    expect(publicCallMeaningAt(calls, 0, 'precision')).toMatchObject({ role: 'unknown', defined: false });
    expect(publicPlayerConstraints(calls, 'N', 'precision').suitMinimums).toEqual({ C: 0, D: 0, H: 0, S: 0 });
  });
});
