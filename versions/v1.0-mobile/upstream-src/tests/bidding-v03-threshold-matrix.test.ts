import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { type BiddingSystem } from '../src/ai/systems';
import { applyCall, newGame } from '../src/core/game';
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
    // Precision's 1D negative remains 0-7 HCP. Rows 0-7 are reachable;
    // Rows9+ are synthetic NT arithmetic checks: observation() replaces the
    // hand after constructing an incompatible self-negative prefix. They do
    // not validate a real auction or promise a wrong-call recovery protocol.
    // Row8 is separated below as a contradictory-prefix guard, because the
    // natural invitation intersects the earlier negative range at exactly7.
    // Keep quantitative 4NT/5NT thresholds and do not relax the 1D card or
    // claim these synthetic rows as realistic auction-quality coverage.
    name: 'Precision strong club 16-18 1NT rebid', system: 'precision', calls: [bid(1, 'C'), PASS, bid(1, 'D'), PASS, bid(1, 'NT'), PASS], from: 0, to: 24,
    expected: hcp => hcp >= 21 ? bid(7, 'NT') : hcp >= 19 ? bid(5, 'NT') : hcp >= 17 ? bid(6, 'NT') : hcp >= 15 ? bid(4, 'NT') : hcp >= 9 ? bid(3, 'NT') : hcp >= 7 ? bid(2, 'NT') : PASS
  },
  {
    name: 'natural 18-19 jump 2NT rebid', system: 'two-over-one', calls: [bid(1, 'D'), PASS, bid(1, 'S'), PASS, bid(2, 'NT'), PASS], from: 0, to: 22,
    expected: hcp => hcp >= 19 ? bid(7, 'NT') : hcp >= 18 ? bid(5, 'NT') : hcp >= 15 ? bid(6, 'NT') : hcp >= 14 ? bid(4, 'NT') : hcp >= 7 ? bid(3, 'NT') : PASS
  }
];

describe('v0.3 continuous no-trump game and slam threshold matrix', () => {
  for (const matrix of matrices) {
    for (let points = matrix.from; points <= matrix.to; points++) {
      if (matrix.system === 'precision' && matrix.name.startsWith('Precision strong club') && points === 8) continue;
      const synthetic = matrix.system === 'precision' && matrix.name.startsWith('Precision strong club') && points > 7;
      it(`${matrix.name}: ${points} HCP${synthetic ? ' (synthetic arithmetic; incompatible negative prefix)' : ''}`, () => {
        const obs = observation(matrix.calls, points), expected = matrix.expected(points);
        expect(chooseBid(obs, matrix.system)).toEqual(expected);
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
  });
});

describe('v0.3 invitation acceptance boundaries', () => {
  for (const [system, minimum, maximum] of [['two-over-one', 15, 17], ['precision', 13, 15]] as const) {
    for (let points = minimum; points <= maximum; points++) {
      it(`${system} 1NT opener with ${points} accepts 2NT only with a public twenty-five HCP floor`, () => {
        const obs = observation([bid(1, 'NT'), PASS, bid(2, 'NT'), PASS], points);
        const inviteMinimum = system === 'precision' ? 10 : 8;
        expect(noTrumpRangeAt(obs.auction, 2, system)?.min).toBe(inviteMinimum);
        expect(chooseBid(obs, system)).toEqual(points + inviteMinimum >= 25 ? bid(3, 'NT') : PASS);
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
