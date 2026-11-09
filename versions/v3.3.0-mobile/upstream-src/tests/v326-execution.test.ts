import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { usesApprovedContinuationFlow } from '../src/ai/approved-bidding-flow';
import { assessCandidates } from '../src/ai/constrained-sl';
import { legalCalls, sameCall } from '../src/core/auction';
import type { BiddingObservation } from '../src/ai/observation';
import type { AuctionEntry, Call, Card, Seat, Strain, Suit } from '../src/core/types';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
const call = (text: string): Call => text === 'P' ? { kind: 'pass' } : text === 'X' ? { kind: 'double' }
  : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
function observation(prefix: string, holding: string): BiddingObservation {
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map((text, i) => ({ seat: seats[i % 4], call: call(text) }));
  const seat = seats[auction.length % 4];
  const hand: Card[] = holding.split('.').flatMap((cards, i) => [...cards.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat, hand, auction, legalCalls: legalCalls(auction, seat) };
}

describe.each(['sayc', 'two-over-one'] as const)('v3.2.6 approved execution in %s', system => {
  it.each([
    ['1C P 1H P 2C P 2D P', 'T54.Q.KQ7.AKJ954', '3C'],
    ['1H 2H X', '986.J8.6.KJT9763', '2S'],
    ['1H 2H X 2NT P', 'KJ874.92.AQT86.4', '3D'],
    ['1H 2S P 2NT P', 'KJ7432.6.A9.K852', '3C'],
    ['1H 2S P 2NT P 3C P', 'AQ6.J97.KQ5.QJ74', '4S'],
  ])('answers %s using its existing qualified rule', (prefix, holding, expected) => {
    const obs = observation(prefix, holding);
    expect(usesApprovedContinuationFlow(obs, system)).toBe(true);
    const actual = chooseBid(obs, system);
    expect(actual).toEqual(call(expected));
    expect(assessCandidates(obs, system).find(candidate => sameCall(candidate.call, actual))).toMatchObject({ allowed: true });
  });
  it.each([
    ['1H 2S P 2NT P', 'QJ7432.6.98.K852', '3S'],
    ['1H 2S P 2NT P', 'AQJ743.6.98.J852', '3S'],
    ['1H 2S P 2NT P', 'AJ7432.6.98.K852', '3S'],
    ['1H 2S P 2NT P', 'AQ7432.6.98.K852', '3C'],
    ['1H 2S P 2NT P 3S P', 'AQ6.J97.KQ5.QJ74', 'P'],
    ['1H 2S P 2NT P 3C P', 'Q65.J97.Q85.J974', '3S'],
  ])('preserves minimum/no-feature/low-asker outcome at %s', (prefix, holding, expected) => {
    const obs = observation(prefix, holding), actual = chooseBid(obs, system);
    expect(actual).toEqual(call(expected));
    expect(assessCandidates(obs, system).find(candidate => sameCall(candidate.call, actual))).toMatchObject({ allowed: true });
  });
  it('keeps the existing weak-two feature minimum separate from a weak jump overcall', () => {
    const obs = observation('2S P 2NT P', 'AJ7432.6.98.K852');
    const actual = chooseBid(obs, system);
    expect(actual).toEqual(call(system === 'sayc' ? '3S' : '3C'));
    expect(assessCandidates(obs, system).find(candidate => sameCall(candidate.call, actual))).toMatchObject({ allowed: true });
  });
  it('uses the same inquiry selection before asking, without forcing low hands to ask', () => {
    const strong = observation('1H 2S P', 'AQ6.J97.KQ5.QJ74');
    expect(usesApprovedContinuationFlow(strong, system)).toBe(true);
    expect(chooseBid(strong, system)).toEqual(call('2NT'));
    expect(chooseBid(observation('1H 2S P', 'Q65.J97.Q85.J974'), system)).not.toEqual(call('2NT'));
  });
  it.each(['1C 2D X 2NT P', '1C 2D 2H 2NT P', '1C 2D P 2NT 3C'])('does not adopt an unsupported feature protocol at %s', prefix => {
    expect(usesApprovedContinuationFlow(observation(prefix, 'KJ7432.6.A9.K852'), system)).toBe(false);
  });
  it('closes the Michaels contract-choice entry after the choice or fresh natural interference', () => {
    expect(usesApprovedContinuationFlow(observation('1H 2H P 2NT P 3C P', '986.J8.6.KJT9763'), system)).toBe(true);
    expect(usesApprovedContinuationFlow(observation('1H 2H P 2NT P 3C 3H', '986.J8.6.KJT9763'), system)).toBe(false);
    expect(usesApprovedContinuationFlow(observation('1H 2H P 2NT P 3C P 3S P P P', '986.J8.6.KJT9763'), system)).toBe(false);
  });
});
