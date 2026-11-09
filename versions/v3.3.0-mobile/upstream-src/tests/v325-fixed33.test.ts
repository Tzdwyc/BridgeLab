/** Fixed historical observations only. Opt in after the implementation is frozen.
 * V325_FIXED33_RUN=1 npx vitest run tests/v325-fixed33.test.ts
 * A completed evidence file is never overwritten by this harness.
 */
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyAction, assertGameIntegrity, newGameFromDeal, replay, toRecord } from '../src/core/game';
import { deck } from '../src/core/deal';
import { sameCall } from '../src/core/auction';
import { SEATS, SUITS, type Call, type Hands } from '../src/core/types';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { agreementVersionFor } from '../src/ai/bid-strategy';
import { assessCandidates } from '../src/ai/constrained-sl';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { presentCall } from '../src/ai/bidding-presentation';
import { getSLModelState, setLookaheadEnabled, setSLProfile, SL_PROFILES } from '../src/ai/neural/browser-model';
import { robotStepWithAdvisor } from '../src/controller/robot';

type NaturalSystem = 'sayc' | 'two-over-one';
interface OldRow {
  pointId: string; system: NaturalSystem; observation: BiddingObservation;
  call: Call; callName: string; text: string; meaning: unknown;
  trace: { route: string }; mechanicalCurrentPromiseChecks: unknown; mechanicalPriorPromiseChecks: unknown;
}
const directory = process.env.V325_FIXED33_OUTPUT ?? 'artifacts/v325-consistency-20261108';
const output = `${directory}/fixed33-actual-table.json`;
const inputs = [
  'artifacts/v324-deviation-analysis-20261108/ASSESSMENT_INDEX.json',
  'artifacts/v324-three-system-notes-20261108/natural-two-over-one-actual-001.json',
  'artifacts/v324-deviation-analysis-20261108/facts-and-readonly-verification.json',
];
const evidenceHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const name = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'Pass' : call.kind === 'double' ? 'X' : 'XX';

/** Opponents/partner are deterministic engine padding, never original mother hands.
 * The production observe() boundary is checked byte-for-byte before querying.
 */
function gameAt(row: OldRow) {
  const obs = row.observation;
  const hands = Object.fromEntries(SEATS.map(seat => [seat, []])) as unknown as Hands;
  hands[obs.seat] = structuredClone(obs.hand);
  const ownIds = new Set(obs.hand.map(card => card.id));
  const padding = deck().filter(card => !ownIds.has(card.id));
  for (const seat of SEATS) if (seat !== obs.seat) hands[seat] = padding.splice(0, 13);
  let game = newGameFromDeal(obs.board, `v325-fixed-context/${row.pointId}`, hands,
    obs.auction[0]?.seat ?? obs.seat, obs.vulnerability);
  game = { ...game, biddingSystem: row.system, agreementVersion: agreementVersionFor(row.system) };
  for (const entry of obs.auction) game = applyAction(game, { kind: 'call', seat: entry.seat, call: entry.call });
  assertGameIntegrity(game);
  expect(observe(game)).toEqual(obs);
  return game;
}

function mechanicalPromises(obs: BiddingObservation, call: Call, system: NaturalSystem) {
  const meaning = publicCallMeaningAt([...obs.auction, { seat: obs.seat, call }], obs.auction.length, system);
  const ownPrior = publicPlayerConstraints(obs.auction, obs.seat, system);
  const hcp = obs.hand.reduce((n, c) => n + Math.max(0, c.rank - 10), 0);
  const shape = Object.fromEntries(SUITS.map(suit => [suit, obs.hand.filter(c => c.suit === suit).length])) as Record<typeof SUITS[number], number>;
  const checks = (constraints: { hcpRange?: { min: number; max: number }; suitMinimums: Partial<typeof shape>; suitMaximums?: Partial<typeof shape> }) => ({
    hcpOutsideRange: !!constraints.hcpRange && (hcp < constraints.hcpRange.min || hcp > constraints.hcpRange.max),
    minimumViolations: SUITS.filter(suit => shape[suit] < (constraints.suitMinimums[suit] ?? 0)).map(suit => ({ suit, actual: shape[suit], minimum: constraints.suitMinimums[suit] })),
    maximumViolations: SUITS.filter(suit => shape[suit] > (constraints.suitMaximums?.[suit] ?? 13)).map(suit => ({ suit, actual: shape[suit], maximum: constraints.suitMaximums?.[suit] })),
  });
  return { actualHcp: hcp, actualShape: shape, priorForcing: analyzeAuctionSemantics(obs.auction, obs.seat, system),
    current: checks(meaning), prior: checks(ownPrior), ownPrior };
}

it.skipIf(process.env.V325_FIXED33_RUN !== '1')('records exactly 33 fixed contexts in both systems through the real table controller', async () => {
  if (existsSync(output)) throw Error(`Evidence already exists; preserve it and do not repeat the valid fixed-33 query: ${output}`);
  const inputHashes = Object.fromEntries(inputs.map(path => [path, evidenceHash(path)]));
  const frozenDecisionSources = ['src/ai/bidding-semantics.ts', 'src/ai/bidding-consistency.ts', 'src/ai/bid-strategy.ts', 'src/ai/constrained-sl.ts', 'src/ai/neural/browser-model.ts'];
  const decisionSourceHashes = Object.fromEntries(frozenDecisionSources.map(path => [path, evidenceHash(path)]));
  const assessment = JSON.parse(readFileSync(inputs[0], 'utf8')) as { groups: Record<string, string[]> };
  const old = JSON.parse(readFileSync(inputs[1], 'utf8')) as { rows: OldRow[] };
  const facts = JSON.parse(readFileSync(inputs[2], 'utf8')) as { rows: { pointId: string; originalSL: string; oldAcceptableCalls: string[] }[] };
  const groupEntries = Object.entries(assessment.groups);
  const fixedIds = groupEntries.flatMap(([, ids]) => ids);
  const protectedIds = new Set(groupEntries.slice(2).flatMap(([, ids]) => ids));
  expect(fixedIds).toHaveLength(33);
  expect(new Set(fixedIds).size).toBe(33);
  expect(protectedIds.size).toBe(9);
  const rows = fixedIds.flatMap(pointId => (['sayc', 'two-over-one'] as const).map(system => {
    const found = old.rows.filter(row => row.pointId === pointId && row.system === system);
    expect(found, `${pointId}/${system}: old evidence must be unique`).toHaveLength(1);
    return found[0];
  }));
  const results: Record<string, unknown>[] = [];
  const rollbackResults: Record<string, unknown>[] = [];
  const validationFailures: string[] = [];
  let fatalError: string | null = null;
  let primaryQueryAttempts = 0;
  let rollbackQueryAttempts = 0;
  const storage = new Map<string, string>();
  const advisor = { advise: vi.fn(async () => { throw Error('No play, DDS, continuation, or scoring permitted'); }) };
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost/').pathname;
    return new Response(new Uint8Array(readFileSync(new URL('../public' + path, import.meta.url))));
  });
  setLookaheadEnabled(false);
  try {
    await setSLProfile('seed101-epoch08');
    expect(getSLModelState().loadedWeightsSHA256).toBe(SL_PROFILES['seed101-epoch08'].weightsSHA256);
    for (const row of rows) {
      const before = gameAt(row);
      // Exactly one selector invocation per old row. Everything below is pure
      // public-meaning/own-hand diagnosis or actual engine replay.
      primaryQueryAttempts++;
      const step = await robotStepWithAdvisor(before, row.system, 'basic', advisor, false);
      const action = step.game.actions.at(-1)!;
      const entry = step.game.auction.at(-1)!;
      const actual = entry.call;
      const trace = structuredClone(getSLModelState().lastBid);
      assertGameIntegrity(step.game);
      expect(step.warning).toBeNull();
      expect(step.game.actions).toHaveLength(before.actions.length + 1);
      expect(step.game.auction).toHaveLength(before.auction.length + 1);
      expect(action.kind).toBe('call');
      expect(entry.seat).toBe(before.turn);
      expect(replay(toRecord(step.game)).auction).toEqual(step.game.auction);
      const meaning = publicCallMeaningAt(step.game.auction, before.auction.length, row.system);
      const shortnotes = presentCall(before.auction, before.turn, actual, row.system);
      const candidates = assessCandidates(row.observation, row.system);
      const guardDecisionForOldSelectedCall = enforceBiddingConsistency(row.observation, row.call, row.system);
      const qualification = candidates.find(candidate => sameCall(candidate.call, actual));
      const checks = mechanicalPromises(row.observation, actual, row.system);
      const isProtected = protectedIds.has(row.pointId);
      const callUnchanged = JSON.stringify(actual) === JSON.stringify(row.call);
      const unresolvedReasons: string[] = [];
      if (guardDecisionForOldSelectedCall?.source === 'unresolved') unresolvedReasons.push(
        `Approved consistency guard unresolved: ${guardDecisionForOldSelectedCall.family}; replacement rejected: ${guardDecisionForOldSelectedCall.ruleRejectedReasons.join(', ')}`);
      if (!meaning.defined) unresolvedReasons.push('Public meaning remains undefined; protocol decision is unresolved');
      if (!qualification?.allowed) unresolvedReasons.push(...(qualification?.reasons ?? ['Actual call absent from qualification candidates']));
      if (/NaN|undefined|Infinity/.test(shortnotes)) unresolvedReasons.push('Shortnotes contain a nonfinite or undefined value');
      if (checks.prior.hcpOutsideRange || checks.prior.minimumViolations.length || checks.prior.maximumViolations.length)
        unresolvedReasons.push('Frozen prior auction already conflicts with own hand; this query does not repair history');
      if (isProtected) unresolvedReasons.push('Style/retained-call boundary intentionally preserved; no claim of universal qualification');
      if (isProtected && !callUnchanged) validationFailures.push(`${row.pointId}/${row.system}: protected old call changed`);
      if (trace?.loadedWeightsSHA256 !== SL_PROFILES['seed101-epoch08'].weightsSHA256) validationFailures.push(`${row.pointId}/${row.system}: wrong weights`);
      const fact = facts.rows.find(item => item.pointId === row.pointId);
      results.push({ pointId: row.pointId, system: row.system, group: groupEntries.find(([, ids]) => ids.includes(row.pointId))?.[0],
        agreementVersion: before.agreementVersion, frozenObservation: row.observation,
        oldCall: row.call, oldCallName: row.callName, originalSLFrozenCall: fact?.originalSL, oldAcceptableCalls: fact?.oldAcceptableCalls,
        newCall: actual, newCallName: name(actual), callUnchanged, protectedStyleOrRetainedCall: isProtected,
        oldShortnotes: row.text, shortnotes, oldPublicMeaning: row.meaning, publicMeaning: meaning,
        oldMechanicalCurrentPromiseChecks: row.mechanicalCurrentPromiseChecks, oldMechanicalPriorPromiseChecks: row.mechanicalPriorPromiseChecks,
        currentOwnHandAndPublicChecks: checks, qualification, candidateAssessments: candidates, guardDecisionForOldSelectedCall,
        route: trace?.route, trace, actualApplyActionAccepted: true, action,
        engineIntegrityPassed: true, engineReplayPassed: true, warning: step.warning,
        status: unresolvedReasons.length ? 'unresolved-or-intentionally-retained' : 'no-local-qualification-failure',
        unresolvedReasons, record: toRecord(step.game),
      });
    }
    // The same nine protected contexts also exercise the explicit original-SL
    // switch. The expected calls are preexisting frozen original-model outputs,
    // never trace.baselineCall or a newly generated reference.
    await setSLProfile('original-sl');
    expect(getSLModelState().loadedWeightsSHA256).toBe(SL_PROFILES['original-sl'].weightsSHA256);
    for (const row of rows.filter(item => protectedIds.has(item.pointId))) {
      const before = gameAt(row);
      rollbackQueryAttempts++;
      const step = await robotStepWithAdvisor(before, row.system, 'basic', advisor, false);
      const actual = step.game.auction.at(-1)!.call;
      const trace = structuredClone(getSLModelState().lastBid);
      const fact = facts.rows.find(item => item.pointId === row.pointId)!;
      assertGameIntegrity(step.game);
      expect(step.warning).toBeNull();
      expect(step.game.actions).toHaveLength(before.actions.length + 1);
      expect(replay(toRecord(step.game)).auction).toEqual(step.game.auction);
      const frozenOriginalCallPreserved = name(actual) === fact.originalSL;
      if (!frozenOriginalCallPreserved) validationFailures.push(`${row.pointId}/${row.system}: original-SL frozen call changed`);
      if (trace?.profileId !== 'original-sl' || trace.loadedWeightsSHA256 !== SL_PROFILES['original-sl'].weightsSHA256)
        validationFailures.push(`${row.pointId}/${row.system}: rollback did not load original-SL`);
      if (trace?.route !== 'sl-legal') validationFailures.push(`${row.pointId}/${row.system}: new layer interfered with original-SL route`);
      rollbackResults.push({ pointId: row.pointId, system: row.system, expectedOriginalSLFrozenCall: fact.originalSL,
        actual, actualCallName: name(actual), frozenOriginalCallPreserved, trace,
        actualApplyActionAccepted: true, engineIntegrityPassed: true, engineReplayPassed: true,
        action: step.game.actions.at(-1), record: toRecord(step.game) });
    }
    await setSLProfile('seed101-epoch08');
    expect(advisor.advise).not.toHaveBeenCalled();
  } catch (error) {
    fatalError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    vi.unstubAllGlobals();
    const inputsPreserved = inputs.every(path => evidenceHash(path) === inputHashes[path]);
    const decisionSourcesPreserved = frozenDecisionSources.every(path => evidenceHash(path) === decisionSourceHashes[path]);
    if (!inputsPreserved) validationFailures.push('Frozen old evidence changed during verification');
    if (!decisionSourcesPreserved) validationFailures.push('Frozen decision source changed during verification');
    mkdirSync(directory, { recursive: true });
    writeFileSync(output, JSON.stringify({ schema: 'v325-fixed33-actual-controller-v1',
      scope: 'One historical decision per context/system; mechanical qualification is not a contract-quality oracle',
      completedAt: new Date().toISOString(), validExecution: !fatalError && results.length === 66 && rollbackResults.length === 18 && !validationFailures.length,
      fixedContexts: fixedIds.length, motherDeals: new Set(rows.map(row => row.observation.board)).size,
      expectedActualSingleBidQueries: 66, actualSingleBidQueryAttempts: primaryQueryAttempts, actualSingleBidQueriesCompleted: results.length,
      systems: ['sayc', 'two-over-one'], modelProfile: 'seed101-epoch08', inputHashes, inputsPreserved, decisionSourceHashes, decisionSourcesPreserved,
      paddingHiddenCardsPurpose: 'Engine integrity only; production observe() equals the exact frozen old observation before every query',
      newMotherDeals: 0, training: 0, continuations: 0, playAdvisorCalls: advisor.advise.mock.calls.length, ddsCalls: 0, scores: 0,
      protectedCallRows: results.filter(row => row.protectedStyleOrRetainedCall).length,
      changedCallRows: results.filter(row => !row.callUnchanged).length,
      unresolvedOrRetainedRows: results.filter(row => row.status === 'unresolved-or-intentionally-retained').length,
      originalSLRollback: { expectedQueries: 18, attemptedQueries: rollbackQueryAttempts, completedQueries: rollbackResults.length,
        basis: 'Frozen original-SL calls from old read-only fact analysis; never trace.baselineCall', rows: rollbackResults },
      fatalError, validationFailures, rows: results,
    }, null, 2));
  }
  expect(fatalError).toBeNull();
  expect(results).toHaveLength(66);
  expect(rollbackResults).toHaveLength(18);
  expect(validationFailures).toEqual([]);
}, 120_000);
