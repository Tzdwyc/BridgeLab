import { type AuctionEntry, type Call, type Contract, type Seat, STRAINS, PASS, sideOf, partnerOf, nextSeat, BridgeError } from './types';

export const bidValue = (call: Call): number => call.kind === 'bid' ? (call.level - 1) * 5 + STRAINS.indexOf(call.strain) : -1;
export function auctionStatus(auction: AuctionEntry[]) {
  let lastBid: AuctionEntry | null = null; let doubled: 0 | 1 | 2 = 0; let passes = 0;
  for (const entry of auction) {
    if (entry.call.kind === 'pass') passes++;
    else {
      passes = 0;
      if (entry.call.kind === 'bid') { lastBid = entry; doubled = 0; }
      if (entry.call.kind === 'double') doubled = 1;
      if (entry.call.kind === 'redouble') doubled = 2;
    }
  }
  return { lastBid, doubled, passes, ended: lastBid ? passes >= 3 : passes >= 4 };
}

export function legalCalls(auction: AuctionEntry[], seat: Seat): Call[] {
  const { lastBid, doubled, ended } = auctionStatus(auction);
  if (ended) return [];
  const calls: Call[] = [PASS]; const floor = lastBid ? bidValue(lastBid.call) : -1;
  for (let level = 1; level <= 7; level++) for (const strain of STRAINS) {
    const bid: Call = { kind: 'bid', level, strain };
    if (bidValue(bid) > floor) calls.push(bid);
  }
  if (lastBid && sideOf(lastBid.seat) !== sideOf(seat) && doubled === 0) calls.push({ kind: 'double' });
  if (lastBid && sideOf(lastBid.seat) === sideOf(seat) && doubled === 1) calls.push({ kind: 'redouble' });
  return calls;
}

export function sameCall(a: Call, b: Call): boolean {
  return a.kind === b.kind && (a.kind !== 'bid' || (b.kind === 'bid' && a.level === b.level && a.strain === b.strain));
}

export function finalContract(auction: AuctionEntry[]): Contract | null {
  const { lastBid, doubled, ended } = auctionStatus(auction);
  if (!ended) throw new BridgeError('AUCTION_OPEN', '叫牌尚未结束');
  if (!lastBid || lastBid.call.kind !== 'bid') return null;
  const { level, strain } = lastBid.call;
  const declarer = auction.find(entry => entry.call.kind === 'bid' && entry.call.strain === strain && sideOf(entry.seat) === sideOf(lastBid.seat))!.seat;
  return { level, strain, doubled, declarer, dummy: partnerOf(declarer), leader: nextSeat(declarer) };
}
