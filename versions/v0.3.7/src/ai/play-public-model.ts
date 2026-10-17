import { deck } from '../core/deal';
import { SEATS, SUITS, type Card, type Hands, type Seat, type Suit } from '../core/types';
import { type PlayObservation } from './observation';
import { type PublicPlayModel } from './play-advisor-types';

const canonicalCards = (cards: Card[]) => cards.map(card => card.id).sort();

/** A deterministic key made only from information legally visible to the acting player. */
export function publicPlayKey(obs: PlayObservation): string {
  return JSON.stringify({
    board: obs.board,
    seat: obs.seat,
    actingSeat: obs.actingSeat,
    vulnerability: obs.vulnerability,
    auction: obs.auction,
    hand: canonicalCards(obs.hand),
    actingHand: canonicalCards(obs.actingHand),
    dummy: obs.dummy ? { seat: obs.dummy.seat, cards: canonicalCards(obs.dummy.cards) } : null,
    currentTrick: obs.currentTrick.map(play => [play.seat, play.card.id]),
    completedTricks: obs.completedTricks.map(trick => trick.plays.map(play => [play.seat, play.card.id])),
    handSizes: obs.handSizes,
    tricksWon: obs.tricksWon,
    contract: obs.contract
  });
}

function emptyBySeat<T>(factory: () => T): Record<Seat, T> {
  return Object.fromEntries(SEATS.map(seat => [seat, factory()])) as Record<Seat, T>;
}

export function buildPublicPlayModel(obs: PlayObservation): PublicPlayModel {
  const knownHands: Partial<Hands> = {};
  const register = (seat: Seat, cards: Card[]) => {
    const existing = knownHands[seat];
    if (existing && JSON.stringify(canonicalCards(existing)) !== JSON.stringify(canonicalCards(cards))) throw new Error('同一家的公开手牌信息互相矛盾');
    knownHands[seat] = cards.map(card => ({ ...card }));
  };
  register(obs.seat, obs.hand);
  register(obs.actingSeat, obs.actingHand);
  if (obs.dummy) register(obs.dummy.seat, obs.dummy.cards);

  const playedBySeat = emptyBySeat<Card[]>(() => []);
  const voidSets = emptyBySeat<Set<Suit>>(() => new Set<Suit>());
  const tricks = [...obs.completedTricks.map(trick => trick.plays), obs.currentTrick];
  for (const plays of tricks) {
    const led = plays[0]?.card.suit;
    for (const play of plays) {
      playedBySeat[play.seat].push({ ...play.card });
      if (led && play.card.suit !== led) voidSets[play.seat].add(led);
    }
  }
  const playedIds = SEATS.flatMap(seat => playedBySeat[seat].map(card => card.id));
  const knownRemaining = SEATS.flatMap(seat => knownHands[seat] ?? []);
  const ids = [...playedIds, ...knownRemaining.map(card => card.id)];
  const validIds = new Set(deck().map(card => card.id));
  if (new Set(ids).size !== ids.length || ids.some(id => !validIds.has(id))) throw new Error('公开牌张包含重复或非法牌');
  for (const seat of SEATS) {
    const known = knownHands[seat];
    if (known && known.length !== obs.handSizes[seat]) throw new Error('公开手牌张数与牌局记录不一致');
  }
  return {
    key: publicPlayKey(obs), knownHands, playedIds, playedBySeat,
    voids: Object.fromEntries(SEATS.map(seat => [seat, SUITS.filter(suit => voidSets[seat].has(suit))])) as Record<Seat, Suit[]>,
    remainingCounts: { ...obs.handSizes }
  };
}
