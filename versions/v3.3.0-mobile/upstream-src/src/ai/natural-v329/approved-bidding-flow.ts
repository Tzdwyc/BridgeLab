import type { BiddingObservation } from './observation';
import type { BiddingSystem } from './systems';
import { partnerOf, sideOf } from '../../core/types';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPendingResponse, publicStrongDiamondAnswerAt } from './bidding-semantics';

/** The v3.2.6 additions are checked separately by the default eighth-epoch
 * entry. The original SL entry keeps its existing agreement-flow boundary. */
export function usesApprovedContinuationFlow(obs: BiddingObservation, system: BiddingSystem): boolean {
  if (system !== 'sayc' && system !== 'two-over-one') return false;
  const state = analyzeAuctionSemantics(obs.auction, obs.seat, system);
  if (['michaels-advance', 'michaels-inquiry', 'weak-jump-inquiry'].includes(state.convention)) return true;
  if (state.convention === 'responder-second-suit' && state.forcing === 'one-round' && state.mustBid) return true;
  // Recognize the public platform before the ask as well as its answers.
  // Private strength still decides whether the existing rule asks or stops.
  const ask = { kind: 'bid' as const, level: 2, strain: 'NT' as const };
  if (obs.legalCalls.some(call => call.kind === 'bid' && call.level === 2 && call.strain === 'NT')
    && publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: ask }], obs.auction.length, system).role === 'weak-feature-inquiry') return true;
  const partner = obs.auction.findLastIndex(entry => entry.seat === partnerOf(obs.seat) && entry.call.kind !== 'pass');
  // The compulsory minor answer completes the inquiry. Advancer then uses
  // the established natural fit/strength decision, with no automatic game.
  return partner >= 0 && publicCallMeaningAt(obs.auction, partner, system).role === 'michaels-minor-answer'
    && !obs.auction.slice(partner + 1).some(entry => entry.seat === obs.seat
      || sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid');
}

/** Only the three approved protocol repairs use the existing rule decision at
 * the SL entry. No general convention filter or new strength threshold. */
export function usesRepairedBiddingFlow(obs: BiddingObservation, system: BiddingSystem): boolean {
  if (system !== 'sayc' && system !== 'two-over-one') return false;
  const side = obs.auction.flatMap((entry, index) => entry.call.kind === 'bid'
    && sideOf(entry.seat) === sideOf(obs.seat) ? [{ ...entry, call: entry.call, index }] : []);
  const quiet = !obs.auction.some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind !== 'pass');
  if (quiet) {
    const proposed = [...obs.auction, { seat: obs.seat, call: { kind: 'pass' as const } }];
    if (publicStrongDiamondAnswerAt(proposed, obs.auction.length, system)) return true;
    const answer = side[3];
    if (answer && publicStrongDiamondAnswerAt(obs.auction, answer.index, system)
      && (answer.call.level === 3 && ['H', 'NT'].includes(answer.call.strain)
        || answer.call.level === 4 && answer.call.strain === 'H')) {
      if (side.length === 4) return true;
      if (side.length === 5 && answer.call.strain === 'H'
        && side[4].call.level === 4 && side[4].call.strain === 'D') return true;
    }
  }
  const first = obs.auction.find(entry => entry.call.kind === 'bid');
  if (system === 'sayc' && first?.call.kind === 'bid' && first.call.level === 1
    && first.call.strain !== 'NT' && sideOf(first.seat) !== sideOf(obs.seat)
    && analyzeAuctionSemantics(obs.auction, obs.seat, system).convention === 'weak-jump-inquiry') return true;
  // A recognized competitive RKCB must receive the existing 1430 response;
  // a neural legal-only selection does not guarantee that protocol answer.
  return obs.auction.some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid')
    && publicPendingResponse(obs.auction, obs.seat, system)?.kind === 'keycard';
}
