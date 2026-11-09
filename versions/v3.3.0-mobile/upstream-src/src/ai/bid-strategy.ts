import { suggestSystemBid as frozenSuggestSystemBid } from './natural-v329/bid-strategy';
import { hasDruryHistory } from './drury';
import { evaluateHand } from './bidding-legacy';
import { evaluateSuitFit } from './suit-evaluation';
import { standardAceContext } from './standard-aces';
import { publicKeycardTrumpAt, isNaturalNoTrumpAt } from './bidding-semantics';
import { partnerOf } from '../core/types';
import { druryDecisionContext } from './drury';
import type { Call } from '../core/types';
import type { BiddingObservation } from './observation';
import type { BiddingSystem } from './systems';
import { chooseBid } from './bidding';
import { decidePrecisionBid } from './precision';
import { suggestSLBid, recordAppliedSLBid, type SLBidTrace } from './neural/browser-model';
import { callToAction } from './neural';
import { usesRepairedBiddingFlow, usesApprovedContinuationFlow } from './approved-bidding-flow';
import { enforceBiddingConsistency } from './bidding-consistency';

/** The agreement is frozen when a board is created, independently of settings. */
export const agreementVersionFor = (system: BiddingSystem): string => system === 'precision'
  ? 'precision-v3.1-natural-continuation' : system === 'natural-lite' ? 'natural-lite-v0.1' : system === 'sayc' ? 'sayc-v3.0-standard' : 'natural-v3.0-drury';

export function chooseSystemBid(obs: BiddingObservation, system: BiddingSystem): Call {
  return system === 'precision' ? decidePrecisionBid(obs) : chooseBid(obs, system);
}

/** Precision never loads, checks, or invokes the natural SL network. */
export async function suggestSystemBid(obs: BiddingObservation,
  options: { system: BiddingSystem; allowLookahead?: boolean }): Promise<{ call: Call; trace: SLBidTrace | null }> {
  if (options.system === 'precision') return { call: decidePrecisionBid(obs), trace: null };
  if(options.system === 'two-over-one' && !hasDruryHistory(obs.auction,options.system)) {
    const selected = await frozenSuggestSystemBid(obs,{...options,system:'sayc',allowLookahead:false});
    const ctx=druryDecisionContext(obs.auction,obs.seat,options.system);
    if(!ctx) return selected;
    const {lengths}=evaluateHand(obs.hand), points=evaluateSuitFit(obs.hand,ctx.trump,5).totalPoints;
    const qualified=lengths[ctx.trump]>=3&&points>=10&&points<=12;
    const occupied=selected.call.kind==='bid'&&selected.call.level===2&&selected.call.strain==='C';
    if(!qualified&&!occupied)return selected;
    const call=chooseBid(obs,options.system);
    return {call,trace:selected.trace&&{...selected.trace,call,action:callToAction(call),route:'agreement-flow',reason:undefined,lookaheadSHA256:undefined}};
  }
  const selected = await suggestSLBid(obs, options);
  const standard = standardAceContext(obs.auction, options.system, publicKeycardTrumpAt, isNaturalNoTrumpAt);
  const repairedFlow = !!standard || !!druryDecisionContext(obs.auction, obs.seat, options.system) || standardFoundationFlow(obs, options.system, selected.call) || usesRepairedBiddingFlow(obs, options.system)
    || selected.trace.profileId === 'seed101-epoch08' && usesApprovedContinuationFlow(obs, options.system);
  const consistency = !repairedFlow && selected.trace.profileId === 'seed101-epoch08'
    ? enforceBiddingConsistency(obs, selected.call, options.system) : undefined;
  if (!repairedFlow && consistency?.source !== 'existing-rule') return selected;
  const call = repairedFlow ? chooseBid(obs, options.system) : consistency!.call;
  return { call, trace: { ...selected.trace, call, action: callToAction(call), route: 'agreement-flow',
    reason: repairedFlow ? undefined : 'consistency:' + consistency!.family, lookaheadSHA256: undefined } };
}

export function recordAppliedSystemBid(trace: SLBidTrace | null): void {
  if (trace) recordAppliedSLBid(trace);
}

/** Only the newly separated quiet SAYC response platform uses its new contract.
 * Other model routes and all competition keep their existing boundaries. */
function standardFoundationFlow(obs: BiddingObservation, system: BiddingSystem, selected: Call) {
  if (system !== 'sayc') return false;
  const first = obs.auction.find(e => e.call.kind !== 'pass');
  if (!first) return selected.kind==='bid'&&selected.level===4&&selected.strain==='NT';
  if (first.call.kind !== 'bid' || first.call.level !== 1 || first.call.strain === 'NT') return false;
  const opponents = obs.auction.filter(e => e.seat !== first.seat && e.seat !== partnerOf(first.seat));
  if (opponents.some(e => e.call.kind !== 'pass') || ![first.seat, partnerOf(first.seat)].includes(obs.seat)) return false;
  const bids = obs.auction.filter(e => [first.seat, partnerOf(first.seat)].includes(e.seat) && e.call.kind === 'bid');
  if (bids.length === 1) return obs.seat !== first.seat;
  const reply = bids[1].call;
  return reply.kind === 'bid' && (reply.level === 1 && reply.strain === 'NT'
    || reply.level === 2 && (reply.strain !== first.call.strain && reply.strain !== 'NT' || ['C','D'].includes(first.call.strain)&&reply.strain==='NT'));
}
