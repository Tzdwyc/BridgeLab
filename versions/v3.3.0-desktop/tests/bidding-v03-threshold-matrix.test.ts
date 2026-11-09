import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { decidePrecisionBid, diagnosePrecisionBid } from '../src/ai/precision';
import { type BiddingSystem } from '../src/ai/systems';
import { applyCall, newGame } from '../src/core/game';
import { sameCall } from '../src/core/auction';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, PASS } from '../src/core/types';
import { analyzeAuctionSemantics, noTrumpRangeAt, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });

function hand(target: number, shape: readonly [number, number, number, number] = [3, 3, 4, 3]): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((sum, rank) => sum + rank - 10, 0);
      const low = shape[index] - honors.length;
      if (low < 0 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (rest) return [...honors, ...Array.from({ length: low }, (_, offset) => 10 - offset)].map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })).concat(rest);
    }
    return null;
  };
  const result = visit(0, target);
  if (!result || result.length !== 13) throw new Error(`Cannot construct balanced ${target}-HCP hand`);
  expect(evaluateHand(result).hcp).toBe(target);
  return result;
}

function observation(calls: Call[], hcp: number, shape?: readonly [number, number, number, number]): BiddingObservation {
  let game = newGame(1, `v03-nt-matrix-${hcp}`);
  for (const call of calls) game = applyCall(game, game.turn, call);
  const obs = observe(game) as BiddingObservation; obs.hand = hand(hcp, shape); return obs;
}

type Matrix = { name: string; system: BiddingSystem; calls: Call[]; from: number; to: number; expected: (hcp: number) => Call };
const matrices: Matrix[] = [
  {
    name: '2/1 15-17 1NT opening', system: 'two-over-one', calls: [bid(1, 'NT'), PASS], from: 0, to: 24,
    expected: hcp => hcp >= 22 ? bid(7, 'NT') : hcp >= 20 ? bid(5, 'NT') : hcp >= 18 ? bid(6, 'NT') : hcp >= 16 ? bid(4, 'NT') : hcp >= 10 ? bid(3, 'NT') : hcp >= 8 ? bid(2, 'NT') : PASS
  },
  {
    name: 'Precision 13-15 1NT opening', system: 'precision', calls: [bid(1, 'NT'), PASS], from: 0, to: 26,
    expected: hcp => hcp >= 24 ? bid(7, 'NT') : hcp >= 22 ? bid(5, 'NT') : hcp >= 20 ? bid(6, 'NT') : hcp >= 18 ? bid(4, 'NT') : hcp >= 12 ? bid(3, 'NT') : hcp >= 10 ? bid(2, 'NT') : PASS
  },
  {
    name: '2/1 20-21 2NT opening', system: 'two-over-one', calls: [bid(2, 'NT'), PASS], from: 0, to: 20,
    expected: hcp => hcp >= 17 ? bid(7, 'NT') : hcp >= 16 ? bid(5, 'NT') : hcp >= 13 ? bid(6, 'NT') : hcp >= 12 ? bid(4, 'NT') : hcp >= 5 ? bid(3, 'NT') : PASS
  },
  {
    name: 'Precision 22-23 2NT opening', system: 'precision', calls: [bid(2, 'NT'), PASS], from: 0, to: 18,
    expected: hcp => hcp >= 15 ? bid(7, 'NT') : hcp >= 14 ? bid(5, 'NT') : hcp >= 11 ? bid(6, 'NT') : hcp >= 10 ? bid(4, 'NT') : hcp >= 3 ? bid(3, 'NT') : PASS
  },
  {
    name: 'strong 2C 22-24 2NT rebid', system: 'two-over-one', calls: [bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'NT'), PASS], from: 0, to: 18,
    expected: hcp => hcp >= 15 ? bid(7, 'NT') : hcp >= 13 ? bid(5, 'NT') : hcp >= 11 ? bid(6, 'NT') : hcp >= 9 ? bid(4, 'NT') : hcp >= 3 ? bid(3, 'NT') : PASS
  },
  {
    // The 1D negative publicly caps responder at seven. Higher hands use
    // the genuine strong-club positive response below, never this prefix.
    name: 'Precision strong club 16-18 1NT rebid after a genuine negative', system: 'precision', calls: [bid(1, 'C'), PASS, bid(1, 'D'), PASS, bid(1, 'NT'), PASS], from: 0, to: 7,
    expected: hcp => hcp === 7 ? bid(2, 'NT') : PASS
  },
  {
    // These replace the contradictory nine-to-24-HCP self-negative rows.
    // The first response has no previous responder promise: 8-13 shows
    // natural 1NT, 14+ natural 2NT, and either positive establishes GF.
    // Quantitative 4NT/5NT windows remain covered by the genuine Precision
    // 13-15 1NT-opening matrix, through the production Precision endpoint.
    name: 'Precision strong club genuine balanced positive', system: 'precision', calls: [bid(1, 'C'), PASS], from: 8, to: 24,
    expected: hcp => bid(hcp >= 14 ? 2 : 1, 'NT')
  },
  {
    name: 'natural 18-19 jump 2NT rebid', system: 'two-over-one', calls: [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(2, 'NT'), PASS], from: 0, to: 22,
    expected: hcp => hcp >= 19 ? bid(7, 'NT') : hcp >= 18 ? bid(5, 'NT') : hcp >= 15 ? bid(6, 'NT') : hcp >= 14 ? bid(4, 'NT') : hcp >= 7 ? bid(3, 'NT') : PASS
  }
];

describe('v0.3 continuous no-trump game and slam threshold matrix', () => {
  for (const matrix of matrices) {
    for (let points = matrix.from; points <= matrix.to; points++) {
      it(`${matrix.name}: ${points} HCP`, () => {
        const obs = observation(matrix.calls, points), expected = matrix.expected(points);
        const call = matrix.system === 'precision' ? decidePrecisionBid(obs) : chooseBid(obs, matrix.system);
        expect(call).toEqual(expected);
        if (matrix.system === 'precision') {
          const decision = diagnosePrecisionBid(obs);
          expect(decision.status).toBe('supported');
          expect(decision.candidates.find(candidate => sameCall(candidate.call, call))?.allowed).toBe(true);
        }
        if (expected.kind === 'bid' && [4, 5].includes(expected.level) && expected.strain === 'NT') {
          const numericPlatform = obs.auction.map((entry, index) => ({ entry, index }))
            .findLast(({ entry, index }) => entry.seat !== obs.seat && entry.call.kind === 'bid' && entry.call.strain === 'NT' && noTrumpRangeAt(obs.auction, index, matrix.system));
          expect(numericPlatform).toBeDefined();
          const range = noTrumpRangeAt(obs.auction, numericPlatform!.index, matrix.system)!;
          const threshold = expected.level === 4 ? 33 : 37;
          expect(points + range.min).toBeGreaterThanOrEqual(threshold - 2);
          expect(points + range.min).toBeLessThan(threshold);
          expect(points + range.max).toBeGreaterThanOrEqual(threshold);
          const auctionWithInvite = [...obs.auction, { seat: obs.seat, call: expected }];
          expect(publicCallMeaningAt(auctionWithInvite, obs.auction.length, matrix.system)).toMatchObject({
            defined: true, artificial: false, intent: expected.level === 4 ? 'invitation' : 'grand-inv'
          });
        }
        if (expected.kind === 'bid' && expected.level === 5 && expected.strain === 'NT') {
          // 37 is reachable opposite the top of the public NT band, but not
          // guaranteed at its bottom: invite grand, already committed to six.
          const withInvitation = [...obs.auction, { seat: obs.seat, call: expected }];
          expect(publicCallMeaningAt(withInvitation, withInvitation.length - 1, matrix.system).intent).toBe('grand-inv');
          expect(analyzeAuctionSemantics(withInvitation, obs.auction[0].seat, matrix.system).mustBid).toBe(true);
        }
      });
    }
  }
  it('Precision eight-point replacement preserves the prior 0-7 negative as a contradictory-prefix guard', () => {
    const calls = [bid(1, 'C'), PASS, bid(1, 'D'), PASS, bid(1, 'NT'), PASS];
    const obs = observation(calls, 8);
    expect(evaluateHand(obs.hand).hcp).toBe(8);
    expect(publicCallMeaningAt(obs.auction, 2, 'precision').hcpRange).toEqual({ min: 0, max: 7 });
    expect(publicPlayerConstraints(obs.auction, obs.seat, 'precision').hcpRange?.max).toBe(7);
    const invite = publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: bid(2, 'NT') }], obs.auction.length, 'precision');
    expect(invite).toMatchObject({ defined: true, hcpRange: { min: 7, max: 7 } });
    // Pass is a guard result for contradictory synthetic input, not evidence
    // that a real eight-point responder should make the initial negative.
    expect(chooseBid(obs, 'precision')).toEqual(PASS);
    expect(decidePrecisionBid(obs)).toEqual(PASS);
  });
});

describe('v0.3 invitation acceptance boundaries', () => {
  for (const [system, minimum, maximum] of [['two-over-one', 15, 17], ['precision', 13, 15]] as const) {
    for (let points = minimum; points <= maximum; points++) {
      it(`${system} 1NT opener with ${points} accepts 2NT only with a public twenty-five HCP floor`, () => {
        const obs = observation([bid(1, 'NT'), PASS, bid(2, 'NT'), PASS], points);
        const inviteMinimum = system === 'precision' ? 10 : 8;
        expect(noTrumpRangeAt(obs.auction, 2, system)?.min).toBe(inviteMinimum);
        expect(system === 'precision' ? decidePrecisionBid(obs) : chooseBid(obs, system)).toEqual(points + inviteMinimum >= 25 ? bid(3, 'NT') : PASS);
      });
    }
  }
});

describe('v0.3 major-suit game boundaries', () => {
  for (let points = 12; points <= 22; points++) {
    it(`limit raise: ${points}-HCP opener accepts at 14+`, () => {
      // This constructor puts honors outside the five-card T9876 trump suit.
      // Even 22 HCP plus shortness is not a sound keycard entry on that suit.
      const expected = points >= 14 ? bid(4, 'S') : PASS;
      expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS], points, [5, 3, 3, 2]), 'two-over-one')).toEqual(expected);
    });
    it(`simple raise: ${points}-HCP opener signs off, invites, or bids game`, () => {
      const expected = points >= 18 ? bid(4, 'S') : points >= 15 ? bid(3, 'S') : PASS;
      expect(chooseBid(observation([bid(1, 'S'), PASS, bid(2, 'S'), PASS], points, [5, 3, 3, 2]), 'two-over-one')).toEqual(expected);
    });
  }
});

function exactAceHand(count: number): Card[] {
  const shape = [5, 3, 3, 2]; const suits: Suit[] = ['S', 'H', 'D', 'C'];
  return suits.flatMap((suit, index) => {
    const ranks = [...(index < count ? [14] : []), ...Array.from({ length: shape[index] - (index < count ? 1 : 0) }, (_, offset) => offset + 2)];
    return ranks.map(rank => ({ id: `${suit}${rank}`, suit, rank }));
  });
}

describe('v0.3 RKCB 1430 answer matrix', () => {
  const answers = [bid(5, 'D'), bid(5, 'C'), bid(5, 'H'), bid(5, 'D'), bid(5, 'C')];
  for (let aces = 0; aces <= 4; aces++) {
    it(`${aces} keycards without the trump queen use 1/4, 0/3, 2/5-no-Q`, () => {
      const obs = observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS], 0);
      obs.hand = exactAceHand(aces);
      expect(chooseBid(obs, 'two-over-one')).toEqual(answers[aces]);
    });
  }
});
