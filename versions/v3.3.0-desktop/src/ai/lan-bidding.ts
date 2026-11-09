import { chooseSystemBid } from './bid-strategy';
import type { BiddingObservation } from './observation';
import type { BiddingSystem } from './systems';

export function chooseLanBid(obs: BiddingObservation, system: BiddingSystem = 'two-over-one') {
  return chooseSystemBid(obs, system);
}
