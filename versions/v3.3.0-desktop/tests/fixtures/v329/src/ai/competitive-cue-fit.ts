import { sameCall } from '../core/auction';
import { type Call, nextSeat, partnerOf } from '../core/types';
import { chooseBid } from './bidding';
import { analyzeAuctionSemantics, isArtificialBidAt, publicCallMeaningAt, publicPlayerConstraints } from './bidding-semantics';
import { callToAction } from './neural';
import type { BiddingObservation } from './observation';

/** An enemy-suit cue supplies no fit for a natural game in that suit. */
export function correctImpossibleCueFit(obs: BiddingObservation, call: Call, logits: Float32Array): Call | undefined {
  if (call.kind !== 'bid' || call.level < 4 || (call.strain !== 'H' && call.strain !== 'S')) return undefined;
  const { auction, seat } = obs;
  const strain = call.strain, system = 'two-over-one';
  const index = auction.findLastIndex(entry => entry.call.kind === 'bid');
  const last = auction[index];
  const partner = partnerOf(seat);
  if (last?.seat !== partner || last.call.kind !== 'bid' || last.call.strain !== strain) return undefined;
  const cue = publicCallMeaningAt(auction, index, system);
  if (!cue.defined || !cue.artificial || cue.role !== 'cue') return undefined;
  const opponent = nextSeat(seat);
  const enemyMinimum = publicPlayerConstraints(auction, opponent, system).suitMinimums[strain] +
    publicPlayerConstraints(auction, partnerOf(opponent), system).suitMinimums[strain];
  if (enemyMinimum < 6) return undefined;

  const safe = (candidate: Call) => candidate.kind !== 'bid' || candidate.level < 4 || candidate.strain !== strain ||
    isArtificialBidAt([...auction, { seat, call: candidate }], auction.length, system);
  if (safe(call)) return undefined;

  const available = obs.legalCalls.filter(safe);
  const mustBid = analyzeAuctionSemantics(auction, seat, system).mustBid;
  const replies = mustBid ? available.filter(candidate => candidate.kind !== 'pass') : available;
  const legalCalls = replies.length ? replies : available;
  const preferred = chooseBid({ ...obs, legalCalls }, system);
  if (legalCalls.some(candidate => sameCall(candidate, preferred))) return preferred;
  return legalCalls.reduce((best, candidate) => {
    const score = logits[callToAction(candidate)], bestScore = logits[callToAction(best)];
    return score > bestScore || (score === bestScore && callToAction(candidate) < callToAction(best)) ? candidate : best;
  });
}
