import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bidding from '../src/ai/bidding';
import { assessCandidates } from '../src/ai/constrained-sl';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { suggestSLBid, type SLBidTrace } from '../src/ai/neural/browser-model';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { sameCall } from '../src/core/auction';
import type { BiddingObservation } from '../src/ai/observation';
import type { Call } from '../src/core/types';
const evidence = JSON.parse(readFileSync('artifacts/v328-hints-and-cue-20261108/ten-board-final-interrupted-01/ten-board-01.json', 'utf8'));
const frozen = evidence.issues.find((row: any) => row.publicMeaning.role === 'stayman');
const obs = frozen.observation as BiddingObservation, selected = frozen.action.call as Call;
vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
describe.each(['sayc', 'two-over-one'] as const)('v3.2.8 existing inquiry rule qualification in %s', system => {
  it('has a qualified existing replacement for the frozen five-point Stayman', () => {
    const rule = bidding.chooseBid(obs, system), assessed = assessCandidates(obs, system).find(item => sameCall(item.call, rule));
    console.log('FROZEN_INQUIRY_EXISTING_RULE', system, JSON.stringify({ rule, allowed: assessed?.allowed, reasons: assessed?.reasons }));
    expect(assessCandidates(obs, system).find(item => sameCall(item.call, selected))?.reasons).toContain('hcp-minimum');
    expect(assessed?.allowed).toBe(true);
    expect(enforceBiddingConsistency(obs, selected, system)).toMatchObject({ call: rule,
      family: 'artificial-inquiry-resources', source: 'existing-rule', rejectedReasons: ['hcp-minimum'], ruleRejectedReasons: [] });
  });
  it('keeps normal eight-point Stayman as its qualified existing inquiry', () => {
    // Existing asking hand, used only to vary the known resource boundary.
    const hand = 'K975.A984.95.J85'.split('.').flatMap((cards, i) => [...cards].map(symbol => {
      const suit = (['S', 'H', 'D', 'C'] as const)[i], rank = '23456789TJQKA'.indexOf(symbol) + 2; return { suit, rank, id: `${suit}${rank}` };
    }));
    const normal = { ...obs, hand };
    expect(assessCandidates(normal, system).find(c => sameCall(c.call, selected))?.allowed).toBe(true);
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(normal, selected, system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });
  it('preserves the qualified five-point weak-minor relay without consulting a replacement', () => {
    const relay: Call = { kind: 'bid', level: 2, strain: 'S' };
    const meaning = publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: relay }], obs.auction.length, system);
    expect(meaning.role).toBe('weak-minor-relay');
    expect(assessCandidates(obs, system).find(c => sameCall(c.call, relay))?.allowed).toBe(true);
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, relay, system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });
  it('retains explicit unresolved evidence when the existing rule keeps the underfunded inquiry', () => {
    vi.spyOn(bidding, 'chooseBid').mockReturnValue(selected);
    expect(enforceBiddingConsistency(obs, selected, system)).toMatchObject({ call: selected, family: 'artificial-inquiry-resources', source: 'unresolved' });
  });
  it('also repairs an existing five-heart transfer inquiry when its declared target suit is too short', () => {
    const transfer: Call = { kind: 'bid', level: 2, strain: 'D' };
    expect(assessCandidates(obs, system).find(c => sameCall(c.call, transfer))?.reasons).toContain('natural-suit-minimum');
    const result = enforceBiddingConsistency(obs, transfer, system);
    expect(result).toMatchObject({ family: 'artificial-inquiry-resources', source: 'existing-rule', ruleRejectedReasons: [] });
    expect(assessCandidates(obs, system).find(c => sameCall(c.call, result!.call))?.allowed).toBe(true);
  });
  it('repairs the default profile while leaving original SL isolated', async () => {
    const trace = frozen.trace as SLBidTrace;
    vi.mocked(suggestSLBid).mockResolvedValue({ call: selected, trace: { ...trace, profileId: 'seed101-epoch08' } });
    const repaired = await suggestSystemBid(obs, { system, allowLookahead: false });
    expect(repaired.trace?.reason).toBe('consistency:artificial-inquiry-resources');
    expect(assessCandidates(obs, system).find(c => sameCall(c.call, repaired.call))?.allowed).toBe(true);
    vi.mocked(suggestSLBid).mockResolvedValue({ call: selected, trace: { ...trace, profileId: 'original-sl' } });
    const original = await suggestSystemBid(obs, { system, allowLookahead: false });
    expect(original.call).toEqual(selected);
    expect(original.trace?.route).not.toBe('agreement-flow');
  });
});
