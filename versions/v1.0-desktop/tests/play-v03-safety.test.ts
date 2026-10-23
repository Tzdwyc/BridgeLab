import { describe, expect, it } from 'vitest';
import { chooseCard } from '../src/ai/playing';
import { type PlayObservation } from '../src/ai/observation';
import { type AuctionEntry, type Card, type PlayedCard, type Seat, type Strain, type Suit, type Trick } from '../src/core/types';

const card = (suit: Suit, rank: number): Card => ({ id: `${suit}${rank}`, suit, rank });
const play = (seat: Seat, suit: Suit, rank: number): PlayedCard => ({ seat, card: card(suit, rank) });
const trick = (plays: PlayedCard[], winner = plays[0].seat): Trick => ({ leader: plays[0].seat, plays, winner });

function observation(options: {
  actingSeat?: Seat;
  hand: Card[];
  legal?: Card[];
  current?: PlayedCard[];
  completed?: Trick[];
  strain?: Strain;
  declarer?: Seat;
  dummy?: { seat: Seat; cards: Card[] } | null;
  auction?: AuctionEntry[];
  controller?: Seat;
}): PlayObservation {
  const actingSeat = options.actingSeat ?? 'E';
  return {
    phase: 'play', board: 1, seat: options.controller ?? actingSeat, actingSeat,
    vulnerability: 'None', auction: options.auction ?? [], hand: options.hand,
    actingHand: options.hand, legalCards: options.legal ?? options.hand,
    contract: { level: 3, strain: options.strain ?? 'NT', doubled: 0, declarer: options.declarer ?? 'N', dummy: 'S', leader: 'E' },
    dummy: options.dummy ?? null, currentTrick: options.current ?? [], completedTricks: options.completed ?? [],
    handSizes: { N: 5, E: options.hand.length, S: 5, W: 5 }, tricksWon: { NS: 0, EW: 0 }
  };
}

describe('v0.3 deterministic play safety layer', () => {
  it('has one legal exit and follows suit even when an off-suit ace is present', () => {
    const h2 = card('H', 2);
    const obs = observation({ hand: [h2, card('S', 14)], legal: [h2], current: [play('N', 'H', 5)] });
    expect(chooseCard(obs)).toBe('H2');
  });

  it('plays second hand low from Jx after a small lead', () => {
    const hand = [card('H', 2), card('H', 11)];
    expect(chooseCard(observation({ hand, current: [play('N', 'H', 5)] }))).toBe('H2');
  });

  it('plays second hand low from Qx when trumps are led small', () => {
    const hand = [card('H', 3), card('H', 12)];
    expect(chooseCard(observation({ hand, current: [play('N', 'H', 4)], strain: 'H' }))).toBe('H3');
  });

  it('covers an honor lead with the cheapest sufficient honor', () => {
    const hand = [card('H', 2), card('H', 12), card('H', 13)];
    expect(chooseCard(observation({ hand, current: [play('N', 'H', 11)] }))).toBe('H12');
  });

  it('uses the minimum third-hand card that is guaranteed against a hidden fourth hand', () => {
    const hand = [7, 11, 13, 14].map(rank => card('H', rank));
    const current = [play('W', 'H', 4), play('N', 'H', 2)];
    expect(chooseCard(observation({ hand, current }))).toBe('H13');
  });

  it('keeps third-hand honors when partner has the unbeatable ace', () => {
    const hand = [7, 11, 12, 13].map(rank => card('H', rank));
    const current = [play('W', 'H', 14), play('N', 'H', 2)];
    expect(chooseCard(observation({ hand, current }))).toBe('H7');
  });

  it('uses a known dummy to choose the cheapest guaranteed third-hand cover', () => {
    const hand = [7, 11, 13, 14].map(rank => card('H', rank));
    const current = [play('W', 'H', 4), play('N', 'H', 2)];
    const dummy = { seat: 'S' as const, cards: [card('H', 8), card('C', 3)] };
    expect(chooseCard(observation({ hand, current, dummy }))).toBe('H11');
  });

  it('does not waste a trump when fourth hand has publicly shown out in both the led suit and trumps', () => {
    const hand = [card('S', 2), card('S', 9), card('C', 3)];
    const completed = [
      trick([play('N', 'H', 3), play('E', 'H', 5), play('S', 'C', 2), play('W', 'H', 4)], 'E'),
      trick([play('N', 'S', 3), play('E', 'S', 4), play('S', 'D', 2), play('W', 'S', 5)], 'W')
    ];
    const current = [play('W', 'H', 10), play('N', 'H', 2)];
    expect(chooseCard(observation({ hand, current, completed, strain: 'S' }))).toBe('C3');
  });

  it('plays fourth hand low when partner is already certain to win', () => {
    const hand = [card('H', 3), card('H', 13)];
    const current = [play('W', 'H', 10), play('N', 'H', 14), play('E', 'H', 7)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, controller: 'S' }))).toBe('H3');
  });

  it('takes an opposing fourth-hand winner with the cheapest sufficient card', () => {
    const hand = [card('H', 3), card('H', 11), card('H', 13)];
    const current = [play('W', 'H', 10), play('N', 'H', 2), play('E', 'H', 7)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, controller: 'S' }))).toBe('H11');
  });

  it('ruffs in fourth hand with the lowest winning trump', () => {
    const hand = [card('S', 2), card('S', 9), card('C', 3)];
    const current = [play('W', 'H', 10), play('N', 'H', 2), play('E', 'C', 4)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, strain: 'S', controller: 'S' }))).toBe('S2');
  });

  it('overruffs in fourth hand with the lowest sufficient trump', () => {
    const hand = [card('S', 2), card('S', 6), card('S', 9), card('C', 3)];
    const current = [play('W', 'H', 10), play('N', 'H', 2), play('E', 'S', 5)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, strain: 'S', controller: 'S' }))).toBe('S6');
  });

  it('discards a loser instead of an explicit winner', () => {
    const hand = [card('C', 14), card('D', 3)];
    const current = [play('W', 'H', 14), play('N', 'H', 2), play('E', 'H', 3)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, controller: 'S' }))).toBe('D3');
  });

  it('keeps the guard card of a sole Kx stopper when another discard exists', () => {
    const hand = [card('C', 13), card('C', 2), card('D', 3)];
    const current = [play('W', 'H', 14), play('N', 'H', 2), play('E', 'H', 3)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, controller: 'S' }))).toBe('D3');
  });

  it('keeps a promoted winner that is the only clear entry', () => {
    const hand = [card('C', 10), card('D', 11)];
    const completed = [trick([
      play('N', 'C', 14), play('E', 'C', 13), play('S', 'C', 12), play('W', 'C', 11)
    ], 'N')];
    const current = [play('W', 'H', 14), play('N', 'H', 2), play('E', 'H', 3)];
    expect(chooseCard(observation({ actingSeat: 'S', hand, current, completed, controller: 'S' }))).toBe('D11');
  });

  it('returns partner actual opening-lead suit before choosing its own long suit', () => {
    const hand = [card('C', 2), card('D', 2), card('D', 3), card('D', 4)];
    const completed = [trick([
      play('W', 'C', 10), play('N', 'C', 14), play('E', 'C', 3), play('S', 'C', 4)
    ], 'N')];
    expect(chooseCard(observation({ hand, completed }))).toBe('C2');
  });

  it('does not treat an ambiguous Precision strong 1C opening as a natural lead request', () => {
    const hand = [card('C', 2), card('C', 3), card('S', 2), card('S', 3), card('S', 4)];
    const auction: AuctionEntry[] = [{ seat: 'W', call: { kind: 'bid', level: 1, strain: 'C' } }];
    expect(chooseCard(observation({ hand, auction }), 'precision')).toBe('S2');
  });

  it('does not treat a Precision 1D negative response to 1C as a natural lead request', () => {
    const hand = [card('D', 2), card('D', 3), card('S', 2), card('S', 3), card('S', 4)];
    const auction: AuctionEntry[] = [
      { seat: 'E', call: { kind: 'bid', level: 1, strain: 'C' } },
      { seat: 'S', call: { kind: 'pass' } },
      { seat: 'W', call: { kind: 'bid', level: 1, strain: 'D' } }
    ];
    expect(chooseCard(observation({ hand, auction }), 'precision')).toBe('S2');
  });

  it('still treats a 2/1 opening 1C as a natural lead request', () => {
    const hand = [card('C', 2), card('C', 3), card('S', 2), card('S', 3), card('S', 4)];
    const auction: AuctionEntry[] = [{ seat: 'W', call: { kind: 'bid', level: 1, strain: 'C' } }];
    expect(chooseCard(observation({ hand, auction }), 'two-over-one')).toBe('C2');
  });

  it('still honors an unambiguously natural partner suit', () => {
    const hand = [card('H', 2), card('H', 3), card('S', 2), card('S', 3), card('S', 4)];
    const auction: AuctionEntry[] = [{ seat: 'W', call: { kind: 'bid', level: 1, strain: 'H' } }];
    expect(chooseCard(observation({ hand, auction }))).toBe('H2');
  });

  it('does not blindly draw trumps merely because the contract is young', () => {
    const hand = [card('S', 2), card('S', 3), card('H', 2), card('H', 3), card('H', 4)];
    expect(chooseCard(observation({ actingSeat: 'N', hand, strain: 'S', declarer: 'N', controller: 'N' }))).toBe('H2');
  });

  it('leads the top of a touching honor sequence', () => {
    const hand = [card('S', 13), card('S', 12), card('S', 4), card('H', 2)];
    expect(chooseCard(observation({ hand }))).toBe('S13');
  });
});
