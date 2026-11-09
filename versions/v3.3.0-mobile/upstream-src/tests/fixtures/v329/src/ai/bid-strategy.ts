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
  ? 'precision-v3.1-natural-continuation' : system === 'natural-lite' ? 'natural-lite-v0.1' : `${system}-v2.4`;

export function chooseSystemBid(obs: BiddingObservation, system: BiddingSystem): Call {
  return system === 'precision' ? decidePrecisionBid(obs) : chooseBid(obs, system);
}

/** Precision never loads, checks, or invokes the natural SL network. */
export async function suggestSystemBid(obs: BiddingObservation,
  options: { system: BiddingSystem; allowLookahead?: boolean }): Promise<{ call: Call; trace: SLBidTrace | null }> {
  if (options.system === 'precision') return { call: decidePrecisionBid(obs), trace: null };
  const selected = await suggestSLBid(obs, options);
  const repairedFlow = usesRepairedBiddingFlow(obs, options.system)
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
