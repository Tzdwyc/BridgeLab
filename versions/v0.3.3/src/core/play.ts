import { type Card, type PlayedCard, type Seat, type Strain } from './types';

export function legalCards(hand: Card[], trick: PlayedCard[]): Card[] {
  if (!trick.length) return [...hand];
  const followers = hand.filter(card => card.suit === trick[0].card.suit);
  return followers.length ? followers : [...hand];
}

export function trickWinner(plays: PlayedCard[], trump: Strain): Seat {
  if (!plays.length) throw new Error('空墩没有赢家');
  const lead = plays[0].card.suit;
  const priority = (card: Card) => card.suit === trump ? 2 : card.suit === lead ? 1 : 0;
  return plays.reduce((best, play) => priority(play.card) > priority(best.card) || (priority(play.card) === priority(best.card) && play.card.rank > best.card.rank) ? play : best).seat;
}
