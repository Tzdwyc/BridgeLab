import { type PlayObservation } from './observation';
import { chooseSafetyCard } from './play-safety';
import { type BiddingSystem } from './systems';

export function chooseCard(obs: PlayObservation, system: BiddingSystem = 'two-over-one'): string {
  const chosen = chooseSafetyCard(obs, system);
  if (!obs.legalCards.some(card => card.id === chosen.id)) throw new Error('安全层返回了不合法牌张');
  return chosen.id;
}
