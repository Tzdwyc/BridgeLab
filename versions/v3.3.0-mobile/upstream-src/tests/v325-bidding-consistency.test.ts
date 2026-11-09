import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { chooseBid } from '../src/ai/bidding';
import * as bidding from '../src/ai/bidding';
import { publicCallMeaningAt, publicPendingResponse } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { assessCandidates } from '../src/ai/constrained-sl';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { suggestSLBid, type SLBidTrace } from '../src/ai/neural/browser-model';
import { callToAction } from '../src/ai/neural';
import type { BiddingObservation } from '../src/ai/observation';
import type { BiddingSystem } from '../src/ai/systems';
import type { Call } from '../src/core/types';

vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
type SavedRow = { pointId: string; system: BiddingSystem; observation: BiddingObservation; call: Call; trace: SLBidTrace };
const evidence = JSON.parse(readFileSync('artifacts/v324-three-system-notes-20261108/natural-two-over-one-actual-001.json', 'utf8')) as { rows: SavedRow[] };
const groups = JSON.parse(readFileSync('artifacts/v324-deviation-analysis-20261108/ASSESSMENT_INDEX.json', 'utf8')).groups as Record<string, string[]>;
const targetIds = [...groups['优先审查选叫及既有问答执行'], 'B1-dev-long-0062-P1'];
const saved = (id: string, system: BiddingSystem = 'sayc') => evidence.rows.find(row => row.pointId === id && row.system === system)!;
const name = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind;
beforeEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('v3.2.6 existing agreement execution (saved observations, zero neural forwards)', () => {
  it('repairs only the approved target families using the current existing rule or explicitly retains unresolved', () => {
    const rows = targetIds.flatMap(id => (['sayc', 'two-over-one'] as const).map(system => {
      const row = saved(id, system), decision = enforceBiddingConsistency(row.observation, row.call, system);
      expect(decision, id + ':' + system).toBeDefined();
      expect(decision?.source).toMatch(/existing-rule|unresolved/);
      if (decision?.source === 'existing-rule') expect(decision.call).toEqual(chooseBid(row.observation, system));
      if (decision?.source === 'unresolved') expect(decision.call).toEqual(row.call);
      return { pointId: id, system, before: name(row.call), after: name(decision?.call ?? row.call), ...decision };
    }));
    mkdirSync('artifacts/v326-three-flows-20261108/consistency', { recursive: true });
    writeFileSync('artifacts/v326-three-flows-20261108/consistency/rule-entry-probe.json', JSON.stringify({
      scope: '18 approved positions, two systems; existing rules only; no neural forwards, training, play or DDS', rows,
    }, null, 2));
  });

  it('keeps deferred style boundaries while correcting the existing explicit resource violation', () => {
    const controls = [...groups['先评估叫牌风格边界'], ...groups['实际叫品暂时保留']];
    for (const id of controls) for (const system of ['sayc', 'two-over-one'] as const) {
      const row = saved(id, system), decision = enforceBiddingConsistency(row.observation, row.call, system);
      if (id === 'B1-dev-competition-0024-P2') {
        expect(decision).toMatchObject({ family: 'natural-overcall-resources', source: 'existing-rule', call: { kind: 'pass' } });
        expect(decision?.rejectedReasons).toContain('hcp-minimum');
        expect(decision?.ruleRejectedReasons).toEqual([]);
      } else expect(decision, id + ':' + system).toBeUndefined();
    }
  });

  it('uses the eight existing exact inquiry answers rather than unagreed contract calls', () => {
    const exact: Record<string, string> = {
      'B1-dev-long-0002-P1': '2H', 'B1-dev-long-0051-P1': '2H',
      'B1-dev-long-0018-P1': '5H', 'B1-dev-slam-0046-P1': '5D', 'B1-dev-slam-0050-P1': '5D',
      'B1-dev-slam-0050-P2': '6C', 'B1-dev-long-0046-P2': '6NT', 'B1-dev-long-0049-P2': '6NT',
    };
    for (const [id, expected] of Object.entries(exact)) for (const system of ['sayc', 'two-over-one'] as const) {
      const row = saved(id, system), result = enforceBiddingConsistency(row.observation, row.call, system);
      expect(name(result?.call ?? row.call), id + ':' + system).toBe(expected);
    }
  });

  it('integrates only for the default SL profile and retains its original network provenance', async () => {
    const row = saved('B1-dev-long-0002-P1');
    vi.mocked(suggestSLBid).mockResolvedValue({ call: row.call, trace: row.trace });
    const result = await suggestSystemBid(row.observation, { system: row.system, allowLookahead: false });
    expect(name(result.call)).toBe('2H');
    expect(result.trace).toMatchObject({ profileId: row.trace.profileId, loadedWeightsSHA256: row.trace.loadedWeightsSHA256,
      rawTopAction: row.trace.rawTopAction, baselineCall: row.trace.baselineCall, route: 'agreement-flow',
      action: callToAction(result.call), reason: 'consistency:pending-exact-answer' });
    vi.mocked(suggestSLBid).mockResolvedValue({ call: row.call, trace: { ...row.trace, profileId: 'original-sl' } });
    const original = await suggestSystemBid(row.observation, { system: row.system, allowLookahead: false });
    expect(original.call).toEqual(row.call);
    expect(original.trace?.route).toBe(row.trace.route);
  });

  it('repairs an unknown candidate under a recognized quantitative response contract while retaining non-natural systems', () => {
    const row = saved('B1-dev-long-0021-P1');
    expect(enforceBiddingConsistency(row.observation, row.call, 'natural-lite')).toBeUndefined();
    const quantitative = saved('B1-dev-slam-0014-P1');
    const unknown: Call = { kind: 'bid', level: 5, strain: 'C' };
    expect(publicCallMeaningAt([...quantitative.observation.auction,
      { seat: quantitative.observation.seat, call: unknown }], quantitative.observation.auction.length, quantitative.system).defined).toBe(false);
    expect(publicPendingResponse(quantitative.observation.auction, quantitative.observation.seat, quantitative.system)?.kind).toBe('quantitative-small');
    const result = enforceBiddingConsistency(quantitative.observation, unknown, quantitative.system);
    expect(result).toMatchObject({ family: 'pending-protocol-answer', source: 'existing-rule', ruleRejectedReasons: [] });
    expect(result?.call).toEqual(chooseBid(quantitative.observation, quantitative.system));
    expect(assessCandidates(quantitative.observation, quantitative.system).find(candidate =>
      JSON.stringify(candidate.call) === JSON.stringify(result?.call))?.allowed).toBe(true);
  });

  it('retains a genuinely unmapped continuation when no recognized response contract is pending', () => {
    const savedRow = saved('B1-dev-slam-0014-P1');
    const auction: BiddingObservation['auction'] = [
      { seat: 'N', call: { kind: 'bid', level: 1, strain: 'NT' } }, { seat: 'E', call: { kind: 'pass' } },
      { seat: 'S', call: { kind: 'bid', level: 2, strain: 'C' } }, { seat: 'W', call: { kind: 'pass' } },
      { seat: 'N', call: { kind: 'bid', level: 2, strain: 'D' } }, { seat: 'E', call: { kind: 'pass' } },
    ];
    const obs: BiddingObservation = { ...savedRow.observation, seat: 'S', actingSeat: 'S', auction, legalCalls: legalCalls(auction, 'S') };
    const unknown: Call = { kind: 'bid', level: 2, strain: 'H' };
    expect(publicPendingResponse(auction, 'S', savedRow.system)).toBeUndefined();
    expect(publicCallMeaningAt([...auction, { seat: 'S', call: unknown }], auction.length, savedRow.system))
      .toMatchObject({ defined: false, role: 'unmapped-stayman-major' });
    const chooser = vi.spyOn(bidding, 'chooseBid');
    expect(enforceBiddingConsistency(obs, unknown, savedRow.system)).toBeUndefined();
    expect(chooser).not.toHaveBeenCalled();
  });

  it('preserves a known violation with explicit unresolved evidence when its existing rule cannot replace it', () => {
    const row = saved('B1-dev-long-0021-P1');
    vi.spyOn(bidding, 'chooseBid').mockReturnValue(row.call);
    const result = enforceBiddingConsistency(row.observation, row.call, row.system);
    expect(result).toMatchObject({ call: row.call, family: 'natural-second-suit-length', source: 'unresolved' });
    expect(result?.ruleRejectedReasons).toContain('existing-rule-keeps-selected');
    expect(result?.rejectedReasons).toContain('natural-suit-minimum');
  });

  it('answers the approved natural second-suit obligation through the existing real six-card minor', () => {
    const row = saved('B1-dev-long-0040-P1', 'two-over-one');
    expect(chooseBid(row.observation, row.system)).toEqual({ kind: 'bid', level: 3, strain: 'C' });
    const result = enforceBiddingConsistency(row.observation, row.call, row.system);
    expect(result).toMatchObject({ call: { kind: 'bid', level: 3, strain: 'C' },
      source: 'existing-rule', family: 'natural-second-suit-length' });
    expect(result?.ruleRejectedReasons).toEqual([]);
  });
});
