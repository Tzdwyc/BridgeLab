import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bidding from '../src/ai/bidding';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { assessCandidates } from '../src/ai/constrained-sl';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { suggestSLBid, type SLBidTrace } from '../src/ai/neural/browser-model';
import { legalCalls, sameCall } from '../src/core/auction';
import type { BiddingObservation } from '../src/ai/observation';
import type { Call, Seat, Strain, Suit } from '../src/core/types';
vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
const discovery = 'artifacts/v328-hints-and-cue-20261108/ten-board-discovery';
type Step = { observation: BiddingObservation; action: { call: Call }; qualification: { allowed: boolean; reasons: string[] }; publicMeaning: { role: string }; trace: SLBidTrace };
const first = JSON.parse(readFileSync(`${discovery}/ten-board-01.json`, 'utf8')) as { issues: Step[] };
const qualified = Array.from({ length: 10 }, (_, i) => JSON.parse(readFileSync(`${discovery}/ten-board-${String(i + 1).padStart(2, '0')}.json`, 'utf8')))
  .filter(b => b.input.system !== 'precision').flatMap(b => b.steps.filter((step: Step) => step.qualification?.allowed
    && ['natural-overcall', 'natural-response'].includes(step.publicMeaning?.role)).map((step: Step) => ({ system: b.input.system as 'sayc' | 'two-over-one', step })));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
describe.each(['sayc', 'two-over-one'] as const)('v3.2.8 existing natural-resource qualifications in %s', system => {
  it.each(first.issues)('replaces an archived under-resourced $publicMeaning.role only with a qualified existing rule', step => {
    const obs = step.observation, selected = step.action.call;
    const rule = bidding.chooseBid(obs, system);
    expect(assessCandidates(obs, system).find(c => sameCall(c.call, selected))?.allowed).toBe(false);
    expect(assessCandidates(obs, system).find(c => sameCall(c.call, rule))?.allowed).toBe(true);
    const result = enforceBiddingConsistency(obs, selected, system);
    expect(result).toMatchObject({ call: rule, source: 'existing-rule',
      family: step.publicMeaning.role === 'natural-overcall' ? 'natural-overcall-resources' : 'natural-response-resources', ruleRejectedReasons: [] });
    expect(result?.rejectedReasons).toEqual(step.qualification.reasons);
    expect(enforceBiddingConsistency({ ...obs, board: 999999 }, selected, system)).toEqual(result);
  });
  it.each(first.issues)('keeps explicit unresolved evidence when the rule also fails for $publicMeaning.role', step => {
    vi.spyOn(bidding, 'chooseBid').mockReturnValue(step.action.call);
    const result = enforceBiddingConsistency(step.observation, step.action.call, system);
    expect(result).toMatchObject({ call: step.action.call, source: 'unresolved' });
    expect(result?.ruleRejectedReasons).toContain('existing-rule-keeps-selected');
  });
  it.each(first.issues)('keeps original SL isolated for $publicMeaning.role', async step => {
    const selected = step.action.call;
    vi.mocked(suggestSLBid).mockResolvedValue({ call: selected, trace: { ...step.trace, profileId: 'seed101-epoch08' } });
    const repaired = await suggestSystemBid(step.observation, { system, allowLookahead: false });
    expect(repaired.trace?.route).toBe('agreement-flow');
    expect(assessCandidates(step.observation, system).find(c => sameCall(c.call, repaired.call))?.allowed).toBe(true);
    vi.mocked(suggestSLBid).mockResolvedValue({ call: selected, trace: { ...step.trace, profileId: 'original-sl' } });
    const original = await suggestSystemBid(step.observation, { system, allowLookahead: false });
    expect(original.call).toEqual(selected);
    expect(original.trace?.route).not.toBe('agreement-flow');
  });
});
it.each(qualified)('leaves a saved qualified natural call unchanged ($system)', ({ system, step }) => {
  expect(qualified.length).toBeGreaterThan(0);
  const chooser = vi.spyOn(bidding, 'chooseBid');
  expect(enforceBiddingConsistency(step.observation, step.action.call, system)).toBeUndefined();
  expect(chooser).not.toHaveBeenCalled();
});
function context(prefix: string, holding: string): BiddingObservation {
  const tokens = prefix.split(' '), seats: Seat[] = ['N', 'E', 'S', 'W'], seat = seats[tokens.length % 4];
  const auction = tokens.map((token, i) => ({ seat: seats[i % 4], call: token === 'P' ? { kind: 'pass' as const }
    : { kind: 'bid' as const, level: Number(token[0]), strain: token.slice(1) as Strain } }));
  const hand = holding.split('.').flatMap((cards, i) => [...cards.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2; return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  return { phase: 'auction', board: 1, seat, actingSeat: seat, vulnerability: 'None', hand, auction, legalCalls: legalCalls(auction, seat) };
}
it('preserves the existing bounded low-HCP long-source qualification', () => {
  for (const [prefix, holding, level, strain] of [
    ['P 1H 2D', 'AQJT8762.-.Q8.T32', 2, 'S'], ['2S', '9.2.KQJT9876.J32', 3, 'D'],
  ] as const) {
    const obs = context(prefix, holding), selected: Call = { kind: 'bid', level, strain };
    expect(assessCandidates(obs, 'sayc').find(c => sameCall(c.call, selected))?.allowed).toBe(true);
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, selected, 'sayc')).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled(); vi.restoreAllMocks();
  }
});
it('leaves the deferred third-seat five-card weak-two style outside this addition', () => {
  const obs = context('P P', 'AQ52.KT984.J42.T'), selected: Call = { kind: 'bid', level: 2, strain: 'H' };
  expect(enforceBiddingConsistency(obs, selected, 'sayc')).toBeUndefined();
});
