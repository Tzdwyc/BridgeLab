import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { assessCandidates } from '../src/ai/constrained-sl';
import { pendingResponseViolation, publicPendingResponse } from '../src/ai/bidding-semantics';
import { type BiddingObservation } from '../src/ai/observation';
import { legalCalls, sameCall } from '../src/core/auction';
import { type Call, type Card, type Seat, type Suit } from '../src/core/types';
import { parseAuction } from './fixtures/android-stack-incident';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
const call = (token: string): Call => parseAuction(token)[0].call;
function observation(prefix: string, holding: string): BiddingObservation {
  const auction = parseAuction(prefix), seat = seats[auction.length % 4];
  const hand: Card[] = holding.split('.').flatMap((text, i) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { id: `${suit}${rank}`, suit, rank };
  }));
  expect(hand).toHaveLength(13);
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat, hand, auction, legalCalls: legalCalls(auction, seat) };
}

describe.each(['sayc', 'two-over-one'] as const)('v327 %s cue-response qualification uses public membership', system => {
  // Reuse the own holding and prefix from bidding-model-findings.test.ts:73.
  const prefix = '1C 1H P 2C X', holding = 'T8.AQJ76.KJ92.64';
  it('accepts the real four-card second suit after an enemy double of partner cue', () => {
    const obs = observation(prefix, holding);
    expect(publicPendingResponse(obs.auction, obs.seat, system)).toEqual({
      kind: 'cue-response', naturalOnly: true, allowedRoles: ['keycard-ask'],
    });
    const twoDiamonds = assessCandidates(obs, system).find(candidate => sameCall(candidate.call, call('2D')))!;
    expect(twoDiamonds).toMatchObject({ allowed: true, reasons: [], meaning: {
      defined: true, artificial: false, role: 'natural-second-suit', suitMinimum: 4, forcing: 'none', intent: 'answer',
    } });
    // The repaired layer qualifies 2D; it does not replace either chooser.
    if (system === 'sayc') expect(chooseBid(obs, system)).toEqual(call('2D'));
  });
  it('matches public cue membership for every legal candidate without waiving its hand checks', () => {
    const obs = observation(prefix, holding), pending = publicPendingResponse(obs.auction, obs.seat, system)!;
    for (const candidate of assessCandidates(obs, system)) {
      expect(candidate.reasons.includes('pending-cue-response')).toBe(Boolean(pendingResponseViolation(
        pending, candidate.call, candidate.meaning.artificial, candidate.meaning.role,
      )));
    }
    const twoSpades = assessCandidates(obs, system).find(candidate => sameCall(candidate.call, call('2S')))!;
    expect(twoSpades.allowed).toBe(false);
    expect(twoSpades.reasons).toContain('natural-suit-minimum');
  });
  it('does not turn Pass, X, XX or an unrecognized artificial cue into an answer', () => {
    const obs = observation(prefix, holding), pending = publicPendingResponse(obs.auction, obs.seat, system)!;
    // X is unavailable over the enemy X; membership still must not bless it.
    for (const token of ['P', 'X', 'XX']) {
      expect(pendingResponseViolation(pending, call(token), false, 'unknown')).toBeDefined();
    }
    const candidates = assessCandidates(obs, system);
    expect(candidates.find(candidate => sameCall(candidate.call, call('P')))!.allowed).toBe(false);
    expect(candidates.find(candidate => sameCall(candidate.call, call('XX')))!.allowed).toBe(false);
    expect(pendingResponseViolation(pending, call('3C'), true, 'unknown')).toBeDefined();
    // This public prefix actually labels 3C natural, so the real two-card
    // holding must still fail length rather than invent an artificial role.
    const jumpCue = candidates.find(candidate => sameCall(candidate.call, call('3C')))!;
    expect(jumpCue.allowed).toBe(false);
    expect(jumpCue.reasons).toContain('natural-suit-minimum');
  });
  it('keeps the enemy real second suit out of the natural response', () => {
    const obs = observation('1C 1H P 2C 2D', holding);
    expect(chooseBid(obs, system)).toEqual(call('2H'));
    const threeDiamonds = assessCandidates(obs, system).find(candidate => sameCall(candidate.call, call('3D')))!;
    expect(threeDiamonds.meaning).toMatchObject({ defined: false, role: 'unknown' });
    expect(threeDiamonds.allowed).toBe(false);
    expect(threeDiamonds.reasons).toContain('undefined-convention');
  });
  it('permits the existing RKCB protocol exception while retaining its real resource gates', () => {
    // Public RKCB prefix and own holding reused from v323 protocol fixtures.
    const obs = observation(prefix, 'A.AKQJ9.AK4.8765');
    const pending = publicPendingResponse(obs.auction, obs.seat, system)!;
    expect(pending.kind).toBe('cue-response');
    const candidate = assessCandidates(obs, system).find(row => sameCall(row.call, call('4NT')))!;
    expect(candidate.meaning).toMatchObject({ defined: true, artificial: true, role: 'keycard-ask', agreedTrump: 'H' });
    expect(pendingResponseViolation(pending, candidate.call, true, candidate.meaning.role)).toBeUndefined();
    expect(candidate.reasons).not.toContain('pending-cue-response');
    expect(candidate.reasons).toContain('keycard-missing-side-control');
    expect(candidate.allowed).toBe(false);
  });
  it.each([
    ['1NT P 2C P', 'K2.QJ74.A863.K65', '3NT', 'stayman'],
    ['1H 2S P 2NT P', 'KJ7432.6.A9.K852', '4S', 'feature'],
    ['1S 2H 3H 3S 4H 4NT P', 'K2.QJ74.A863.K65', '5NT', 'keycard'],
  ])('retains exact non-cue membership for %s', (auction, hand, token, kind) => {
    const obs = observation(auction, hand);
    expect(publicPendingResponse(obs.auction, obs.seat, system)?.kind).toBe(kind);
    const candidate = assessCandidates(obs, system).find(row => sameCall(row.call, call(token)))!;
    expect(candidate.allowed).toBe(false);
    expect(candidate.reasons).toContain(`pending-${kind}`);
  });
  it('does not allow a natural answer to replace a still-pending exact RKCB reply', () => {
    const obs = observation('1S 2H 3H 3S 4H 4NT P', 'K2.QJ74.A863.K65');
    const candidates = assessCandidates(obs, system);
    for (const token of ['P', '5NT', '6H']) {
      expect(candidates.find(row => sameCall(row.call, call(token)))!.reasons).toContain('pending-keycard');
    }
    const incorrect = candidates.find(row => sameCall(row.call, call('5D')))!;
    expect(incorrect.reasons).toContain('rkcb-exact-keycard-answer');
  });
});
