/** Bounded integration checks: historical own hands/public auctions, actual table actions.
 * V326_THREE_FLOWS_RUN=1 npx vitest run tests/v326-three-flows-live.test.ts
 * Completed evidence is append-only: use a new V326_THREE_FLOWS_OUTPUT for a rerun.
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
interface Fixture { id: string; source: string; observation: BiddingObservation; expected?: string; checkedCall?: string; boundary?: string }
const directory = 'artifacts/v326-three-flows-20261108';
const oldFixedPath = 'artifacts/v325-consistency-20261108/final-release/fixed33-actual-table.json';
const oldMatrixPath = 'artifacts/v325-consistency-20261108/protocol-matrix-delivered.json';
const parse = (value: string): Call => value === 'P' || value === 'Pass' ? { kind: 'pass' } : value === 'X' ? { kind: 'double' }
  : value === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: Number(value[0]), strain: value.slice(1) as Strain };
const name = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'Pass' : call.kind === 'double' ? 'X' : 'XX';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function holding(text: string): Card[] {
  return text.split('.').flatMap((cards, i) => [...cards].filter(c => c !== '-').map(c => {
    const suit = (['S', 'H', 'D', 'C'] as const)[i], rank = '23456789TJQKA'.indexOf(c) + 2;
    return { id: `${suit}${rank}`, suit, rank };
  }));
}
// Exact existing generator from bidding-v03-sayc-competition.test.ts, no random deals.
function existingGenerated(shape: number[], target: number): Card[] {
  const suits = ['S', 'H', 'D', 'C'] as const;
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((sum, rank) => sum + rank - 10, 0), low = shape[index] - honors.length;
      if (low < 0 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (rest) return [...honors, ...Array.from({ length: low }, (_, n) => 10 - n)]
        .map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })).concat(rest);
    }
    return null;
  };
  const result = visit(0, target); if (!result) throw Error('Existing generator fixture is impossible'); return result;
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
  const ownIds = new Set(obs.hand.map(c => c.id));
  const padding = deck().filter(c => !ownIds.has(c.id)); if (reversePadding) padding.reverse();
  for (const seat of SEATS) if (seat !== obs.seat) hands[seat] = padding.splice(0, 13);
  let game = newGameFromDeal(obs.board, 'v326-existing-context-integration-only', hands, obs.auction[0]?.seat ?? obs.seat, obs.vulnerability);
  game = { ...game, biddingSystem: system, agreementVersion: agreementVersionFor(system) };
  for (const entry of obs.auction) game = applyAction(game, { kind: 'call', ...entry });
  assertGameIntegrity(game);
  expect(observe(game)).toEqual(obs); // Production strategy boundary equals frozen public information exactly.
  return game;
}

it.skipIf(process.env.V326_THREE_FLOWS_RUN !== '1')('verifies five historical positions and bounded three-flow counterexamples at the actual controller', async () => {
  const output = process.env.V326_THREE_FLOWS_OUTPUT ?? `${directory}/actual-table-001.json`;
  if (existsSync(output)) throw Error(`Preserve completed evidence: ${output}`);
  const oldFixed = JSON.parse(readFileSync(oldFixedPath, 'utf8'));
  const oldMatrix = JSON.parse(readFileSync(oldMatrixPath, 'utf8'));
  const inputs = [oldFixedPath, oldMatrixPath, 'artifacts/v325-consistency-20261108/existing-conventions-readonly-audit.json'];
  const inputHashes = Object.fromEntries(inputs.map(path => [path, hash(path)]));
  const sources = ['src/ai/bidding-semantics.ts', 'src/ai/bidding-consistency.ts', 'src/ai/approved-bidding-flow.ts', 'src/ai/bidding-presentation.ts', 'src/ai/bid-strategy.ts', 'src/ai/constrained-sl.ts', 'src/ai/lan-bidding.ts', 'src/online/room.ts', 'src/ai/precision.ts'];
  const sourceHashes = Object.fromEntries(sources.filter(existsSync).map(path => [path, hash(path)]));
  const storage = new Map<string, string>(), rows: any[] = [], controls: any[] = [], lanRows: any[] = [], failures: string[] = [];
  const advisor = { cancel: vi.fn(), advise: vi.fn(async () => { throw Error('No play/DDS allowed'); }) };
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => new Response(new Uint8Array(readFileSync(new URL('../public' + new URL(String(input), 'http://local/').pathname, import.meta.url)))));
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto);
  const targets: Fixture[] = [];
  const targetExpected: Record<string, string> = { 'existing-doubled-michaels-remove': '2S', 'existing-michaels-minor-answer': '3D', 'existing-weak-jump-feature-answer': '3C', 'existing-weak-jump-feature-contract': '4S' };
  const oldNatural = oldFixed.rows.find((r: any) => r.pointId === 'B1-dev-long-0040-P1' && r.system === 'two-over-one');
  targets.push({ id: oldNatural.pointId, source: oldFixedPath, observation: oldNatural.frozenObservation, expected: '3C' });
  for (const row of oldMatrix.rows.filter((r: any) => r.unresolved)) {
    targets.push({ id: row.id, source: oldMatrixPath, observation: frozen(row.prefix, holding(row.holding)), expected: targetExpected[row.id] });
  }
  expect(targets).toHaveLength(5);
  const extra: Fixture[] = [
    { id: 'natural-second-suit-F1-not-GF', source: 'tests/bidding-chat-review.test.ts:76', observation: frozen('1H P 1S P 2H P 3D P', holding('A8.AQJ986.Q32.K4')), boundary: 'natural-F1' },
    { id: 'michaels-major-choice', source: 'tests/bidding-v03-sayc-competition.test.ts:117', observation: frozen('1C 2C P', existingGenerated([3, 4, 3, 3], 4)), expected: '2H' },
    { id: 'michaels-minor-inquiry', source: 'tests/bidding-v03-sayc-competition.test.ts:118', observation: frozen('1H 2H P', existingGenerated([2, 3, 4, 4], 7)), expected: '2NT' },
    { id: 'michaels-undoubled-minor-answer', source: 'tests/bidding-model-findings.test.ts:70; same own hand with quiet inquiry', observation: frozen('1H 2H P 2NT P', holding('KJ874.92.AQT86.4')), expected: '3D' },
    { id: 'weak-jump-low-no-side-AK', source: 'tests/bidding-v03-sayc-competition.test.ts:78; existing weak jump own hand', observation: frozen('1H 2S P 2NT P', holding('AQ9876.43.52.732')), expected: '3S' },
    { id: 'weak-jump-minimum-with-side-K', source: 'tests/v326-execution.test.ts:38; integration fixture only', observation: frozen('1H 2S P 2NT P', holding('QJ7432.6.98.K852')), expected: '3S' },
    { id: 'weak-jump-no-side-AK', source: 'tests/v326-execution.test.ts:39; integration fixture only', observation: frozen('1H 2S P 2NT P', holding('AQJ743.6.98.J852')), expected: '3S' },
    { id: 'weak-jump-eight-with-side-K-remains-original', source: 'tests/v326-execution.test.ts; 8-HCP integration fixture only', observation: frozen('1H 2S P 2NT P', holding('AJ7432.6.98.K852')), expected: '3S' },
    { id: 'weak-jump-nine-with-side-K-shows-feature', source: 'tests/v326-execution.test.ts; 9-HCP integration fixture only', observation: frozen('1H 2S P 2NT P', holding('AQ7432.6.98.K852')), expected: '3C' },
    { id: 'weak-jump-original-answer-may-stop', source: 'tests/v326-execution.test.ts:40; existing 6888 asking hand', observation: frozen('1H 2S P 2NT P 3S P', holding('AQ6.J97.KQ5.QJ74')), expected: 'Pass' },
    { id: 'weak-jump-low-asker-may-stop-below-game', source: 'tests/v326-execution.test.ts:41; integration fixture only', observation: frozen('1H 2S P 2NT P 3C P', holding('Q65.J97.Q85.J974')), expected: '3S' },
    { id: 'weak-jump-low-hand-not-forced-to-ask', source: 'tests/v326-execution.test.ts:49; integration fixture only', observation: frozen('1H 2S P', holding('Q65.J97.Q85.J974')), boundary: 'low-hand-no-inquiry' },
    { id: 'passed-hand-natural-new-suit-not-F1', source: 'tests/bidding-v033-competition.test.ts:38; exact historical own hand from fixed target', observation: frozen('P P 1C P 1H P 2C P 2D P', oldNatural.frozenObservation.hand), boundary: 'passed-natural' },
    { id: 'technical-double-cue-not-michaels', source: 'tests/bidding-v03-sayc-competition.test.ts:161; existing hand generator', observation: frozen('1D X P', existingGenerated([3, 4, 2, 4], 12)), checkedCall: '2D', boundary: 'technical-cue' },
    { id: 'support-cue-after-X-not-michaels', source: 'tests/bidding-model-findings.test.ts:73', observation: frozen('1C 1H P 2C X', holding('T8.AQJ76.KJ92.64')), checkedCall: '2D', boundary: 'independent-new-suit' },
  ];
  let fatalError: string | null = null;
  async function query(fixture: Fixture, system: System, group: string) {
    const before = gameAt(fixture.observation, system), step = await robotStepWithAdvisor(before, system, 'basic', advisor, false);
    const actual = step.game.auction.at(-1)!.call, trace = structuredClone(getSLModelState().lastBid);
    assertGameIntegrity(step.game); expect(step.warning).toBeNull(); expect(step.game.actions).toHaveLength(before.actions.length + 1);
    expect(replay(toRecord(step.game)).auction).toEqual(step.game.auction);
    const meaning = publicCallMeaningAt(step.game.auction, before.auction.length, system);
    const qualification = assessCandidates(fixture.observation, system).find(c => sameCall(c.call, actual));
    const notes = presentCall(before.auction, before.turn, actual, system);
    const checked = fixture.checkedCall ? publicCallMeaningAt([...before.auction, { seat: before.turn, call: parse(fixture.checkedCall) }], before.auction.length, system) : undefined;
    const stateBefore = analyzeAuctionSemantics(before.auction, before.turn, system);
    const violations: string[] = [];
    if (fixture.expected && name(actual) !== fixture.expected) violations.push(`expected ${fixture.expected}; actual ${name(actual)}`);
    if (group === 'five-frozen-targets' && (!meaning.defined || !qualification?.allowed)) violations.push('Target public meaning/own-hand qualification unresolved');
    if (/NaN|undefined|Infinity/.test(notes)) violations.push('Invalid short explanation');
    if (fixture.boundary === 'natural-F1' && (stateBefore.forcing !== 'one-round' || actual.kind === 'pass')) violations.push('Natural new-suit F1 obligation lost or promoted');
    if (fixture.boundary === 'technical-cue' && (checked?.role === 'michaels' || presentCall(before.auction, before.turn, parse('2D'), system).includes('Michaels'))) violations.push('Technical-double cue mislabeled Michaels');
    if (fixture.boundary === 'independent-new-suit' && checked?.supportRange) violations.push('Independent new suit falsely supports partner');
    if (fixture.boundary === 'low-hand-no-inquiry' && name(actual) === '2NT') violations.push('Low hand forced into 2NT inquiry');
    if (fixture.boundary === 'passed-natural' && stateBefore.mustBid) violations.push('Passed-hand natural new suit falsely forces a reply');
    failures.push(...violations.map(v => `${fixture.id}/${system}: ${v}`));
    rows.push({ group, id: fixture.id, source: fixture.source, system, frozenObservation: fixture.observation, expected: fixture.expected, actual, actualName: name(actual), notes,
      publicMeaning: meaning, qualification, stateBefore, checkedCallMeaning: checked, publicConstraints: publicPlayerConstraints(step.game.auction, before.turn, system), trace,
      actualApplyActionAccepted: true, engineIntegrityPassed: true, engineReplayPassed: true, frozenPublicObservationEqual: true, violations, record: toRecord(step.game) });
  }
  function lanQuery(fixture: Fixture, system: System) {
    const room = new LanRoom({ biddingSystem: system, now: () => 0, advisor });
    const authority = room as unknown as { game: ReturnType<typeof gameAt>; revision: number };
    const host = SEATS[(SEATS.indexOf(fixture.observation.seat) + 1) % 4];
    const unwrap = (response: RoomResponse) => { if (!response.ok) throw Error(`${response.code}: ${response.message}`); return response; };
    const request = (payload: object) => unwrap(room.request({ ...payload, supportedAgreements: LAN_SUPPORTED_AGREEMENTS }));
    try {
      const token = request({ kind: 'join', roomCode: room.roomCode, seat: host, nonce: createJoinNonce() }).token!;
      request({ kind: 'action', token, id: 'ready', revision: authority.revision, action: { kind: 'ready', ready: true } });
      request({ kind: 'action', token, id: 'start', revision: authority.revision, action: { kind: 'startWithRobots' } });
      // Existing room integration pattern: replace randomized startup padding
      // before any robot poll; only the historical frozen decision is queried.
      authority.game = gameAt(fixture.observation, system);
      const before = authority.game, revision = authority.revision;
      expect(observe(before)).toEqual(fixture.observation);
      const snapshot = request({ kind: 'poll', token }).snapshot, after = authority.game;
      const actual = after.auction.at(-1)!.call;
      const meaning = publicCallMeaningAt(after.auction, before.auction.length, system);
      const qualification = assessCandidates(fixture.observation, system).find(c => sameCall(c.call, actual));
      expect(after.actions).toHaveLength(before.actions.length + 1); expect(authority.revision).toBe(revision + 1);
      expect(snapshot.auction).toEqual(after.auction); expect(snapshot.biddingSystem).toBe(system);
      expect(snapshot.agreementVersion).toBe(agreementVersionFor(system));
      expect(snapshot).not.toHaveProperty('hands'); expect(snapshot).not.toHaveProperty('seed');
      assertGameIntegrity(after); expect(replay(toRecord(after)).auction).toEqual(after.auction);
      if (name(actual) !== fixture.expected || !meaning.defined || !qualification?.allowed) failures.push(`${fixture.id}/${system}: LAN actual poll unresolved or unexpected ${name(actual)}`);
      lanRows.push({ id: fixture.id, system, expected: fixture.expected, actual, actualName: name(actual), frozenObservation: fixture.observation,
        route: 'LanRoom.request(poll) -> advanceRobot -> robotStep -> chooseLanBid -> chooseSystemBid -> applyAction', neuralTrace: null,
        notes: presentCall(before.auction, before.turn, actual, system), publicMeaning: meaning, qualification,
        actualApplyActionAccepted: true, frozenPublicObservationEqual: true, engineIntegrityPassed: true, engineReplayPassed: true,
        revisionBefore: revision, revisionAfter: authority.revision, snapshot, record: toRecord(after) });
    } finally { room.dispose(); }
  }
  try {
    setLookaheadEnabled(false); await setSLProfile('seed101-epoch08');
    for (const fixture of [...targets, ...extra]) for (const system of ['sayc', 'two-over-one'] as const) {
      await query(fixture, system, targets.includes(fixture) ? 'five-frozen-targets' : 'existing-fixture-boundaries');
    }
    for (const fixture of targets) for (const system of ['sayc', 'two-over-one'] as const) lanQuery(fixture, system);
    // Same frozen public observation with different deterministic hidden padding.
    for (const system of ['sayc', 'two-over-one'] as const) {
      const fixture = targets[0], before = gameAt(fixture.observation, system, true);
      const step = await robotStepWithAdvisor(before, system, 'basic', advisor, false);
      assertGameIntegrity(step.game); expect(name(step.game.auction.at(-1)!.call)).toBe('3C');
      controls.push({ kind: 'hidden-padding-invariance', system, id: fixture.id, actual: step.game.auction.at(-1)!.call, frozenPublicObservationEqual: true });
    }
    await setSLProfile('original-sl');
    for (const old of oldFixed.originalSLRollback.rows.slice(0, 4)) {
      const frozenRow = oldFixed.rows.find((r: any) => r.pointId === old.pointId && r.system === old.system);
      const before = gameAt(frozenRow.frozenObservation, old.system);
      const step = await robotStepWithAdvisor(before, old.system, 'basic', advisor, false), actual = step.game.auction.at(-1)!.call;
      assertGameIntegrity(step.game); const trace = structuredClone(getSLModelState().lastBid);
      if (name(actual) !== old.expectedOriginalSLFrozenCall || trace?.route !== 'sl-legal' || trace?.loadedWeightsSHA256 !== SL_PROFILES['original-sl'].weightsSHA256) failures.push(`${old.pointId}/${old.system}: frozen original SL changed`);
      controls.push({ kind: 'frozen-original-SL-rollback', id: old.pointId, system: old.system, expected: old.expectedOriginalSLFrozenCall, actual, trace, actualApplyActionAccepted: true });
    }
    for (const fixture of targets) {
      const before = gameAt(fixture.observation, 'precision'), expected = decidePrecisionBid(fixture.observation), modelBefore = structuredClone(getSLModelState());
      const step = await robotStepWithAdvisor(before, 'precision', 'basic', advisor, false);
      expect(step.game.auction.at(-1)!.call).toEqual(expected); expect(getSLModelState()).toEqual(modelBefore); assertGameIntegrity(step.game);
      controls.push({ kind: 'precision-controller-preserved', id: fixture.id, actual: expected, modelStateUnchanged: true, actualApplyActionAccepted: true });
    }
    expect(advisor.advise).not.toHaveBeenCalled();
  } catch (error) { fatalError = error instanceof Error ? error.stack ?? error.message : String(error); }
  finally {
    vi.unstubAllGlobals();
    const inputsPreserved = inputs.every(path => hash(path) === inputHashes[path]);
    const sourceStableDuringRun = Object.entries(sourceHashes).every(([path, oldHash]) => hash(path) === oldHash);
    if (!inputsPreserved || !sourceStableDuringRun) failures.push('Evidence or source changed during verification');
    mkdirSync(directory, { recursive: true });
    writeFileSync(output, JSON.stringify({ schema: 'v326-three-flows-actual-controller-v1', completedAt: new Date().toISOString(), validExecution: !fatalError && !failures.length,
      scope: 'Historical own hands/public prefixes and existing deterministic unit fixtures. Hidden cards are engine padding only; no new mother-deal cohort, training, play, scoring, or whole-board continuation.',
      newMotherDeals: 0, training: 0, playAdvisorCalls: advisor.advise.mock.calls.length, ddsCalls: 0, inputHashes, inputsPreserved, sourceHashes, sourceStableDuringRun,
      targetPositions: targets.length, expectedTargetQueries: 10, completedTargetQueries: rows.filter(r => r.group === 'five-frozen-targets').length,
      expectedLanActualPollQueries: 10, completedLanActualPollQueries: lanRows.length, lanRows,
      rows, controls, fatalError, failures }, null, 2));
  }
  expect(fatalError).toBeNull(); expect(failures).toEqual([]); expect(rows.filter(r => r.group === 'five-frozen-targets')).toHaveLength(10); expect(lanRows).toHaveLength(10);
}, 60000);
