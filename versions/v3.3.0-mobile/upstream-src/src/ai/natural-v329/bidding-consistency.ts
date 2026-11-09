/** Narrow execution checks for already agreed public bidding contracts.
 * Unknown meanings and unapproved style boundaries keep the SL selection.
 * This layer never reads board identifiers, model scores, or hidden cards. */
import { sameCall } from '../../core/auction';
import { partnerOf, type Call } from '../../core/types';
import { chooseBid } from './bidding';
import { evaluateHand } from './bidding-legacy';
import { assessCandidates } from './constrained-sl';
import { publicCallMeaningAt, publicPendingResponse, publicPlayerConstraints, publicOpeningFourNTAt } from './bidding-semantics';
import type { BiddingObservation } from './observation';
import type { BiddingSystem } from './systems';
import { evaluateSuitFit, publicSupportMinimum } from './suit-evaluation';

export type ConsistencyFamily = 'pending-exact-answer' | 'pending-cue-answer' | 'pending-protocol-answer' | 'strong-opening-resources'
  | 'three-level-major-length' | 'natural-second-suit-length' | 'competitive-support'
  | 'minor-game-public-fit' | 'long-minor-invitation' | 'opening-minor-shape' | 'weak-two-quality'
  | 'natural-overcall-resources' | 'natural-response-resources' | 'artificial-inquiry-resources';
export interface BiddingConsistencyDecision {
  call: Call;
  family: ConsistencyFamily;
  source: 'existing-rule' | 'unresolved';
  rejectedReasons: string[];
  ruleRejectedReasons: string[];
}

/** Undefined means outside the explicit repair families (including unknown).
 * A known violation without a qualified existing-rule replacement is returned
 * as unresolved, with the original call preserved for a separate review. */
export function enforceBiddingConsistency(obs: BiddingObservation, selected: Call,
  system: BiddingSystem): BiddingConsistencyDecision | undefined {
  if (system !== 'sayc' && system !== 'two-over-one') return undefined;
  const pending = publicPendingResponse(obs.auction, obs.seat, system);
  const exactPending = pending && ['stayman', 'keycard', 'king', 'quantitative-grand', 'minor-choice'].includes(pending.kind);
  const meaning = publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: selected }], obs.auction.length, system);
  const protocolAssessment = pending && !exactPending
    && (pending.allowedCalls || pending.naturalOnly || pending.allowedRoles)
    ? assessCandidates(obs, system).find(candidate => sameCall(candidate.call, selected)) : undefined;
  const protocolViolations = protocolAssessment && !protocolAssessment.allowed ? protocolAssessment.reasons : [];
  const resourceFamily = meaning.defined && !meaning.artificial
    && (meaning.role === 'natural-overcall' || meaning.role === 'natural-response') ? meaning.role : undefined;
  const resourceViolations = resourceFamily ? assessCandidates(obs, system)
    .find(candidate => sameCall(candidate.call, selected))?.reasons.filter(reason =>
      reason === 'natural-suit-minimum' || reason === 'hcp-minimum') ?? [] : [];
  const inquiryViolations = meaning.defined && meaning.artificial && meaning.intent === 'inquiry'
    && obs.auction.some(entry => entry.call.kind === 'bid')
    ? assessCandidates(obs, system).find(candidate => sameCall(candidate.call, selected))?.reasons.filter(reason =>
      ['hcp-minimum', 'hcp-maximum', 'natural-suit-minimum', 'natural-suit-maximum',
        'strict-nt-shape', 'allowed-shape-family', 'support-point-range', 'joint-support-minimum'].includes(reason)) ?? [] : [];
  const cueAssessment = pending?.kind === 'cue-response' ? protocolAssessment : undefined;
  const cueViolations = cueAssessment?.reasons.filter(reason =>
    reason === 'pending-cue-response' || reason === 'unfulfilled-forcing-obligation') ?? [];
  // A recognized pending protocol is known even when the attempted answer
  // is correctly labelled unknown for failing that very protocol.
  if (!exactPending && !protocolViolations.length && (!meaning.defined || meaning.role.startsWith('unmapped'))) return undefined;
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const opening = obs.auction.every(entry => entry.call.kind === 'pass');
  let family: ConsistencyFamily | undefined;
  let rejectedReasons: string[] = [];
  let rule: Call | undefined;
  if (cueViolations.length) {
    // A cue permits different natural answers. Repair only an unfulfilled
    // public obligation; do not replace an already qualified 2D/2H answer
    // merely because the existing rule would select another natural call.
    family = 'pending-cue-answer';
    rejectedReasons = cueViolations;
  } else if (protocolViolations.length) {
    // The existing public response contract may permit several answers or
    // even Pass. Keep every qualified choice; only a rejected candidate asks
    // the existing rule for a fully qualified replacement, including when
    // the attempted answer is correctly described as unknown.
    family = 'pending-protocol-answer';
    rejectedReasons = protocolViolations;
  } else if (resourceFamily && resourceViolations.length) {
    // Keep the existing hand/playing-source qualifications authoritative.
    // An already qualified distributional exception never enters this repair.
    family = resourceFamily === 'natural-overcall' ? 'natural-overcall-resources' : 'natural-response-resources';
    rejectedReasons = resourceViolations;
  } else if (inquiryViolations.length) {
    // Defined artificial questions have their own published resources. Keep
    // qualified low-point relays intact and leave opening styles outside this
    // continuation-only repair; no new strength or shape threshold is added.
    family = 'artificial-inquiry-resources';
    rejectedReasons = inquiryViolations;
  } else if (exactPending) {
    rule = chooseBid(obs, system);
    if (sameCall(rule, selected)) return undefined;
    family = 'pending-exact-answer';
    rejectedReasons = ['existing-' + pending.kind + '-answer'];
  } else if (selected.kind === 'bid') {
    const suit = selected.strain;
    const short = suit !== 'NT' && lengths[suit] < (meaning.suitMinimums[suit] ?? 0);
    // Preserve long distributional strong openings for the separately
    // deferred style review; only ordinary balanced / <=5-card resources.
    if (publicOpeningFourNTAt([...obs.auction, { seat: obs.seat, call: selected }], obs.auction.length, system)
      && (lengths.C < 5 || lengths.D < 5)) {
      family = 'opening-minor-shape'; rejectedReasons = ['opening-four-nt-requires-both-minors-five'];
    } else if (opening && meaning.role === 'strong-opening' && selected.level === 2 && suit === 'C'
      && (balanced || Math.max(...Object.values(lengths)) <= 5)
      && hcp < (meaning.hcpRange?.min ?? 0)) {
      family = 'strong-opening-resources'; rejectedReasons = ['hcp-minimum'];
    } else if (opening && meaning.role === 'natural-opening' && selected.level === 3
      && (suit === 'H' || suit === 'S') && short) {
      family = 'three-level-major-length'; rejectedReasons = ['natural-suit-minimum'];
    } else if (opening && meaning.role === 'natural-opening' && selected.level === 2
      && (suit === 'D' || suit === 'H' || suit === 'S') && !short
      && assessCandidates(obs, system).find(candidate => sameCall(candidate.call, selected))
        ?.reasons.includes('weak-two-suit-quality')) {
      family = 'weak-two-quality'; rejectedReasons = ['weak-two-suit-quality'];
    } else if (meaning.role === 'natural-second-suit' && !meaning.artificial && short) {
      family = 'natural-second-suit-length'; rejectedReasons = ['natural-suit-minimum'];
    } else if (meaning.role === 'competitive-support' && !meaning.artificial) {
      const partner = publicPlayerConstraints(obs.auction, partnerOf(obs.seat), system);
      const fit = suit !== 'NT' ? evaluateSuitFit(obs.hand, suit, partner.suitMinimums[suit]) : undefined;
      if (short) rejectedReasons.push('natural-suit-minimum');
      if (fit && meaning.supportRange && fit.totalPoints < meaning.supportRange.min)
        rejectedReasons.push('support-point-range');
      if (fit && suit !== 'NT' && meaning.jointSupportFloor
        && fit.totalPoints + publicSupportMinimum(suit, lengths[suit], partner) < meaning.jointSupportFloor.total)
        rejectedReasons.push('joint-support-minimum');
      if (rejectedReasons.length) family = 'competitive-support';
    } else if (meaning.role === 'natural-support' && !meaning.artificial && selected.level === 5
      && (suit === 'C' || suit === 'D')) {
      const partner = publicPlayerConstraints(obs.auction, partnerOf(obs.seat), system);
      if (lengths[suit] + partner.suitMinimums[suit] < 8) {
        family = 'minor-game-public-fit'; rejectedReasons = ['minor-game-without-public-fit'];
      }
    } else if (meaning.role === 'long-minor-invitation' && !meaning.artificial) {
      if (short) rejectedReasons.push('natural-suit-minimum');
      if (hcp < (meaning.hcpRange?.min ?? 0)) rejectedReasons.push('hcp-minimum');
      if (hcp > (meaning.hcpRange?.max ?? 40)) rejectedReasons.push('hcp-maximum');
      if (rejectedReasons.length) family = 'long-minor-invitation';
    }
  }
  if (!family) return undefined;
  rule ??= chooseBid(obs, system);
  const qualified = assessCandidates(obs, system).find(candidate => sameCall(candidate.call, rule));
  const ruleRejectedReasons = qualified?.reasons ?? ['illegal-existing-rule-call'];
  // Pass is a valid existing-rule replacement only when the same public
  // qualification permits it. Pending answers, game forces and established
  // public game values still reject Pass through assessCandidates above.
  if (sameCall(rule, selected) || !qualified?.allowed) return {
    call: selected, family, source: 'unresolved', rejectedReasons,
    ruleRejectedReasons: sameCall(rule, selected) ? [...ruleRejectedReasons, 'existing-rule-keeps-selected'] : ruleRejectedReasons,
  };
  return { call: rule, family, source: 'existing-rule', rejectedReasons, ruleRejectedReasons: [] };
}
