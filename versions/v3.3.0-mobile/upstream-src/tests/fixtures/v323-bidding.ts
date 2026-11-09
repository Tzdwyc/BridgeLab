import { deck } from '../../src/core/deal';
import { applyCall, assertGameIntegrity, newGameFromDeal } from '../../src/core/game';
import { SEATS, type Call, type Card, type Hands, type Seat, type Strain } from '../../src/core/types';
import { agreementVersionFor } from '../../src/ai/bid-strategy';
import type { BiddingSystem } from '../../src/ai/systems';

export const parseCall = (text: string): Call => text === 'P' ? { kind: 'pass' }
  : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
export function holding(text: string): Card[] {
  return text.split('.').flatMap((ranks, index) => [...ranks].filter(rank => rank !== '-').map(rank => {
    const suit = (['S', 'H', 'D', 'C'] as const)[index], value = '23456789TJQKA'.indexOf(rank) + 2;
    return { id: `${suit}${value}`, suit, rank: value };
  }));
}
function table(hands: Partial<Record<Seat, string>>, rotation = 0): Hands {
  const result = Object.fromEntries(SEATS.map(seat => [seat, []])) as unknown as Hands;
  const rotate = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + rotation) % 4];
  for (const seat of SEATS) if (hands[seat]) result[rotate(seat)] = holding(hands[seat]!);
  const used = SEATS.flatMap(seat => result[seat].map(card => card.id));
  if (new Set(used).size !== used.length) throw Error('Duplicate fixture card');
  const rest = deck().filter(card => !used.includes(card.id));
  for (const seat of SEATS) if (!result[seat].length) result[seat] = rest.splice(0, 13);
  return result;
}
export interface BiddingFixture {
  id: string; system: BiddingSystem; prefix: string; hands: Partial<Record<Seat, string>>;
  expected: string; rotation?: number;
}
const opener = 'AKQ.AK.AQJ764.32';
const weak = '8765.876.98.7654';
const positive = 'J65.Q87.985.A764';
const hearts = 'J65.QJ987.98.A76';
export const biddingFixtures: BiddingFixture[] = (['sayc', 'two-over-one'] as const).flatMap(system => [
  { id: `${system}-second-negative`, system, prefix: '2C P 2D P 3D P', hands: { N: opener, S: weak }, expected: '3H', rotation: 2 },
  { id: `${system}-natural-positive`, system, prefix: '2C P 2D P 3D P', hands: { N: opener, S: positive }, expected: '3NT', rotation: 2 },
  { id: `${system}-heart-positive`, system, prefix: '2C P 2D P 3D P', hands: { N: opener, S: hearts }, expected: '4H', rotation: 2 },
  { id: `${system}-negative-rebid`, system, prefix: '2C P 2D P 3D P 3H P', hands: { N: opener, S: weak }, expected: '4D' },
  { id: `${system}-negative-stop`, system, prefix: '2C P 2D P 3D P 3H P 4D P', hands: { N: opener, S: weak }, expected: 'P', rotation: 2 },
  { id: `${system}-positive-stop`, system, prefix: '2C P 2D P 3D P 3NT P', hands: { N: opener, S: positive }, expected: 'P' },
  { id: `${system}-heart-positive-stop`, system, prefix: '2C P 2D P 3D P 4H P', hands: { N: opener, S: hearts }, expected: 'P' },
]);
biddingFixtures.push(
  { id: '6888-feature-answer', system: 'sayc', prefix: '1H 2S P 2NT P',
    hands: { N: 'T98.AKQT8.JT3.A9', E: 'KJ7432.6.A9.K852', W: 'AQ6.J97.KQ5.QJ74' }, expected: '3C' },
  { id: '6888-game', system: 'sayc', prefix: '1H 2S P 2NT P 3C P',
    hands: { N: 'T98.AKQT8.JT3.A9', E: 'KJ7432.6.A9.K852', W: 'AQ6.J97.KQ5.QJ74' }, expected: '4S' },
  { id: 'competitive-keycard-answer', system: 'sayc', prefix: '1S 2H 3H 3S 4H 4NT P',
    hands: { E: 'A.AKQJ9.AK4.8765', W: 'K65.T87.985.AKQ4' }, expected: '5C' },
  { id: 'competitive-keycard-weak-preempt-control', system: 'sayc', prefix: '2S 3H P 4H P 4NT P',
    hands: { N: 'QJT984.654.QJ3.J', E: 'A.AKQJ9.AK4.8765', W: 'K65.T87.985.AKQ4' }, expected: '5C' },
);
export function fixtureGame(row: BiddingFixture) {
  const rotation = row.rotation ?? 0;
  let game = newGameFromDeal(1, `BridgeLab-v323-fixed/${row.id}`, table(row.hands, rotation), SEATS[rotation], 'None');
  game = { ...game, biddingSystem: row.system, agreementVersion: agreementVersionFor(row.system) };
  for (const token of row.prefix.split(' ')) game = applyCall(game, game.turn, parseCall(token));
  assertGameIntegrity(game);
  return game;
}
