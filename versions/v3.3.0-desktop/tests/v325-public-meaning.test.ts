import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type AuctionEntry, type Seat, type Strain, PASS } from '../src/core/types';
import { analyzeAuctionSemantics, isArtificialBidAt, isNaturalNoTrumpAt, naturalSuitMinimum,
  noTrumpRangeAt, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function auction(text: string): AuctionEntry[] {
  return text.split(' ').map((token, index) => ({ seat: seats[index % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' }
      : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain } }));
}
const cases = {
  comp0035: '1D X P 1H 2NT P 3NT',
  ordinary0047: '2H 2NT',
  slam0014: '1C P 3NT P 4NT P 6NT',
  long0030: '1S P 2C P 3S P 4S',
  long0027: '1D P 1H P 1S P 2C P 2S P 4S',
  long0048: '1H P 1S P 2C P 2D P 4S',
  long0062: '1D P 1S P 1NT P 3C',
};
const naturalSystems = ['sayc', 'two-over-one'] as const;
function meaning(text: string, system: typeof naturalSystems[number]) {
  const calls = auction(text);
  return publicCallMeaningAt(calls, calls.length - 1, system);
}

describe('v3.2.5 public meaning consistency', () => {
  it('captures the bounded public contracts without running bidding or a model', () => {
    if (!process.env.V325_SEMANTIC_CAPTURE) return;
    const result = Object.fromEntries(Object.entries(cases).map(([id, text]) => [id,
      Object.fromEntries((['sayc', 'two-over-one'] as const).map(system => {
        const calls = auction(text), last = calls.length - 1;
        return [system, { auction: calls, meanings: calls.map((_, i) => publicCallMeaningAt(calls, i, system)),
          actorConstraints: publicPlayerConstraints(calls, calls[last].seat, system),
          partnerConstraints: publicPlayerConstraints(calls.slice(0, last), seats[(last + 2) % 4], system),
          nextState: analyzeAuctionSemantics(calls, seats[(last + 2) % 4], system) }];
      }))]));
    mkdirSync('artifacts/v325-consistency-20261108', { recursive: true });
    writeFileSync(`artifacts/v325-consistency-20261108/semantic-${process.env.V325_SEMANTIC_CAPTURE}.json`, JSON.stringify(result, null, 2) + '\n');
    expect(Object.keys(result)).toHaveLength(7);
  });

  for (const system of naturalSystems) {
    it(`${system}: retains the strong opener NT rebid and partner stopper source`, () => {
      const calls = auction(cases.comp0035);
      expect(noTrumpRangeAt(calls, 4, system)).toEqual({ min: 18, max: 19 });
      expect(publicCallMeaningAt(calls, 6, system)).toMatchObject({ role: 'natural-nt',
        hcpRange: { min: 7, max: 40 }, forcing: 'none', intent: 'signoff' });
      expect(publicCallMeaningAt(calls, 6, system).stopperSources)
        .toContainEqual({ suit: 'H', index: 4, seat: 'N' });
    });

    it(`${system}: defines direct weak-two 2NT without changing unusual 2NT`, () => {
      for (const suit of ['D', 'H', 'S']) {
        const calls = auction(`2${suit} 2NT`);
        expect(noTrumpRangeAt(calls, 1, system)).toEqual({ min: 15, max: 18 });
        expect(isNaturalNoTrumpAt(calls, 1, system)).toBe(true);
        expect(publicCallMeaningAt(calls, 1, system)).toMatchObject({ role: 'natural-nt',
          artificial: false, hcpRange: { min: 15, max: 18 }, suitMinimums: { C: 2, D: 2, H: 2, S: 2 } });
        expect(publicCallMeaningAt(calls, 1, system).stopperSources)
          .toContainEqual({ suit, index: 1, seat: 'E' });
      }
      const unusual = auction('1H 2NT');
      if (system === 'sayc') expect(isArtificialBidAt(unusual, 1, system)).toBe(true);
      expect(isNaturalNoTrumpAt(unusual, 1, system)).toBe(false);
      expect(noTrumpRangeAt(unusual, 1, system)).toBeUndefined();
    });

    it(`${system}: shares natural minor 3NT and the subsequent quantitative platform`, () => {
      for (const suit of ['C', 'D']) {
        const calls = auction(`1${suit} P 3NT P 4NT P 6NT`);
        expect(noTrumpRangeAt(calls, 2, system)).toEqual({ min: 13, max: 40 });
        expect(publicCallMeaningAt(calls, 4, system)).toMatchObject({ artificial: false,
          invitation: true, hcpRange: { min: 18, max: 21 } });
        expect(publicCallMeaningAt(calls, 6, system)).toMatchObject({ artificial: false,
          hcpRange: { min: 15, max: 40 }, forcing: 'none', intent: 'signoff' });
        expect(publicCallMeaningAt(calls, 2, system).suitMinimums).toEqual({});
      }
      expect(isArtificialBidAt(auction('1S P 2NT'), 2, system)).toBe(true);
    });

    it(`${system}: distinguishes the first 3M jump rebid from a five-card 2M rebid`, () => {
      const jump = auction(cases.long0030);
      expect(naturalSuitMinimum(jump.slice(0, 5), 'N', 'S', system)).toBe(6);
      expect(publicCallMeaningAt(jump, 6, system)).toMatchObject({ role: 'natural-support',
        suitMinimum: 2, hcpRange: { min: 13, max: 40 } });
      expect(publicPlayerConstraints(jump, 'S', system).suitMinimums.S).toBe(2);
      const nonjump = auction('1S P 2C P 2S P 4S');
      expect(naturalSuitMinimum(nonjump.slice(0, 5), 'N', 'S', system)).toBe(5);
      expect(publicCallMeaningAt(nonjump, 6, system).suitMinimum).toBe(3);
      expect(naturalSuitMinimum(auction('1D P 1H P 1S P 2C P 2S'), 'N', 'S', system)).toBe(4);
    });

    it(`${system}: keeps delayed three-card support distinct from a public eight-card fit`, () => {
      for (const text of [cases.long0027, cases.long0048]) {
        const calls = auction(text), actor = calls.at(-1)!.seat;
        const call = publicCallMeaningAt(calls, calls.length - 1, system);
        expect(call).toMatchObject({ role: 'natural-support', suitMinimum: 3, artificial: false });
        expect(call.supportRange).toBeUndefined();
        expect(publicPlayerConstraints(calls, actor, system).suitMinimums.S).toBe(3);
        const partner = seats[(seats.indexOf(actor) + 2) % 4];
        expect(publicPlayerConstraints(calls.slice(0, -1), partner, system).suitMinimums.S).toBe(4);
      }
      expect(meaning('1H P 1S P 4S', system).suitMinimum).toBe(4);
      expect(meaning('1D P 1H P 1S P 4S', system).suitMinimum).toBe(4);
    });

    it(`${system}: preserves the six-card invitation after 1m-1M-1NT and permits opener to pass`, () => {
      const calls = auction(cases.long0062);
      expect(meaning(cases.long0062, system)).toMatchObject({ role: 'long-minor-invitation',
        suitMinimum: 6, hcpRange: { min: 10, max: 12 }, forcing: 'none', invitation: true, artificial: false });
      expect(analyzeAuctionSemantics(calls, 'N', system)).toMatchObject({ forcing: 'none', mustBid: false });
      expect(naturalSuitMinimum(calls, 'S', 'C', system)).toBe(6);
      expect(publicCallMeaningAt([...calls, { seat: 'W', call: PASS }, { seat: 'N', call: PASS }], 6, system))
        .toEqual(publicCallMeaningAt(calls, 6, system));
    });
  }
});
