import { type AuctionEntry, type Card, type Call, type Contract, type GameState, type PlayedCard, type Seat, type Side, type Trick, type Vulnerability, SEATS } from '../core/types';
import { controllerFor } from '../core/game';
import { legalCalls } from '../core/auction';
import { legalCards } from '../core/play';

interface PublicInformation {
  board: number; seat: Seat; actingSeat: Seat; vulnerability: Vulnerability;
  auction: AuctionEntry[]; hand: Card[];
}
export interface BiddingObservation extends PublicInformation { phase: 'auction'; legalCalls: Call[] }
export interface PlayObservation extends PublicInformation {
  phase: 'play'; contract: Contract; actingHand: Card[]; legalCards: Card[];
  dummy: { seat: Seat; cards: Card[] } | null;
  currentTrick: PlayedCard[]; completedTricks: Trick[];
  handSizes: Record<Seat, number>; tricksWon: Record<Side, number>;
}
export type Observation = BiddingObservation | PlayObservation;

/** This is the ONLY game-to-strategy boundary. No seed or hidden hands cross it. */
export function observe(state: GameState): Observation {
  const seat = controllerFor(state);
  const common: PublicInformation = { board: state.board, seat, actingSeat: state.turn, vulnerability: state.vulnerability, auction: state.auction, hand: state.hands[seat] };
  if (state.phase === 'auction') return structuredClone({ ...common, phase: 'auction', legalCalls: legalCalls(state.auction, seat) });
  if (state.phase !== 'play' || !state.contract) throw new Error('结束的牌局没有可行动观察');
  const observation: PlayObservation = {
    ...common, phase: 'play', contract: state.contract, actingHand: state.hands[state.turn],
    legalCards: legalCards(state.hands[state.turn], state.currentTrick),
    dummy: state.dummyRevealed ? { seat: state.contract.dummy, cards: state.hands[state.contract.dummy] } : null,
    currentTrick: state.currentTrick, completedTricks: state.completedTricks,
    tricksWon: state.tricksWon,
    handSizes: Object.fromEntries(SEATS.map(s => [s, state.hands[s].length])) as Record<Seat, number>
  };
  return structuredClone(observation);
}
