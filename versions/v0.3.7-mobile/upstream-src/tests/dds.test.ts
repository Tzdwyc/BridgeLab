import { beforeAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { DdsEngine } from '../src/analysis/engine';
import { analysisPosition, doubleDummyTableRequest, normalizeResult } from '../src/analysis/adapter';
import { exampleGame, replayLine } from '../src/analysis/model';
import { toRecord, playCard } from '../src/core/game';
import { type GameState, type Strain, SEATS, sideOf } from '../src/core/types';
import { legalCards } from '../src/core/play';
import { ENGINE, type RawFutureTricks } from '../src/analysis/types';

let engine: DdsEngine;
beforeAll(async () => { engine = await DdsEngine.create(); }, 30000);

const OFFICIAL_TABLES = [
  {
    cards: 'N:QJ6.K652.J85.T98 873.J97.AT764.Q4 K5.T83.KQ9.A7652 AT942.AQ4.32.KJ3',
    raw: [5,8,5,8, 6,6,6,6, 5,7,5,7, 7,5,7,5, 6,6,6,6]
  },
  {
    cards: 'E:QJT5432.T.6.QJ82 .J97543.K7532.94 87.A62.QJT4.AT75 AK96.KQ8.A98.K63',
    raw: [4,9,4,9, 10,2,10,2, 8,3,8,3, 6,7,6,7, 9,3,9,3]
  },
  {
    cards: 'N:73.QJT.AQ54.T752 QT6.876.KJ9.AQ84 5.A95432.7632.K6 AKJ9842.K.T8.J93',
    raw: [3,10,3,10, 9,4,9,4, 8,4,8,4, 3,9,3,9, 4,8,4,8]
  }
] as const;
const DDS_STRAINS: Strain[] = ['S', 'H', 'D', 'C', 'NT'];

function exhaustiveValue(state: GameState, memo = new Map<string, number>()): number {
  const declaringSide = sideOf(state.contract!.declarer);
  if (state.phase === 'complete') return state.tricksWon[declaringSide];
  const key = analysisPosition(state).key;
  if (memo.has(key)) return memo.get(key)!;
  const values = legalCards(state.hands[state.turn], state.currentTrick).map(card => exhaustiveValue(playCard(state, state.turn, card.id), memo));
  const value = (sideOf(state.turn) === declaringSide ? Math.max : Math.min)(...values);
  memo.set(key, value); return value;
}

test('CalcDDtablePBN matches all three official DDS fixed matrices with semantic seat and strain axes', () => {
  for (const [fixture, expected] of OFFICIAL_TABLES.entries()) {
    const key = JSON.stringify([ENGINE, 'table', expected.cards]);
    const result = engine.table({ key, cards: expected.cards });
    expect(result.key).toBe(key);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    for (const [strainIndex, strain] of DDS_STRAINS.entries()) {
      for (const [seatIndex, seat] of SEATS.entries()) {
        expect(result.table[seat][strain], `${seat}-${strain}, fixture ${fixture}`).toBe(expected.raw[strainIndex * 4 + seatIndex]);
      }
    }
  }
  expect(() => engine.table({ key: 'arbitrary-key', cards: OFFICIAL_TABLES[0].cards })).toThrow('请求');
});

test('WASM CalcDDtablePBN agrees with 20 independent official native SolveBoardPBN calls', () => {
  const executable = 'artifacts/dds-reference.exe';
  if (!existsSync(executable)) throw new Error('Run the documented native-reference build first; this comparison must not be skipped');
  const game = exampleGame('dds-table-native', 'NT', 'S', 17);
  const line = replayLine(toRecord(game));
  const request = doubleDummyTableRequest(line.states[0]);
  expect(doubleDummyTableRequest(line.states[23])).toEqual(request);
  expect(doubleDummyTableRequest(line.states[52])).toEqual(request);
  const input = DDS_STRAINS.flatMap(trump => SEATS.map((_, declarer) =>
    [DDS_STRAINS.indexOf(trump), (declarer + 1) % 4, 0, 0, 0, 0, 0, 0, request.cards].join(' ')
  )).join('\n') + '\n';
  const native = spawnSync(executable, [], { input, encoding: 'utf8', timeout: 120000, env: { ...process.env, PATH: `C:\\msys64\\clang64\\bin;${process.env.PATH}` } });
  expect(native.error).toBeUndefined(); expect(native.status, native.stderr).toBe(0);
  const reference = native.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line) as RawFutureTricks & { code: number });
  expect(reference).toHaveLength(20);
  const wasm = engine.table(request);
  for (const [strainIndex, strain] of DDS_STRAINS.entries()) {
    for (const [seatIndex, seat] of SEATS.entries()) {
      const raw = reference[strainIndex * 4 + seatIndex];
      expect(raw.code).toBe(1);
      expect(wasm.table[seat][strain], `${seat}-${strain}`).toBe(13 - Math.max(...raw.score));
    }
  }
}, 180000);

test('20 fixed WASM positions match independent official native DDS 2.9.0', () => {
  const executable = 'artifacts/dds-reference.exe';
  if (!existsSync(executable)) throw new Error('Run the documented native-reference build first; this comparison must not be skipped');
  const strains: Strain[] = ['S', 'H', 'D', 'C', 'NT'];
  const cursors = [0, 1, 2, 3, 20, 21, 22, 23, 36, 37, 38, 39, 44, 45, 46, 47, 48, 49, 50, 51];
  const cases = cursors.map((cursor, i) => {
    const game = exampleGame(`dds-fixed-${i}`, strains[i % 5], SEATS[i % 4], i + 1);
    return { state: replayLine(toRecord(game)).states[cursor], cursor };
  });
  const positions = cases.map(c => analysisPosition(c.state));
  const input = positions.map(p => [p.deal.trump, p.deal.first, ...Array.from({ length: 3 }, (_, i) => [p.deal.currentTrickSuit[i] ?? 0, p.deal.currentTrickRank[i] ?? 0]).flat(), p.deal.remainCards].join(' ')).join('\n') + '\n';
  const native = spawnSync(executable, [], { input, encoding: 'utf8', timeout: 120000, env: { ...process.env, PATH: `C:\\msys64\\clang64\\bin;${process.env.PATH}` } });
  expect(native.error).toBeUndefined(); expect(native.status, native.stderr).toBe(0);
  const reference = native.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line) as RawFutureTricks & { code: number });
  expect(reference).toHaveLength(20);
  const rows = positions.map((position, i) => {
    expect(reference[i].code).toBe(1);
    const wasm = engine.solve(position); const expected = normalizeResult(position, reference[i]);
    expect(wasm.candidates, `fixture ${i}`).toEqual(expected.candidates);
    expect(wasm.declarerTricks).toBe(expected.declarerTricks);
    return { fixture: i, seed: cases[i].state.seed, strain: cases[i].state.contract!.strain, declarer: cases[i].state.contract!.declarer,
      cursor: cases[i].cursor, partialTrick: position.deal.currentTrickRank.length, actor: position.actor,
      candidates: wasm.candidates, declarerTricks: wasm.declarerTricks, elapsedMs: wasm.elapsedMs, heapBytes: wasm.heapBytes, matched: true };
  });
  writeFileSync('artifacts/dds-reference-results.json', JSON.stringify({ executedAt: new Date().toISOString(), nativeVersion: 20900, nativeCommit: '8d75755c8df81999557758c9757514edb94017bc', wasmPackage: 'bridge-dds@1.4.0', cases: rows }, null, 2));
}, 180000);

test.each([0, 1, 2, 3])('independent core minimax verifies trump and NT with %i cards in current trick', partial => {
  for (const [strain, declarer] of [['S', 'N'], ['NT', 'E']] as const) {
    const game = exampleGame(`minimax-${strain}`, strain, declarer);
    const state = replayLine(toRecord(game)).states[44 + partial];
    const result = engine.solve(analysisPosition(state));
    expect(result.declarerTricks).toBe(exhaustiveValue(state));
    for (const candidate of result.candidates) {
      expect(candidate.declarerTricks).toBe(exhaustiveValue(playCard(state, state.turn, candidate.cardId)));
      expect(candidate.loss).toBeGreaterThanOrEqual(0);
    }
  }
});

test('53-point AnalysePlay trace agrees with per-position solving including the last forced card', () => {
  const game = exampleGame('dds-trace-53', 'NT', 'W'); const line = replayLine(toRecord(game));
  const cards = line.plays.map(p => p.cardId[0] + '23456789TJQKA'[Number(p.cardId.slice(1)) - 2]).join('');
  const trace = engine.trace(analysisPosition(line.states[0]).deal, cards);
  // DDS 2.x omits the forced last trick: usually returns 49 points for 52 cards.
  expect(trace.length).toBeGreaterThanOrEqual(49); expect(trace.length).toBeLessThanOrEqual(53);
  for (let i = 0; i <= 52; i++) {
    const expected = trace[i] ?? game.result!.declarerTricks;
    expect(engine.solve(analysisPosition(line.states[i])).declarerTricks, `position ${i}`).toBe(expected);
  }
}, 180000);
