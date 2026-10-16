import { deck } from '../core/deal';
import { legalCards, trickWinner } from '../core/play';
import {
  type AuctionEntry,
  type Card,
  type PlayedCard,
  type Seat,
  type Suit,
  SUITS,
  nextSeat,
  partnerOf,
  sideOf
} from '../core/types';
import { type PlayObservation } from './observation';
import { type BiddingSystem } from './systems';

export const lowCardOrder = (a: Card, b: Card) =>
  a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);

const highCardOrder = (a: Card, b: Card) => b.rank - a.rank;

function allPublicPlays(obs: PlayObservation): PlayedCard[] {
  return [...obs.completedTricks.flatMap(trick => trick.plays), ...obs.currentTrick];
}

function knownHand(obs: PlayObservation, seat: Seat): Card[] | null {
  if (seat === obs.actingSeat) return obs.actingHand;
  if (seat === obs.seat) return obs.hand;
  if (seat === obs.dummy?.seat) return obs.dummy.cards;
  return null;
}

function publicVoid(obs: PlayObservation, seat: Seat, suit: Suit): boolean {
  const tricks = [...obs.completedTricks.map(trick => trick.plays), obs.currentTrick];
  return tricks.some(plays => plays.length > 0 && plays[0].card.suit === suit && plays.some(play => play.seat === seat && play.card.suit !== suit));
}

function knownIds(obs: PlayObservation): Set<string> {
  return new Set([
    ...obs.hand,
    ...obs.actingHand,
    ...(obs.dummy?.cards ?? []),
    ...allPublicPlays(obs).map(play => play.card)
  ].map(card => card.id));
}

function unseenCards(obs: PlayObservation): Card[] {
  const known = knownIds(obs);
  return deck().filter(card => !known.has(card.id));
}

function friendlyKnownCards(obs: PlayObservation): Card[] {
  const partner = knownHand(obs, partnerOf(obs.actingSeat)) ?? [];
  return [...obs.actingHand, ...partner];
}

function isEstablishedCard(obs: PlayObservation, card: Card, extraPlayed: Card[] = []): boolean {
  const publicIds = new Set([...allPublicPlays(obs).map(play => play.card.id), ...extraPlayed.map(value => value.id)]);
  const friendlyIds = new Set(friendlyKnownCards(obs).map(value => value.id));
  for (let rank = card.rank + 1; rank <= 14; rank++) {
    const id = `${card.suit}${rank}`;
    if (!publicIds.has(id) && !friendlyIds.has(id)) return false;
  }
  return true;
}

function hasStopper(obs: PlayObservation, cards: Card[], suit: Suit, extraPlayed: Card[] = []): boolean {
  const inSuit = cards.filter(card => card.suit === suit);
  if (!inSuit.length) return false;
  const top = Math.max(...inSuit.map(card => card.rank));
  const publicIds = new Set([...allPublicPlays(obs).map(play => play.card.id), ...extraPlayed.map(card => card.id)]);
  const friendlyIds = new Set([
    ...cards,
    ...(knownHand(obs, partnerOf(obs.actingSeat)) ?? [])
  ].map(card => card.id));
  let missingHigher = 0;
  for (let rank = top + 1; rank <= 14; rank++) {
    const id = `${suit}${rank}`;
    if (!publicIds.has(id) && !friendlyIds.has(id)) missingHigher++;
  }
  return inSuit.length > missingHigher;
}

function breaksOnlyStopper(obs: PlayObservation, card: Card): boolean {
  if (!hasStopper(obs, obs.actingHand, card.suit)) return false;
  const remaining = obs.actingHand.filter(value => value.id !== card.id);
  return !hasStopper(obs, remaining, card.suit, [card]);
}

function discardCost(obs: PlayObservation, card: Card): number {
  let cost = 0;
  if (isEstablishedCard(obs, card)) cost += 10_000;
  if (breaksOnlyStopper(obs, card)) cost += 8_000;
  if (card.rank >= 10) cost += 1_000 + card.rank;
  if (obs.contract.strain !== 'NT' && card.suit === obs.contract.strain) cost += 300;
  const length = obs.actingHand.filter(value => value.suit === card.suit).length;
  return cost - length;
}

function safeDiscard(obs: PlayObservation, legal: Card[]): Card {
  const led = obs.currentTrick[0]?.card.suit;
  if (led && legal.every(card => card.suit === led)) return [...legal].sort(lowCardOrder)[0];
  return [...legal].sort((a, b) => discardCost(obs, a) - discardCost(obs, b) || lowCardOrder(a, b))[0];
}

function fourthHandCards(obs: PlayObservation, fourth: Seat, after: PlayedCard[]): Card[] {
  const known = knownHand(obs, fourth);
  if (known) return legalCards(known, after);
  const led = after[0].card.suit;
  const unseen = unseenCards(obs);
  if (!publicVoid(obs, fourth, led)) return unseen.filter(card => card.suit === led);
  if (obs.contract.strain === 'NT' || publicVoid(obs, fourth, obs.contract.strain)) return [];
  return unseen.filter(card => card.suit === obs.contract.strain);
}

function chooseThirdHand(obs: PlayObservation, legal: Card[]): Card {
  const { actingSeat, contract, currentTrick } = obs;
  const fourth = nextSeat(actingSeat);
  const led = currentTrick[0].card.suit;
  const partnerWinning = sideOf(trickWinner(currentTrick, contract.strain)) === sideOf(actingSeat);
  const after = (card: Card): PlayedCard[] => [...currentTrick, { seat: actingSeat, card }];
  const possible = fourthHandCards(obs, fourth, after(legal[0]));
  const wins = (card: Card, fourthCard: Card) =>
    sideOf(trickWinner([...after(card), { seat: fourth, card: fourthCard }], contract.strain)) === sideOf(actingSeat);

  const fourthVoid = publicVoid(obs, fourth, led) || knownHand(obs, fourth)?.every(card => card.suit !== led) === true;
  const fourthCannotRuff = contract.strain === 'NT' || publicVoid(obs, fourth, contract.strain)
    || knownHand(obs, fourth)?.every(card => card.suit !== contract.strain) === true;
  if (partnerWinning && fourthVoid && fourthCannotRuff) return safeDiscard(obs, legal);

  const safe = legal.filter(card =>
    sideOf(trickWinner(after(card), contract.strain)) === sideOf(actingSeat)
    && possible.every(fourthCard => wins(card, fourthCard))
  );
  if (safe.length) return safe[0];

  if (partnerWinning && fourthVoid && legal.every(card => card.suit === led)) return legal[0];

  const winners = legal.filter(card => trickWinner(after(card), contract.strain) === actingSeat);
  if (!winners.length) return safeDiscard(obs, legal);
  const strength = (card: Card) => (card.suit === contract.strain ? 100 : card.suit === led ? 50 : 0) + card.rank;
  const high = [...winners].sort((a, b) => strength(b) - strength(a))[0];
  return winners.find(card => possible.every(fourthCard => wins(card, fourthCard) === wins(high, fourthCard))) ?? high;
}

function chooseInTrick(obs: PlayObservation, legal: Card[]): Card {
  const { currentTrick, actingSeat, contract } = obs;
  const winningSeat = trickWinner(currentTrick, contract.strain);
  const partnerWinning = sideOf(winningSeat) === sideOf(actingSeat);

  if (currentTrick.length === 3) {
    if (partnerWinning) return safeDiscard(obs, legal);
    const winners = legal.filter(card => trickWinner([...currentTrick, { seat: actingSeat, card }], contract.strain) === actingSeat);
    return winners[0] ?? safeDiscard(obs, legal);
  }

  if (currentTrick.length === 2) return chooseThirdHand(obs, legal);

  const led = currentTrick[0].card;
  const follows = legal.every(card => card.suit === led.suit);
  if (follows && led.rank < 10) return legal[0];
  const winners = legal.filter(card => trickWinner([...currentTrick, { seat: actingSeat, card }], contract.strain) === actingSeat);
  return winners[0] ?? safeDiscard(obs, legal);
}

function isArtificialBid(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const entry = auction[index];
  if (entry.call.kind !== 'bid') return false;
  const bidsBefore = auction.slice(0, index).filter(item => item.call.kind === 'bid');
  if (system === 'precision' && entry.call.level === 1 && entry.call.strain === 'C' && bidsBefore.length === 0) return true;
  if (system === 'precision' && entry.call.level === 1 && entry.call.strain === 'D') {
    return auction.slice(0, index).some(item => item.seat === partnerOf(entry.seat)
      && item.call.kind === 'bid' && item.call.level === 1 && item.call.strain === 'C');
  }
  if (system !== 'precision' && entry.call.level === 2 && entry.call.strain === 'C' && bidsBefore.length === 0) return true;
  const partnerBid = [...auction.slice(0, index)].reverse().find(item => item.seat === partnerOf(entry.seat) && item.call.kind === 'bid');
  if (partnerBid?.call.kind === 'bid' && partnerBid.call.strain === 'NT') {
    const expectedLevel = partnerBid.call.level + 1;
    if (entry.call.level === expectedLevel && ['C', 'D', 'H'].includes(entry.call.strain)) return true;
  }
  return false;
}

function naturalPartnerSuit(obs: PlayObservation, system: BiddingSystem): Suit | null {
  for (let index = obs.auction.length - 1; index >= 0; index--) {
    const entry = obs.auction[index];
    if (entry.seat !== partnerOf(obs.actingSeat) || entry.call.kind !== 'bid' || entry.call.strain === 'NT') continue;
    if (!isArtificialBid(obs.auction, index, system)) return entry.call.strain;
  }
  return null;
}

function partnerOpeningLeadSuit(obs: PlayObservation): Suit | null {
  const openingTrick = obs.completedTricks[0];
  if (!openingTrick || openingTrick.leader !== partnerOf(obs.actingSeat)) return null;
  return openingTrick.plays[0]?.card.suit ?? null;
}

function chooseLead(obs: PlayObservation, legal: Card[], system: BiddingSystem): Card {
  const lengths = Object.fromEntries(SUITS.map(suit => [suit, obs.actingHand.filter(card => card.suit === suit).length])) as Record<Suit, number>;
  const declarerSide = sideOf(obs.actingSeat) === sideOf(obs.contract.declarer);
  let suit = [...SUITS].filter(value => lengths[value] > 0)
    .sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a))[0];

  if (!declarerSide) {
    const returnSuit = partnerOpeningLeadSuit(obs);
    const partnerSuit = naturalPartnerSuit(obs, system);
    if (returnSuit && lengths[returnSuit]) suit = returnSuit;
    else if (partnerSuit && lengths[partnerSuit]) suit = partnerSuit;
  }

  const cards = legal.filter(card => card.suit === suit).sort(highCardOrder);
  const established = cards.filter(card => isEstablishedCard(obs, card));
  if (established.length) return established[0];
  if (cards.length >= 2 && cards[0].rank >= 10 && cards[0].rank - cards[1].rank === 1) return cards[0];
  if (obs.contract.strain === 'NT' && cards.length >= 4 && !declarerSide) return cards[3];
  return cards.at(-1) ?? safeDiscard(obs, legal);
}

export function chooseSafetyCard(obs: PlayObservation, system: BiddingSystem = 'two-over-one'): Card {
  const legal = [...obs.legalCards].sort(lowCardOrder);
  if (!legal.length) throw new Error('没有合法牌张');
  return obs.currentTrick.length ? chooseInTrick(obs, legal) : chooseLead(obs, legal, system);
}
