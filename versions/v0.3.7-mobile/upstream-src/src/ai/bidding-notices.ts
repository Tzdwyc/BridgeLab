import { bidValue } from '../core/auction';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../core/types';
import { type BiddingSystem } from './systems';

export interface BiddingNotice {
  kind: 'stop';
  label: 'STOP';
  explanation: string;
}

function cheapestLevelOverLast(auction: AuctionEntry[], strain: Strain): number | undefined {
  const lastBid = [...auction].reverse().find(entry => entry.call.kind === 'bid');
  if (!lastBid || lastBid.call.kind !== 'bid') return undefined;
  for (let level = 1; level <= 7; level++) {
    if (bidValue({ kind: 'bid', level, strain }) > bidValue(lastBid.call)) return level;
  }
}

/** Opening calls never receive STOP. After an opening, only a true skip bid does. */
export function isJumpBid(auction: AuctionEntry[], call: Call): boolean {
  if (call.kind !== 'bid') return false;
  const cheapest = cheapestLevelOverLast(auction, call.strain);
  return cheapest !== undefined && call.level > cheapest;
}

/** ALERT is intentionally an inert UI card until convention recognition is complete. */
export function biddingNotices(auction: AuctionEntry[], _seat: Seat, call: Call, _system: BiddingSystem): BiddingNotice[] {
  return isJumpBid(auction, call)
    ? [{ kind: 'stop', label: 'STOP', explanation: '跳叫／越级叫：请下家停顿后再叫牌' }]
    : [];
}
