import { auctionStatus, sameCall } from '../core/auction';
import { type Call, PASS, partnerOf, sideOf } from '../core/types';
import { chooseBid, evaluateHand } from './bidding';
import { classifyDoubleAt, isNaturalNoTrumpAt, publicCallMeaningAt } from './bidding-semantics';
import { assessCompetitivePenaltyDouble, chooseCompetitiveCall, compareCompetitiveThreeNoTrumpPenalty, countDefensiveQuickTricks } from './competition';
import type { BiddingObservation } from './observation';
import type { BiddingSystem } from './systems';

export type PenaltyDoubleReason = 'make-penalty-double' | 'avoid-penalty-double'
  | 'keep-partner-penalty-double' | 'escape-penalty-double';

const DOUBLE: Call = { kind: 'double' };

/** Use the convention card's competitive decisions at clearly identified penalty doubles. */
export function adjustPenaltyDouble(
  obs: BiddingObservation, slCall: Call, system: BiddingSystem,
): { call: Call; reason: PenaltyDoubleReason } | undefined {
  if (system === 'natural-lite') return undefined;
  const { auction, seat, legalCalls } = obs;
  const { lastBid, doubled, ended } = auctionStatus(auction);
  if (ended || lastBid?.call.kind !== 'bid') return undefined;
  const result = (call: Call, reason: PenaltyDoubleReason) =>
    !sameCall(call, slCall) && legalCalls.some(legal => sameCall(call, legal)) ? { call, reason } : undefined;

  const contract = lastBid.call;
  const contractIndex = auction.indexOf(lastBid);
  if (doubled === 0) {
    if (slCall.kind === 'bid' && compareCompetitiveThreeNoTrumpPenalty(obs, system, slCall))
      return result(DOUBLE, 'make-penalty-double');
    if ((slCall.kind !== 'pass' && slCall.kind !== 'double')
      || !legalCalls.some(call => call.kind === 'double')
      || classifyDoubleAt([...auction, { seat, call: DOUBLE }], auction.length, system) !== 'penalty') return undefined;
    const naturalOneNT = contract.level === 1 && contract.strain === 'NT'
      && isNaturalNoTrumpAt(auction, contractIndex, system);
    const ruleCall = chooseBid(obs, system);
    if (ruleCall.kind === 'double' || (naturalOneNT && chooseCompetitiveCall(obs, system)?.kind === 'double'))
      return result(DOUBLE, 'make-penalty-double');
    if (slCall.kind === 'double') {
      const weakAgainstOneNT = naturalOneNT && (evaluateHand(obs.hand).hcp < 15 || countDefensiveQuickTricks(obs.hand) < 3);
      const weakInHighCompetition = (system === 'two-over-one' || system === 'sayc') &&
        assessCompetitivePenaltyDouble(obs, system, { highOnly: true }) === false;
      if (weakAgainstOneNT || weakInHighCompetition) return result(ruleCall, 'avoid-penalty-double');
    }
    return undefined;
  }

  if (doubled !== 1) return undefined;
  const doubleIndex = auction.findLastIndex(entry => entry.call.kind !== 'pass');
  if (classifyDoubleAt(auction, doubleIndex, system) !== 'penalty') return undefined;
  const partner = partnerOf(seat);
  if (auction[doubleIndex].seat === partner) {
    return slCall.kind !== 'pass' && chooseBid(obs, system).kind === 'pass'
      ? result(PASS, 'keep-partner-penalty-double') : undefined;
  }
  if (sideOf(auction[doubleIndex].seat) === sideOf(seat) || lastBid.seat !== partner || contract.level !== 1
    || (slCall.kind !== 'pass' && slCall.kind !== 'redouble')) return undefined;

  const { lengths } = evaluateHand(obs.hand);
  if (contract.strain !== 'NT' && lengths[contract.strain] !== 0) return undefined;
  const ruleCall = chooseBid(obs, system);
  if (ruleCall.kind !== 'bid' || ruleCall.level !== 2 || ruleCall.strain === 'NT') return undefined;
  const meaning = publicCallMeaningAt([...auction, { seat, call: ruleCall }], auction.length, system);
  if (meaning.role === 'weak-doubled-escape') return result(ruleCall, 'escape-penalty-double');
  // A seven-card original major can escape partner's doubled semi-forcing NT.
  if (contract.strain === 'NT' && publicCallMeaningAt(auction, contractIndex, system).role === 'semi-forcing-nt'
    && !meaning.artificial && (ruleCall.strain === 'H' || ruleCall.strain === 'S') && lengths[ruleCall.strain] >= 7
    && auction.some(entry => entry.seat === seat && entry.call.kind === 'bid'
      && entry.call.level === 1 && entry.call.strain === ruleCall.strain)) return result(ruleCall, 'escape-penalty-double');
  return undefined;
}
