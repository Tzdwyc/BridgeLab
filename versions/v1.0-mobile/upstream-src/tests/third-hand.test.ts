import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseCard } from '../src/ai/playing';
import { observe, type PlayObservation } from '../src/ai/observation';
import { userBoardStates } from './fixtures/user-board-9';
import { playCard } from '../src/core/game';
import { analysisPosition } from '../src/analysis/adapter';
import { DdsEngine } from '../src/analysis/engine';
import { type Card, type Seat, type Strain, type Suit, SEATS, SUITS, STRAINS } from '../src/core/types';
import { ENGINE } from '../src/analysis/types';

function transform(observation: PlayObservation, rotation: number, led: Suit, trump: Strain): PlayObservation {
  const seat = (value: Seat): Seat => SEATS[(SEATS.indexOf(value) + rotation) % 4];
  const delta = (SUITS.indexOf(led) - SUITS.indexOf('H') + 4) % 4;
  const card = (value: Card): Card => { const suit = SUITS[(SUITS.indexOf(value.suit) + delta) % 4]; return { ...value, suit, id: `${suit}${value.rank}` }; };
  const play = (p: { seat: Seat; card: Card }) => ({ seat: seat(p.seat), card: card(p.card) });
  return { ...observation, seat: seat(observation.seat), actingSeat: seat(observation.actingSeat),
    contract: { ...observation.contract, strain: trump, declarer: seat(observation.contract.declarer), dummy: seat(observation.contract.dummy), leader: seat(observation.contract.leader) },
    hand: observation.hand.map(card), actingHand: observation.actingHand.map(card), legalCards: observation.legalCards.map(card),
    dummy: observation.dummy ? { seat: seat(observation.dummy.seat), cards: observation.dummy.cards.map(card) } : null,
    currentTrick: observation.currentTrick.map(play), completedTricks: observation.completedTricks.map(t => ({ leader: seat(t.leader), winner: seat(t.winner), plays: t.plays.map(play) })),
    handSizes: Object.fromEntries(SEATS.map(s => [seat(s), observation.handSizes[s]])) as Record<Seat, number>, auction: [] };
}
const matrix = SEATS.flatMap((_, rotation) => SUITS.flatMap(led => STRAINS.map(trump => ({ rotation, led, trump }))));
it.each(matrix)('general third-hand protection: rotation $rotation, led $led, trump $trump', ({ rotation, led, trump }) => {
  const observation = transform(observe(userBoardStates()[38]) as PlayObservation, rotation, led, trump);
  expect(chooseCard(observation)).toBe(`${led}13`);
});
it.each(matrix)('fourth-hand economy remains correct: rotation $rotation, led $led, trump $trump', ({ rotation, led, trump }) => {
  const observation = transform(observe(userBoardStates()[47]) as PlayObservation, rotation, led, trump);
  expect(chooseCard(observation)).toBe(`${led}9`);
});
it('third hand preserves honors when partner has the publicly unbeatable ace', () => {
  const observation = observe(userBoardStates()[38]) as PlayObservation;
  const hand = [13, 12, 11, 7].map(rank => ({ id: `H${rank}`, suit: 'H' as const, rank }));
  observation.hand = hand; observation.actingHand = hand; observation.legalCards = hand;
  observation.currentTrick[0].card = { id: 'H14', suit: 'H', rank: 14 };
  expect(chooseCard(observation)).toBe('H7');
});
it('a known fourth-hand dummy permits the cheapest guaranteed cover rather than blindly playing high', () => {
  const observation = observe(userBoardStates()[38]) as PlayObservation;
  observation.contract = { ...observation.contract, declarer: 'N', dummy: 'S' };
  observation.dummy = { seat: 'S', cards: userBoardStates()[38].hands.S };
  expect(chooseCard(observation)).toBe('H11');
});

it('third hand uses the lowest trump that cannot be overruffed by a known dummy', () => {
  const observation = structuredClone(observe(userBoardStates()[38]) as PlayObservation);
  observation.contract = { ...observation.contract, strain: 'S', declarer: 'N', dummy: 'S' };
  observation.currentTrick = [{ seat: 'W', card: { id: 'H10', suit: 'H', rank: 10 } }, { seat: 'N', card: { id: 'H2', suit: 'H', rank: 2 } }];
  const hand = [9, 13].map(rank => ({ id: `S${rank}`, suit: 'S' as const, rank }));
  observation.hand = hand; observation.actingHand = hand; observation.legalCards = hand;
  observation.dummy = { seat: 'S', cards: [{ id: 'S10', suit: 'S', rank: 10 }, { id: 'C3', suit: 'C', rank: 3 }] };
  observation.completedTricks = [];
  expect(chooseCard(observation)).toBe('S13');
});

it('a publicly shown fourth-hand void avoids wasting an honor that cannot stop a ruff', () => {
  const observation = structuredClone(observe(userBoardStates()[38]) as PlayObservation);
  observation.contract = { ...observation.contract, strain: 'S' };
  observation.currentTrick = [{ seat: 'W', card: { id: 'H10', suit: 'H', rank: 10 } }, { seat: 'N', card: { id: 'H2', suit: 'H', rank: 2 } }];
  const hand = [7, 13].map(rank => ({ id: `H${rank}`, suit: 'H' as const, rank }));
  observation.hand = hand; observation.actingHand = hand; observation.legalCards = hand;
  observation.completedTricks = [{ leader: 'N', winner: 'E', plays: [
    { seat: 'N', card: { id: 'H3', suit: 'H', rank: 3 } }, { seat: 'E', card: { id: 'H5', suit: 'H', rank: 5 } },
    { seat: 'S', card: { id: 'C2', suit: 'C', rank: 2 } }, { seat: 'W', card: { id: 'H4', suit: 'H', rank: 4 } }
  ] }];
  expect(chooseCard(observation)).toBe('H7');
});

it('fourth hand takes an opposing winner with the cheapest sufficient honor', () => {
  const observation = structuredClone(observe(userBoardStates()[38]) as PlayObservation);
  observation.contract = { ...observation.contract, strain: 'NT' };
  observation.seat = 'S'; observation.actingSeat = 'S'; observation.dummy = null;
  observation.currentTrick = [
    { seat: 'W', card: { id: 'H10', suit: 'H', rank: 10 } }, { seat: 'N', card: { id: 'H2', suit: 'H', rank: 2 } },
    { seat: 'E', card: { id: 'H7', suit: 'H', rank: 7 } }
  ];
  const hand = [3, 11, 13].map(rank => ({ id: `H${rank}`, suit: 'H' as const, rank }));
  observation.hand = hand; observation.actingHand = hand; observation.legalCards = hand; observation.completedTricks = [];
  expect(chooseCard(observation)).toBe('H11');
});

it('fourth hand ruffs with the lowest sufficient trump when void in the led suit', () => {
  const observation = structuredClone(observe(userBoardStates()[38]) as PlayObservation);
  observation.contract = { ...observation.contract, strain: 'S' };
  observation.seat = 'S'; observation.actingSeat = 'S'; observation.dummy = null;
  observation.currentTrick = [
    { seat: 'W', card: { id: 'H10', suit: 'H', rank: 10 } }, { seat: 'N', card: { id: 'H2', suit: 'H', rank: 2 } },
    { seat: 'E', card: { id: 'C4', suit: 'C', rank: 4 } }
  ];
  const hand = [{ id: 'S2', suit: 'S' as const, rank: 2 }, { id: 'S9', suit: 'S' as const, rank: 9 }, { id: 'C3', suit: 'C' as const, rank: 3 }];
  observation.hand = hand; observation.actingHand = hand; observation.legalCards = hand; observation.completedTricks = [];
  expect(chooseCard(observation)).toBe('S2');
});

it('reconstructs the screenshot and fixes third-hand ducking while preserving fourth-hand economy', async () => {
  const states = userBoardStates(); expect(states[52].result!.declarerTricks).toBe(10); expect(states[52].result!.scoreNS).toBe(130);
  const beforeEast = states[38]; expect(beforeEast.turn).toBe('E');
  expect(beforeEast.currentTrick.map(p => p.card.id)).toEqual(['H4', 'H2']);
  const observation = observe(beforeEast) as PlayObservation;
  expect(observation.legalCards.map(c => c.id).sort()).toEqual(['H11', 'H13', 'H14', 'H7'].sort());
  const chosen = chooseCard(observation); expect(chosen).toBe('H13');
  const afterEast = playCard(beforeEast, 'E', chosen);
  const afterSouth = playCard(afterEast, 'S', 'H8'); expect(afterSouth.completedTricks.at(-1)!.winner).toBe('E');
  // Screenshot trick 12: fourth hand West should play 9 under partner's K, retaining Q.
  expect(chooseCard(observe(states[47]) as PlayObservation)).toBe('H9');
  const engine = await DdsEngine.create(); const analysis = engine.solve(analysisPosition(beforeEast));
  const low = analysis.candidates.find(c => c.cardId === 'H7')!; const corrected = analysis.candidates.find(c => c.cardId === chosen)!;
  expect(low.loss).toBeGreaterThan(0); expect(corrected.loss).toBe(0);
  writeFileSync('artifacts/third-hand-user-regression.json', JSON.stringify({
    executedAt: new Date().toISOString(), engine: ENGINE,
    fixtureSha256: createHash('sha256').update(JSON.stringify({ hands: states[0].initialHands, tricks: states[52].completedTricks })).digest('hex'),
    source: 'Manual reconstruction of user screenshot (not original saved seed)',
    prefixLegallyReplayed: true, originalFinalDeclarerTricks: 10, originalScoreNS: 130,
    actingSeat: beforeEast.turn, trick: 10, currentTrick: ['W:H4', 'N:H2'], legalCards: observation.legalCards.map(c => c.id),
    oldChoice: 'H7', newChoice: chosen, oldChoiceDds: low, newChoiceDds: corrected,
    cause: 'Partner currently winning was treated as final before fourth hand played', fourthHandRegression: 'West retains HQ by playing H9 under East HK'
  }, null, 2));
});

it('the third-hand correction uses only own hand, dummy and public history', () => {
  const state = userBoardStates()[38]; const other = structuredClone(state);
  const hidden = [...other.hands.S, ...other.hands.W].reverse(); const southCount = other.hands.S.length;
  other.hands.S = hidden.slice(0, southCount); other.hands.W = hidden.slice(southCount);
  expect(observe(other)).toEqual(observe(state));
  expect(chooseCard(observe(other) as PlayObservation)).toBe(chooseCard(observe(state) as PlayObservation));
});
