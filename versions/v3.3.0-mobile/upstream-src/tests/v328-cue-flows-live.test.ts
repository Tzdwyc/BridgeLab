/** One frozen-source integration run; append-only evidence, no whole-board rollout.
 * V328_CUE_FLOWS_RUN=1 npx vitest run tests/v328-cue-flows-live.test.ts
 */
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { legalCalls, sameCall } from '../src/core/auction';
import { deck } from '../src/core/deal';
import { applyAction, assertGameIntegrity, newGameFromDeal, replay, toRecord } from '../src/core/game';
import { SEATS, type Card, type Call, type Hands, type Seat, type Strain } from '../src/core/types';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { agreementVersionFor } from '../src/ai/bid-strategy';
import { assessCandidates } from '../src/ai/constrained-sl';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { presentCall } from '../src/ai/bidding-presentation';
import { decidePrecisionBid } from '../src/ai/precision';
import { getSLModelState, setLookaheadEnabled, setSLProfile, SL_PROFILES } from '../src/ai/neural/browser-model';
import { robotStepWithAdvisor } from '../src/controller/robot';
import { LanRoom } from '../src/online/room';
import { createJoinNonce, LAN_SUPPORTED_AGREEMENTS, type RoomResponse } from '../src/online/protocol';

type System = 'sayc' | 'two-over-one';
interface Fixture { id: string; system: System; observation: BiddingObservation; expected?: string; source: string; boundary?: string; old?: any }
const directory = 'artifacts/v328-hints-and-cue-20261108';
const oldPath = 'artifacts/v326-three-flows-20261108/actual-table-002.json';
const fixedPath = 'artifacts/v325-consistency-20261108/final-release/fixed33-actual-table.json';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const parse = (value: string): Call => value === 'P' || value === 'Pass' ? { kind: 'pass' } : value === 'X' ? { kind: 'double' }
  : value === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: Number(value[0]), strain: value.slice(1) as Strain };
const name = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'Pass' : call.kind === 'double' ? 'X' : 'XX';
function holding(text: string): Card[] {
  return text.split('.').flatMap((cards, i) => [...cards].filter(c => c !== '-').map(c => {
    const suit = (['S', 'H', 'D', 'C'] as const)[i], rank = '23456789TJQKA'.indexOf(c) + 2;
    return { id: `${suit}${rank}`, suit, rank };
  }));
}
function frozen(prefix: string, own: Card[], dealer: Seat = 'N'): BiddingObservation {
  const tokens = prefix.split(' ').filter(Boolean);
  const auction = tokens.map((token, i) => ({ seat: SEATS[(SEATS.indexOf(dealer) + i) % 4], call: parse(token) }));
  const seat = SEATS[(SEATS.indexOf(dealer) + tokens.length) % 4];
  return { board: 1, seat, actingSeat: seat, vulnerability: 'None', auction, hand: own, phase: 'auction', legalCalls: legalCalls(auction, seat) };
}
function gameAt(obs: BiddingObservation, system: System | 'precision', reversePadding = false) {
  expect(obs.hand).toHaveLength(13); expect(new Set(obs.hand.map(c => c.id)).size).toBe(13);
  const hands = Object.fromEntries(SEATS.map(seat => [seat, []])) as unknown as Hands;
  hands[obs.seat] = structuredClone(obs.hand);
  const ownIds = new Set(obs.hand.map(c => c.id)), padding = deck().filter(c => !ownIds.has(c.id));
  if (reversePadding) padding.reverse();
  for (const seat of SEATS) if (seat !== obs.seat) hands[seat] = padding.splice(0, 13);
  let game = newGameFromDeal(obs.board, 'v328-existing-context-engine-padding', hands, obs.auction[0]?.seat ?? obs.seat, obs.vulnerability);
  game = { ...game, biddingSystem: system, agreementVersion: agreementVersionFor(system) };
  for (const entry of obs.auction) game = applyAction(game, { kind: 'call', ...entry });
  assertGameIntegrity(game); expect(observe(game)).toEqual(obs);
  return game;
}

it.skipIf(process.env.V328_CUE_FLOWS_RUN !== '1')('verifies prior fixes and pending cue execution through actual controller and room poll', async () => {
  const output = process.env.V328_CUE_FLOWS_OUTPUT ?? `${directory}/cue-actual-table-001.json`;
  if (existsSync(output)) throw Error(`Preserve completed evidence: ${output}`);
  const previous = JSON.parse(readFileSync(oldPath, 'utf8')), fixed = JSON.parse(readFileSync(fixedPath, 'utf8'));
  const inputs = [oldPath, fixedPath], inputHashes = Object.fromEntries(inputs.map(path => [path, hash(path)]));
  const sourcePaths = ['src/ai/bidding-semantics.ts', 'src/ai/bidding-consistency.ts', 'src/ai/approved-bidding-flow.ts', 'src/ai/bidding-presentation.ts', 'src/ai/bidding.ts', 'src/ai/competition.ts', 'src/ai/bid-strategy.ts', 'src/ai/constrained-sl.ts', 'src/ai/lan-bidding.ts', 'src/online/room.ts', 'src/ai/precision.ts'];
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, hash(path)]));
  const storage = new Map<string, string>(), rows: any[] = [], lanRows: any[] = [], controls: any[] = [], failures: string[] = [];
  const advisor = { cancel: vi.fn(), advise: vi.fn(async () => { throw Error('No play or DDS permitted'); }) };
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => new Response(new Uint8Array(readFileSync(new URL('../public' + new URL(String(input), 'http://local/').pathname, import.meta.url)))));
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto);
  const isTarget = (id: string) => ['passed-hand-natural-new-suit-not-F1', 'support-cue-after-X-not-michaels'].includes(id);
  const fixtures: Fixture[] = previous.rows.map((row: any) => ({ id: row.id, system: row.system, observation: row.frozenObservation,
    expected: row.id === 'passed-hand-natural-new-suit-not-F1' ? 'Pass' : row.actualName, old: row, source: oldPath,
    boundary: row.id === 'passed-hand-natural-new-suit-not-F1' ? 'passed-hand' : row.id === 'support-cue-after-X-not-michaels' ? 'enemy-double-cue-answer' : undefined }));
  expect(fixtures).toHaveLength(40); expect(fixtures.filter(f => isTarget(f.id))).toHaveLength(4);
  for (const system of ['sayc', 'two-over-one'] as const) {
    fixtures.push({ id: 'enemy-natural-diamonds-not-our-second-suit', system, source: 'tests/bidding-model-findings.test.ts:79', observation: frozen('1C 1H P 2C 2D', holding('T8.AQJ76.KJ92.64')), expected: '2H', boundary: 'enemy-diamonds' });
    fixtures.push({ id: 'existing-strong-GF-cannot-pass', system, source: 'tests/bidding-model-findings.test.ts:28', observation: frozen('2C P 2D P 3D P 3S P', holding('-.KQ6.AKQJT9.AK32')), boundary: 'game-force' });
  }
  function details(fixture: Fixture, after: ReturnType<typeof gameAt>, route: string) {
    const obs = fixture.observation, actual = after.auction.at(-1)!.call;
    const meaning = publicCallMeaningAt(after.auction, obs.auction.length, fixture.system);
    const qualification = assessCandidates(obs, fixture.system).find(c => sameCall(c.call, actual));
    const stateBefore = analyzeAuctionSemantics(obs.auction, obs.seat, fixture.system), notes = presentCall(obs.auction, obs.seat, actual, fixture.system);
    const violations: string[] = [];
    if (fixture.expected && name(actual) !== fixture.expected) violations.push(`Expected ${fixture.expected}; actual ${name(actual)}`);
    if (!meaning.defined || !qualification?.allowed) violations.push('Actual public meaning or own-hand qualification unresolved');
    if (/NaN|undefined|Infinity/.test(notes)) violations.push('Invalid short explanation');
    if (fixture.boundary === 'passed-hand' && (stateBefore.mustBid || stateBefore.forcing !== 'none')) violations.push('Passed-hand new suit falsely forcing');
    if (fixture.boundary === 'enemy-double-cue-answer') {
      const naturalAnswerMatches = actual.kind === 'bid' && (actual.strain === 'D' && meaning.suitMinimums.D === 4 || actual.strain === 'H' && meaning.suitMinimums.H === 5);
      if (meaning.supportRange || meaning.artificial || meaning.forcing !== 'none' || !naturalAnswerMatches) violations.push('Natural independent answer misdescribed or falsely forcing after answering cue');
    }
    if (fixture.boundary === 'enemy-diamonds') {
      const priorOwnConstraints = publicPlayerConstraints(obs.auction, obs.seat, fixture.system);
      if (priorOwnConstraints.suitMinimums.D !== 0 || actual.kind === 'bid' && actual.strain === 'D') violations.push('Enemy natural diamonds incorrectly reused as our prior natural suit');
    }
    if (fixture.boundary === 'game-force' && (stateBefore.forcing !== 'game' || actual.kind === 'pass')) violations.push('Game force incorrectly permits Pass');
    if (['game-force', 'enemy-double-cue-answer'].includes(fixture.boundary ?? '')) {
      const pass = assessCandidates(obs, fixture.system).find(c => c.call.kind === 'pass');
      if (pass?.allowed) violations.push('Forcing public obligation incorrectly permits Pass');
    }
    failures.push(...violations.map(v => `${fixture.id}/${fixture.system}/${route}: ${v}`));
    return { id: fixture.id, system: fixture.system, group: isTarget(fixture.id) ? 'two-approved-fixes' : fixture.old?.group === 'five-frozen-targets' ? 'prior-five-target-regression' : 'existing-boundary-regression',
      source: fixture.source, frozenObservation: obs, expected: fixture.expected, oldActual: fixture.old?.actual,
      oldQualification: fixture.old?.qualification, actual, actualName: name(actual), publicMeaning: meaning, qualification, stateBefore, notes,
      publicConstraints: publicPlayerConstraints(after.auction, obs.seat, fixture.system), route, violations,
      actualApplyActionAccepted: true, frozenPublicObservationEqual: true, engineIntegrityPassed: true, engineReplayPassed: true, record: toRecord(after) };
  }
  let fatalError: string | null = null;
  try {
    setLookaheadEnabled(false); await setSLProfile('seed101-epoch08');
    for (const fixture of fixtures) {
      const before = gameAt(fixture.observation, fixture.system), step = await robotStepWithAdvisor(before, fixture.system, 'basic', advisor, false);
      assertGameIntegrity(step.game); expect(step.warning).toBeNull(); expect(step.game.actions).toHaveLength(before.actions.length + 1);
      expect(replay(toRecord(step.game)).auction).toEqual(step.game.auction);
      rows.push({ ...details(fixture, step.game, 'robotStepWithAdvisor -> applyAction'), trace: structuredClone(getSLModelState().lastBid) });
    }
    for (const fixture of fixtures.filter(f => isTarget(f.id) || f.boundary === 'enemy-diamonds')) {
      const room = new LanRoom({ biddingSystem: fixture.system, now: () => 0, advisor });
      const authority = room as unknown as { game: ReturnType<typeof gameAt>; revision: number };
      const unwrap = (response: RoomResponse) => { if (!response.ok) throw Error(`${response.code}: ${response.message}`); return response; };
      const request = (payload: object) => unwrap(room.request({ ...payload, supportedAgreements: LAN_SUPPORTED_AGREEMENTS }));
      try {
        const host = SEATS[(SEATS.indexOf(fixture.observation.seat) + 1) % 4];
        const token = request({ kind: 'join', roomCode: room.roomCode, seat: host, nonce: createJoinNonce() }).token!;
        request({ kind: 'action', token, id: 'ready', revision: authority.revision, action: { kind: 'ready', ready: true } });
        request({ kind: 'action', token, id: 'start', revision: authority.revision, action: { kind: 'startWithRobots' } });
        authority.game = gameAt(fixture.observation, fixture.system);
        const before = authority.game, revision = authority.revision, snapshot = request({ kind: 'poll', token }).snapshot;
        assertGameIntegrity(authority.game); expect(authority.game.actions).toHaveLength(before.actions.length + 1); expect(authority.revision).toBe(revision + 1);
        expect(snapshot.auction).toEqual(authority.game.auction); expect(snapshot.agreementVersion).toBe(agreementVersionFor(fixture.system));
        expect(snapshot).not.toHaveProperty('hands'); expect(snapshot).not.toHaveProperty('seed');
        expect(replay(toRecord(authority.game)).auction).toEqual(authority.game.auction);
        const lanFixture = { ...fixture, expected: fixture.boundary === 'enemy-double-cue-answer' && fixture.system === 'two-over-one' ? '2H' : fixture.expected };
        lanRows.push({ ...details(lanFixture, authority.game, 'LanRoom.request(poll) -> advanceRobot -> robotStep -> chooseLanBid -> applyAction'), neuralTrace: null,
          entrypointExpectation: fixture.boundary === 'enemy-double-cue-answer' ? 'Default SL retains 2D in both systems; existing LAN rule selects SAYC 2D and two-over-one 2H. Both natural answers qualify and complete the one-round obligation.' : fixture.boundary === 'enemy-diamonds' ? 'Existing rule answers enemy natural diamonds with 2H through actual LAN poll; controller now enforces the same pending public cue obligation' : 'Same existing natural Pass across controller and room rule route',
          revisionBefore: revision, revisionAfter: authority.revision, snapshot });
      } finally { room.dispose(); }
    }
    // Invalid premature artificial answers remain rejected; these are pure
    // candidate checks on a frozen observation, not extra model queries.
    for (const fixture of fixtures.filter(f => f.id === 'existing-weak-jump-feature-answer')) {
      for (const token of ['4S', 'Pass']) {
        const candidate = assessCandidates(fixture.observation, fixture.system).find(c => sameCall(c.call, parse(token)));
        if (candidate?.allowed) failures.push(`${fixture.id}/${fixture.system}: invalid pending answer ${token} accepted`);
        controls.push({ kind: 'pending-artificial-answer-rejected', system: fixture.system, call: parse(token), candidate });
      }
    }
    for (const fixture of fixtures.filter(f => isTarget(f.id))) {
      const step = await robotStepWithAdvisor(gameAt(fixture.observation, fixture.system, true), fixture.system, 'basic', advisor, false);
      expect(name(step.game.auction.at(-1)!.call)).toBe(fixture.expected); assertGameIntegrity(step.game);
      controls.push({ kind: 'hidden-padding-invariance', id: fixture.id, system: fixture.system, actual: step.game.auction.at(-1)!.call, actualAction: true });
    }
    await setSLProfile('original-sl');
    for (const old of fixed.originalSLRollback.rows.slice(0, 4)) {
      const saved = fixed.rows.find((r: any) => r.pointId === old.pointId && r.system === old.system), before = gameAt(saved.frozenObservation, old.system);
      const step = await robotStepWithAdvisor(before, old.system, 'basic', advisor, false), actual = step.game.auction.at(-1)!.call, trace = structuredClone(getSLModelState().lastBid);
      assertGameIntegrity(step.game);
      if (name(actual) !== old.expectedOriginalSLFrozenCall || trace?.route !== 'sl-legal' || trace.loadedWeightsSHA256 !== SL_PROFILES['original-sl'].weightsSHA256) failures.push(`${old.pointId}/${old.system}: original SL rollback changed`);
      controls.push({ kind: 'frozen-original-SL-rollback', id: old.pointId, system: old.system, expected: old.expectedOriginalSLFrozenCall, actual, trace, actualAction: true });
    }
    for (const fixture of fixtures.filter(f => isTarget(f.id) || f.boundary === 'enemy-diamonds')) {
      const before = gameAt(fixture.observation, fixture.system), step = await robotStepWithAdvisor(before, fixture.system, 'basic', advisor, false);
      const actual = step.game.auction.at(-1)!.call, trace = structuredClone(getSLModelState().lastBid);
      assertGameIntegrity(step.game);
      const frozenExpected = fixture.boundary === 'passed-hand' ? '2S' : fixture.boundary === 'enemy-diamonds' ? 'Pass' : undefined;
      if (frozenExpected && name(actual) !== frozenExpected) failures.push(`${fixture.id}/${fixture.system}: original SL affected by new Pass repair`);
      if (trace?.route !== 'sl-legal' || trace.loadedWeightsSHA256 !== SL_PROFILES['original-sl'].weightsSHA256) failures.push(`${fixture.id}/${fixture.system}: original SL repair isolation lost`);
      controls.push({ kind: 'approved-fix-position-original-SL-isolation', id: fixture.id, system: fixture.system, expected: frozenExpected,
        expectedBoundary: frozenExpected ? 'Existing original-SL exact call retained despite default-profile repair' : 'Unmodified raw SL route; no frozen exact-call claim', actual, trace, actualAction: true });
    }
    for (const fixture of fixtures.filter(f => (f.old?.group === 'five-frozen-targets' || isTarget(f.id)) && f.system === 'sayc')) {
      const before = gameAt(fixture.observation, 'precision'), expected = decidePrecisionBid(fixture.observation), modelBefore = structuredClone(getSLModelState());
      const step = await robotStepWithAdvisor(before, 'precision', 'basic', advisor, false);
      expect(step.game.auction.at(-1)!.call).toEqual(expected); expect(getSLModelState()).toEqual(modelBefore); assertGameIntegrity(step.game);
      controls.push({ kind: 'precision-controller-isolation', id: fixture.id, actual: expected, modelStateUnchanged: true, actualAction: true });
    }
    expect(advisor.advise).not.toHaveBeenCalled();
  } catch (error) { fatalError = error instanceof Error ? error.stack ?? error.message : String(error); }
  finally {
    vi.unstubAllGlobals();
    const inputsPreserved = inputs.every(path => hash(path) === inputHashes[path]), sourceStableDuringRun = sourcePaths.every(path => hash(path) === sourceHashes[path]);
    if (!inputsPreserved || !sourceStableDuringRun) failures.push('Source or old evidence changed during verification');
    const expectedTargets = 4, expectedLan = 6, actualTargets = rows.filter(r => r.group === 'two-approved-fixes').length;
    if (rows.length !== fixtures.length || actualTargets !== expectedTargets || lanRows.length !== expectedLan) failures.push('Incomplete actual-table queries');
    mkdirSync(directory, { recursive: true });
    writeFileSync(output, JSON.stringify({ schema: 'v328-cue-flows-actual-table-v1', completedAt: new Date().toISOString(), validExecution: !fatalError && !failures.length,
      scope: 'Prior 67 actions plus pending-cue execution repair, two enemy-diamond LAN polls and two original-SL controls; frozen v326/v327 unit/integration contexts. Hidden cards are engine padding only. No new mother-deal cohort, training, play, DDS or whole-board continuation.',
      enemyDoubleClarification: 'In 1C 1H P 2C X, opener doubles our partner artificial support cue; X is an opponent action, not our takeout double.',
      lanBoundary: 'Node authoritative LanRoom actual poll; no live transport or physical-device claim.',
      newMotherDeals: 0, training: 0, playAdvisorCalls: advisor.advise.mock.calls.length, ddsCalls: 0,
      inputHashes, inputsPreserved, sourceHashes, sourceStableDuringRun, expectedControllerQueries: fixtures.length, completedControllerQueries: rows.length,
      expectedApprovedFixQueries: expectedTargets, completedApprovedFixQueries: actualTargets, expectedLanActualPollQueries: expectedLan, completedLanActualPollQueries: lanRows.length,
      actualActions: rows.length + lanRows.length + controls.filter(c => c.actualAction).length, rows, lanRows, controls, fatalError, failures }, null, 2));
  }
  expect(fatalError).toBeNull(); expect(failures).toEqual([]); expect(rows).toHaveLength(fixtures.length); expect(lanRows).toHaveLength(6);
}, 60000);

