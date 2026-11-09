import type { AuctionEntry, Seat } from '../core/types';
import { partnerOf, sideOf } from '../core/types';
import type { BiddingSystem } from './systems';

/** Reverse Drury is an explicit Natural agreement. Competition switches it
 * off; the context depends only on the public auction, never on hidden hands. */
export function druryContext(auction: AuctionEntry[], system: BiddingSystem) {
  if (system !== 'two-over-one') return undefined;
  const openingIndex = auction.findIndex(e => e.call.kind !== 'pass');
  if (openingIndex !== 2 && openingIndex !== 3) return undefined;
  const opening = auction[openingIndex];
  if (opening.call.kind !== 'bid' || opening.call.level !== 1
    || !['H', 'S'].includes(opening.call.strain)) return undefined;
  const responder = partnerOf(opening.seat);
  if (!auction.slice(0, openingIndex).some(e => e.seat === responder && e.call.kind === 'pass')) return undefined;
  const side = auction.flatMap((e,index) => index >= openingIndex && sideOf(e.seat) === sideOf(opening.seat)
    && e.call.kind !== 'pass' ? [{...e,index}] : []);
  const ask = side[1];
  if (auction.some((e,index) => index > openingIndex && sideOf(e.seat) !== sideOf(opening.seat)
    && e.call.kind !== 'pass' && !(ask && index > ask.index && e.call.kind === 'double'))) return undefined;
  if (ask && (ask.seat !== responder || ask.call.kind !== 'bid' || ask.call.level !== 2 || ask.call.strain !== 'C')) return undefined;
  return { opening, openingIndex, responder, trump: opening.call.strain as 'H' | 'S', side, ask, answer: side[2] };
}
export function druryDecisionContext(auction: AuctionEntry[], seat: Seat, system: BiddingSystem) {
  const context = druryContext(auction, system);
  if (!context || context.side.length > 4) return undefined;
  return context.side.length === 1 && seat === context.responder || context.ask ? context : undefined;
}

/** Keep every auction containing a recognized Drury ask in the new public semantics,
 * even when a later opponent action switches off its active decision context. */
export function hasDruryHistory(auction: AuctionEntry[], system: BiddingSystem): boolean {
 if(system !== 'two-over-one') return false;
 const openingIndex=auction.findIndex(entry=>entry.call.kind!=='pass');
 if(openingIndex!==2&&openingIndex!==3)return false;
 return auction.some((entry,index)=>index>openingIndex&&entry.seat===partnerOf(auction[openingIndex].seat)
   &&entry.call.kind==='bid'&&entry.call.level===2&&entry.call.strain==='C'
   &&!!druryContext(auction.slice(0,index+1),system)?.ask);
}
