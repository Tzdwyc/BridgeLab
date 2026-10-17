import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { type BiddingSystem } from '../src/ai/systems';
import { newGame, applyCall, isFinished, assertGameIntegrity } from '../src/core/game';
import { type Card, type Call, type Suit, type Strain, PASS } from '../src/core/types';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { sameCall } from '../src/core/auction';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { robotStep, strategyFor } from '../src/controller/robot';
import { writeFileSync } from 'node:fs';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
function hand(shape: [number, number, number, number], target: number): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const ranks = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit)); const points = ranks.reduce((n, rank) => n + rank - 10, 0);
      const low = shape[index] - ranks.length;
      if (low < 0 || low > 9 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points); if (!rest) continue;
      return [...[...ranks, ...Array.from({ length: low }, (_, n) => 10 - n)].map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })), ...rest];
    }
    return null;
  };
  const cards = visit(0, target); if (!cards || cards.length !== 13) throw new Error('Unconstructable test hand');
  expect(evaluateHand(cards).hcp).toBe(target); return cards;
}
function observation(calls: Call[], shape: [number, number, number, number], hcp: number): BiddingObservation {
  let game = newGame(1, 'bidding-observation'); for (const call of calls) game = applyCall(game, game.turn, call);
  const obs = observe(game) as BiddingObservation; obs.hand = hand(shape, hcp); return obs;
}
const openings: { system: BiddingSystem; shape: [number, number, number, number]; hcp: number; expected: Call }[] = [
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 15, expected: bid(1, 'NT') },
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 17, expected: bid(1, 'NT') },
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 20, expected: bid(2, 'NT') },
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 21, expected: bid(2, 'NT') },
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 22, expected: bid(2, 'C') },
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 25, expected: bid(3, 'NT') },
  { system: 'sayc', shape: [4, 3, 3, 3], hcp: 27, expected: bid(3, 'NT') },
  { system: 'two-over-one', shape: [4, 3, 3, 3], hcp: 15, expected: bid(1, 'NT') },
  { system: 'two-over-one', shape: [4, 3, 3, 3], hcp: 17, expected: bid(1, 'NT') },
  { system: 'two-over-one', shape: [4, 3, 3, 3], hcp: 18, expected: bid(1, 'C') },
  { system: 'two-over-one', shape: [4, 3, 3, 3], hcp: 20, expected: bid(2, 'NT') },
  { system: 'two-over-one', shape: [4, 3, 3, 3], hcp: 21, expected: bid(2, 'NT') },
  { system: 'two-over-one', shape: [4, 3, 3, 3], hcp: 22, expected: bid(2, 'C') },
  { system: 'two-over-one', shape: [5, 4, 2, 2], hcp: 13, expected: bid(1, 'S') },
  { system: 'two-over-one', shape: [4, 5, 2, 2], hcp: 13, expected: bid(1, 'H') },
  { system: 'two-over-one', shape: [3, 2, 4, 4], hcp: 13, expected: bid(1, 'D') },
  { system: 'two-over-one', shape: [6, 3, 2, 2], hcp: 8, expected: bid(2, 'S') },
  { system: 'two-over-one', shape: [3, 3, 6, 1], hcp: 9, expected: bid(2, 'D') },
  { system: 'two-over-one', shape: [3, 2, 2, 6], hcp: 8, expected: PASS },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 13, expected: bid(1, 'NT') },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 15, expected: bid(1, 'NT') },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 16, expected: bid(1, 'C') },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 22, expected: bid(2, 'NT') },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 23, expected: bid(2, 'NT') },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 24, expected: bid(1, 'C') },
  { system: 'precision', shape: [5, 3, 3, 2], hcp: 14, expected: bid(1, 'S') },
  { system: 'precision', shape: [3, 5, 3, 2], hcp: 11, expected: bid(1, 'H') },
  { system: 'precision', shape: [3, 2, 2, 6], hcp: 12, expected: bid(2, 'C') },
  { system: 'precision', shape: [2, 4, 2, 5], hcp: 12, expected: bid(2, 'C') },
  { system: 'precision', shape: [4, 4, 1, 4], hcp: 12, expected: bid(2, 'D') },
  { system: 'precision', shape: [4, 4, 2, 3], hcp: 12, expected: bid(1, 'D') },
  { system: 'precision', shape: [6, 3, 2, 2], hcp: 8, expected: bid(2, 'S') },
  { system: 'precision', shape: [4, 3, 3, 3], hcp: 10, expected: PASS }
];
it.each(openings)('$system opens $hcp HCP shape $shape as $expected', ({ system, shape, hcp, expected }) => {
  expect(chooseBid(observation([], shape, hcp), system)).toEqual(expected);
});

describe('shared no-trump conventions and strength boundaries', () => {
  it.each(['two-over-one', 'precision'] as const)('%s: five-card transfers and forced acceptance', system => {
    expect(chooseBid(observation([bid(1, 'NT'), PASS], [2, 5, 3, 3], 0), system)).toEqual(bid(2, 'D'));
    expect(chooseBid(observation([bid(1, 'NT'), PASS], [5, 2, 3, 3], 7), system)).toEqual(bid(2, 'H'));
    expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(2, 'D'), PASS], [4, 2, 3, 4], 16), system)).toEqual(bid(2, 'H'));
    expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(2, 'H'), PASS], [2, 4, 3, 4], 16), system)).toEqual(bid(2, 'S'));
  });
  it.each(['two-over-one', 'precision'] as const)('%s: Stayman and all opener responses', system => {
    const points = system === 'precision' ? 10 : 8;
    expect(chooseBid(observation([bid(1, 'NT'), PASS], [4, 4, 3, 2], points), system)).toEqual(bid(2, 'C'));
    for (const [shape, strain] of [[[4, 4, 3, 2], 'H'], [[4, 2, 3, 4], 'S'], [[3, 3, 4, 3], 'D']] as const) {
      expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(2, 'C'), PASS], [...shape], 15), system)).toEqual(bid(2, strain));
    }
  });
  it.each([{ system: 'two-over-one' as const, invite: 8, game: 10, minimum: 15, maximum: 17 }, { system: 'precision' as const, invite: 10, game: 12, minimum: 13, maximum: 15 }])('$system separates invitations, games and acceptance', ({ system, invite, game, minimum, maximum }) => {
    const shape: [number, number, number, number] = [3, 3, 4, 3];
    expect(chooseBid(observation([bid(1, 'NT'), PASS], shape, invite), system)).toEqual(bid(2, 'NT'));
    expect(chooseBid(observation([bid(1, 'NT'), PASS], shape, game), system)).toEqual(bid(3, 'NT'));
    expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(2, 'NT'), PASS], shape, minimum), system)).toEqual(PASS);
    expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(2, 'NT'), PASS], shape, maximum), system)).toEqual(bid(3, 'NT'));
  });
  it('opener converts transfer-then-3NT to the known eight-card major fit', () => {
    const calls = [bid(1, 'NT'), PASS, bid(2, 'H'), PASS, bid(2, 'S'), PASS, bid(3, 'NT'), PASS];
    expect(chooseBid(observation(calls, [3, 4, 3, 3], 16))).toEqual(bid(4, 'S'));
    expect(chooseBid(observation(calls, [2, 4, 3, 4], 16))).toEqual(PASS);
  });
});

describe('2/1 game forces, passed hands and major support', () => {
  it('requires a new-suit 2/1 response with game-going strength and retains forcing after a low rebid', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS], [3, 3, 4, 3], 13))).toEqual(bid(2, 'D'));
    const opener = chooseBid(observation([bid(1, 'S'), PASS, bid(2, 'D'), PASS], [5, 3, 2, 3], 12));
    expect(opener.kind).toBe('bid'); expect(opener).not.toEqual(PASS);
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(2, 'D'), PASS, bid(2, 'S'), PASS], [3, 3, 4, 3], 13))).toEqual(bid(4, 'S'));
  });
  it('semi-forcing 1M–1NT permits a minimum balanced opener to stop without inventing a three-card second suit', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS], [2, 3, 4, 4], 9))).toEqual(bid(1, 'NT'));
    const minimumBalanced = observation([bid(1, 'S'), PASS, bid(1, 'NT'), PASS], [5, 3, 2, 3], 13);
    expect(analyzeAuctionSemantics(minimumBalanced.auction, minimumBalanced.seat, 'two-over-one').mustBid).toBe(false);
    expect(chooseBid(minimumBalanced)).toEqual(PASS);
    const passed = observation([PASS, PASS, bid(1, 'H'), PASS], [2, 3, 4, 4], 9);
    expect(describeCall(passed.auction, passed.seat, bid(1, 'NT'), 'two-over-one')).toContain('不逼叫');
  });
  it('Jacoby 2NT shows a four-card fit and opener shows shortness before responder closes game', () => {
    expect(chooseBid(observation([bid(1, 'H'), PASS], [2, 4, 4, 3], 13))).toEqual(bid(2, 'NT'));
    expect(chooseBid(observation([bid(1, 'H'), PASS, bid(2, 'NT'), PASS], [3, 5, 4, 1], 13))).toEqual(bid(3, 'C'));
    expect(chooseBid(observation([bid(1, 'H'), PASS, bid(2, 'NT'), PASS, bid(3, 'C'), PASS], [2, 4, 4, 3], 13))).toEqual(bid(4, 'H'));
  });
  it('a limit major raise is accepted with extras and declined by a minimum', () => {
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS], [5, 3, 3, 2], 14))).toEqual(bid(4, 'S'));
    expect(chooseBid(observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS], [5, 3, 3, 2], 12))).toEqual(PASS);
  });
  it('strong 2C waiting response and 2NT rebid use transfers with the correct 22–24 range', () => {
    expect(chooseBid(observation([bid(2, 'C'), PASS], [4, 3, 3, 3], 0))).toEqual(bid(2, 'D'));
    expect(chooseBid(observation([bid(2, 'C'), PASS, bid(2, 'D'), PASS], [4, 3, 3, 3], 22))).toEqual(bid(2, 'NT'));
    const prefix = [bid(2, 'C'), PASS, bid(2, 'D'), PASS, bid(2, 'NT'), PASS];
    expect(chooseBid(observation(prefix, [5, 3, 3, 2], 3))).toEqual(bid(3, 'H'));
    expect(chooseBid(observation([...prefix, bid(3, 'H'), PASS], [3, 4, 3, 3], 22))).toEqual(bid(3, 'S'));
    expect(chooseBid(observation([...prefix, bid(3, 'H'), PASS, bid(3, 'S'), PASS], [5, 3, 3, 2], 3))).toEqual(bid(3, 'NT'));
  });
});

describe('precision strong club and shape inquiries', () => {
  it.each([0, 4, 7])('strong 1C gets a negative 1D with %i HCP', hcp => {
    expect(chooseBid(observation([bid(1, 'C'), PASS], [3, 3, 4, 3], hcp), 'precision')).toEqual(bid(1, 'D'));
  });
  it('eight or more points show a positive five-card suit or balanced positive and establish game forcing', () => {
    expect(chooseBid(observation([bid(1, 'C'), PASS], [5, 3, 3, 2], 8), 'precision')).toEqual(bid(1, 'S'));
    expect(chooseBid(observation([bid(1, 'C'), PASS], [3, 3, 4, 3], 8), 'precision')).toEqual(bid(1, 'NT'));
    expect(chooseBid(observation([bid(1, 'C'), PASS, bid(1, 'NT'), PASS], [3, 3, 4, 3], 16), 'precision')).toEqual(bid(3, 'NT'));
  });
  it.each([{ hcp: 16, expected: 1 }, { hcp: 18, expected: 1 }, { hcp: 19, expected: 2 }, { hcp: 21, expected: 2 }, { hcp: 24, expected: 3 }])('negative sequence rebid has a public $hcp-HCP range', ({ hcp, expected }) => {
    expect(chooseBid(observation([bid(1, 'C'), PASS, bid(1, 'D'), PASS], [4, 3, 3, 3], hcp), 'precision')).toEqual(bid(expected, 'NT'));
  });
  it('club query finds the four-card major rather than interpreting artificial 2D as a natural diamond suit', () => {
    expect(chooseBid(observation([bid(2, 'C'), PASS], [4, 3, 3, 3], 11), 'precision')).toEqual(bid(2, 'D'));
    expect(chooseBid(observation([bid(2, 'C'), PASS, bid(2, 'D'), PASS], [2, 4, 2, 5], 12), 'precision')).toEqual(bid(2, 'H'));
  });
  it.each([{ shape: [4, 4, 1, 4] as [number, number, number, number], strain: 'C' as const }, { shape: [4, 4, 0, 5] as [number, number, number, number], strain: 'D' as const }, { shape: [4, 3, 1, 5] as [number, number, number, number], strain: 'H' as const }, { shape: [3, 4, 1, 5] as [number, number, number, number], strain: 'S' as const }])('short-diamond 2NT inquiry shows shape $shape', ({ shape, strain }) => {
    expect(chooseBid(observation([bid(2, 'D'), PASS, bid(2, 'NT'), PASS], shape, 12), 'precision')).toEqual(bid(3, strain));
  });
  it('short-diamond shape answers identify the four-card major for a game raise', () => {
    expect(chooseBid(observation([bid(2, 'D'), PASS, bid(2, 'NT'), PASS, bid(3, 'H'), PASS], [4, 3, 3, 3], 14), 'precision')).toEqual(bid(4, 'S'));
    expect(chooseBid(observation([bid(2, 'D'), PASS, bid(2, 'NT'), PASS, bid(3, 'S'), PASS], [3, 4, 3, 3], 14), 'precision')).toEqual(bid(4, 'H'));
  });
});

describe('competition and basic ace asking', () => {
  it('takeout double promises shape and its partner must respond even with a weak hand', () => {
    expect(chooseBid(observation([bid(1, 'D')], [4, 4, 1, 4], 13))).toEqual({ kind: 'double' });
    expect(chooseBid(observation([bid(1, 'D'), { kind: 'double' }, PASS], [3, 5, 2, 3], 0))).toEqual(bid(1, 'H'));
  });
  it('negative double shows the other four-card major and opener responds to that information', () => {
    expect(chooseBid(observation([bid(1, 'D'), bid(1, 'S')], [3, 4, 3, 3], 7))).toEqual({ kind: 'double' });
    expect(chooseBid(observation([bid(1, 'D'), bid(1, 'S'), { kind: 'double' }, PASS], [2, 4, 5, 2], 12))).toEqual(bid(2, 'H'));
  });
  it('a public major fit makes 4NT RKCB 1430 and three keycards respond 5D', () => {
    const obs = observation([bid(1, 'S'), PASS, bid(3, 'S'), PASS, bid(4, 'NT'), PASS], [5, 3, 2, 3], 14);
    const parts = ['AQ532', 'A73', 'A2', 'T96']; const suits: Suit[] = ['S', 'H', 'D', 'C'];
    obs.hand = parts.flatMap((ranks, index) => ranks.split('').map(rank => ({ suit: suits[index], rank: '23456789TJQKA'.indexOf(rank) + 2, id: suits[index] + String('23456789TJQKA'.indexOf(rank) + 2) })));
    expect(chooseBid(obs)).toEqual(bid(5, 'D'));
  });
  it('4NT in no trump is quantitative rather than an ace answer', () => {
    expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(4, 'NT'), PASS], [4, 3, 3, 3], 16))).toEqual(PASS);
    expect(chooseBid(observation([bid(1, 'NT'), PASS, bid(4, 'NT'), PASS], [4, 3, 3, 3], 17))).toEqual(bid(6, 'NT'));
  });
});

it('500 seeded complete boards per active system remain legal, finite, private and correctly owned', async () => {
  const rows = [];
  for (const system of ['sayc', 'two-over-one', 'precision'] as const) {
    let complete = 0; let passedOut = 0; let fallback = 0; let maxActions = 0;
    for (let board = 1; board <= 500; board++) {
      let game = newGame(board, `v03-${system}-${board}`);
      for (let guard = 0; guard < 400 && !isFinished(game); guard++) {
        const obs = observe(game);
        if (obs.phase === 'auction') expect(obs.legalCalls.some(call => sameCall(call, chooseBid(obs, system)))).toBe(true);
        const next = robotStep(game, strategyFor(system)); if (next.warning) fallback++;
        game = next.game; assertGameIntegrity(game);
      }
      expect(isFinished(game), `${system}/${board}`).toBe(true);
      if (game.phase === 'complete') complete++; else passedOut++;
      maxActions = Math.max(maxActions, game.actions.length);
      if (board % 25 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    expect(fallback).toBe(0); rows.push({ system, boards: 500, complete, passedOut, fallback, maxActions });
  }
  writeFileSync('artifacts/bidding-system-stability.json', JSON.stringify({ executedAt: new Date().toISOString(), cases: rows }, null, 2));
// Full auction plus 13 tricks across three systems can exceed 90s during parallel release checks.
}, 300000);
