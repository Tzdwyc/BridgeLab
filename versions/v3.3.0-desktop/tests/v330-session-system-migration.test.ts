import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { applyCall, replay, toRecord } from '../src/core/game';
import { PASS, type GameRecord } from '../src/core/types';
import { agreementVersionFor } from '../src/ai/bid-strategy';
import { createMatch } from '../src/match/engine';
import { decodeSession, emptySession, encodeSession, loadSession, STORAGE_KEY } from '../src/persistence/session';

const board940 = JSON.parse(readFileSync(new URL('../artifacts/v330-systems-drury-20261109/existing-board940.json', import.meta.url), 'utf8')).record as GameRecord;
const oldFile = () => ({ version: 1, current: { ...board940, biddingSystem: 'sayc', agreementVersion: 'v329-frozen' }, undo: [], history: [], delay: 650, biddingSystem: 'sayc', gameSystem: 'sayc', playStrength: 'challenge' });

it('defaults to Natural and marks new standard selections so they never migrate', () => {
  expect(emptySession().biddingSystem).toBe('two-over-one');
  const session = { ...emptySession(), biddingSystem: 'sayc' as const, gameSystem: 'sayc' as const };
  expect(decodeSession(encodeSession(session))).toEqual(session);
  expect(decodeSession(encodeSession(decodeSession(encodeSession(session))))).toEqual(session);
});

it('backs up the exact old raw before returning Natural without altering board940 actions or cards', () => {
  const raw = JSON.stringify(oldFile());
  const values = new Map([[STORAGE_KEY, raw]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const loaded = loadSession(storage);
  expect(loaded.notice).toBeNull();
  expect(loaded.session.biddingSystem).toBe('two-over-one');
  expect(loaded.session.gameSystem).toBe('two-over-one');
  expect(loaded.session.game!.initialHands).toEqual(replay(board940).initialHands);
  expect(toRecord(loaded.session.game!)).toEqual({ ...oldFile().current, biddingSystem: 'two-over-one', agreementVersion: agreementVersionFor('two-over-one') });
  expect(values.get(STORAGE_KEY)).toBe(raw);
  expect(values.get(`${STORAGE_KEY}.backup.v3.3.0`)).toBe(raw);
  values.set(STORAGE_KEY, JSON.stringify({ ...oldFile(), delay: 250 }));
  loadSession(storage);
  expect(values.get(`${STORAGE_KEY}.backup.v3.3.0`)).toBe(raw);
});

it('migrates both active match tables and frozen config together with current, keeping actions and notes', () => {
  const match = createMatch('immutable', { mode: 'imp', boardCount: 8 }, { biddingSystem: 'sayc', playStrength: 'challenge' });
  match.boards[0].main = { ...board940, actions: board940.actions.slice(0, 3), biddingSystem: 'sayc', agreementVersion: match.config.agreementVersion };
  match.boards[0].reference = structuredClone(match.boards[0].main);
  match.boards[0].mainExplanations = match.boards[0].main.actions.filter(action => action.kind === 'call').map(() => '旧释义保持');
  match.boards[0].referenceExplanations = [...match.boards[0].mainExplanations];
  const raw = JSON.stringify({ ...oldFile(), current: match.boards[0].main, activeMatch: match });
  const loaded = decodeSession(raw);
  expect(loaded.activeMatch!.config).toEqual({ ...match.config, biddingSystem: 'two-over-one', agreementVersion: agreementVersionFor('two-over-one') });
  expect(loaded.activeMatch!.boards[0]).toEqual({ ...match.boards[0], main: toRecord(loaded.game!), reference: toRecord(loaded.game!) });
  expect(decodeSession(encodeSession(loaded))).toEqual(loaded);
  const corrupt = JSON.parse(raw); corrupt.activeMatch.config.biddingSystem = 'precision';
  expect(() => decodeSession(JSON.stringify(corrupt))).toThrow();
});

it('preserves finished history records and other systems', () => {
  let prior = replay({ ...board940, actions: [], biddingSystem: 'sayc', agreementVersion: 'original-history' });
  for (let i = 0; i < 4; i++) prior = applyCall(prior, prior.turn, PASS);
  const file = { ...oldFile(), current: { ...oldFile().current, board: 2 }, history: [toRecord(prior)] };
  const loaded = decodeSession(JSON.stringify(file));
  expect(toRecord(loaded.history[0])).toEqual(file.history[0]);
  expect(decodeSession(JSON.stringify({ ...oldFile(), current: null, biddingSystem: 'precision', gameSystem: 'precision' })).biddingSystem).toBe('precision');
});

it('retains natural-lite for unfinished pre-metadata saves while defaulting future games to Natural', () => {
  const { biddingSystem: _system, agreementVersion: _agreement, ...unboundRecord } = board940;
  const legacy = { ...oldFile(), current: { ...unboundRecord, actions: board940.actions.slice(0, 3) } };
  const raw = JSON.stringify(legacy);
  const loaded = decodeSession(raw.replace(/,"gameSystem":"sayc"/, ''));
  expect(loaded.biddingSystem).toBe('two-over-one');
  expect(loaded.gameSystem).toBe('natural-lite');
  expect(toRecord(loaded.game!)).toEqual(legacy.current);
});
