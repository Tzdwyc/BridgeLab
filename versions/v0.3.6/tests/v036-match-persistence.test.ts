import { beforeEach, expect, it, vi } from 'vitest';
import { createMatch, type Match } from '../src/match/engine';
import { applyCall, newGame } from '../src/core/game';
import { emptySession, encodeSession, LEGACY_STORAGE_KEY, loadSession, STORAGE_KEY } from '../src/persistence/session';
import { allMatches, archiveLegacySession, exportMatches, getMatch, importMatches, putMatch } from '../src/persistence/library';
import { PASS } from '../src/core/types';

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
let storage: MemoryStorage;
const fixture = (id: string): Match => ({ ...createMatch(id, { mode: 'imp', boardCount: 8 }, { biddingSystem: 'precision', playStrength: 'standard' }), status: 'unfinished' });
beforeEach(() => { storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage); vi.stubGlobal('indexedDB', undefined); });

it('migrates v035 history and unfinished current deal without changing raw source or analysis records', async () => {
  let first = newGame(1, 'old-finished'); for (let i = 0; i < 4; i++) first = applyCall(first, first.turn, PASS);
  const old = { ...emptySession(), history: [first], game: newGame(2, 'old-unfinished'), gameSystem: 'sayc' as const };
  const raw = encodeSession(old);
  storage.setItem(LEGACY_STORAGE_KEY, raw); storage.setItem('bridgelab.analysis.archive.v3.5', 'analysis-preserved');
  const loaded = loadSession(storage);
  expect(loaded.session).toEqual(old);
  expect(storage.getItem(`${LEGACY_STORAGE_KEY}.backup.v3.6`)).toBe(raw);
  await archiveLegacySession(loaded.session); await archiveLegacySession(loaded.session);
  const rows = await allMatches();
  expect(rows).toHaveLength(1); expect(rows[0].status).toBe('unfinished'); expect(rows[0].boards).toHaveLength(2);
  expect(rows[0].softwareVersion).toBe('0.3.5'); expect(rows[0].boards[0].mainExplanations).toBeUndefined();
  expect(rows[0].completedBoards).toBe(1); expect(rows[0].boards[1].main.seed).toBe('old-unfinished');
  expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw); expect(storage.getItem('bridgelab.analysis.archive.v3.5')).toBe('analysis-preserved');
  expect(storage.getItem(STORAGE_KEY)).toBeNull();
  // A changed old game with the same seed and count must be preserved separately.
  await archiveLegacySession({ ...old, game: applyCall(old.game, old.game.turn, PASS) });
  expect(await allMatches()).toHaveLength(2);
});

it('keeps archives immutable and round trips a validated export/import', async () => {
  const match = fixture('immutable');
  match.boards[0].main.actions.push({ kind: 'call', seat: 'N', call: PASS });
  match.boards[0].mainExplanations = ['当时版本保存的叫牌释义'];
  await putMatch(match);
  const exported = await exportMatches();
  storage.values.clear(); expect(await importMatches(exported)).toBe(1); expect(await importMatches(exported)).toBe(0);
  const restored = await getMatch(match.id); expect(restored).toEqual(match);
  expect(restored?.boards[0].mainExplanations).toEqual(['当时版本保存的叫牌释义']);
  await expect(putMatch({ ...match, assisted: true })).rejects.toThrow('不能覆盖');
  expect(await getMatch(match.id)).toEqual(match);
});

it('preflights all invalid records and conflicts before importing anything', async () => {
  const existing = fixture('existing'); await putMatch(existing);
  const additions = [fixture('new-first'), { ...existing, assisted: true }];
  await expect(importMatches(JSON.stringify({ format: 'bridgelab.matches', version: 1, matches: additions }))).rejects.toThrow('不同内容');
  expect(await getMatch('new-first')).toBeNull();
  await expect(importMatches(JSON.stringify({ format: 'bridgelab.matches', version: 1, matches: [fixture('another'), { bad: true }] }))).rejects.toThrow();
  expect(await getMatch('another')).toBeNull();
});

it('rolls back partial local fallback writes if quota fails during an import', async () => {
  const original = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key.endsWith('second')) throw new Error('quota'); original(key, value); };
  await expect(importMatches(JSON.stringify({ format: 'bridgelab.matches', version: 1, matches: [fixture('first'), fixture('second')] }))).rejects.toThrow('quota');
  expect(await getMatch('first')).toBeNull(); expect(await allMatches()).toHaveLength(0);
});

it('prefers a newer fallback record when an older IndexedDB record is also present', async () => {
  const older = { ...fixture('dual'), updatedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { ...older, updatedAt: '2026-10-01T00:00:00.000Z', assisted: true };
  storage.setItem('bridgelab.library.v3.6.match.dual', JSON.stringify(newer));
  const db = {
    onversionchange: null, close() {},
    transaction() {
      const tx = { oncomplete: null as null | (() => void), onabort: null, onerror: null, objectStore: () => ({
        get: () => ({ result: older }), getAll: () => ({ result: [older] })
      }) };
      queueMicrotask(() => tx.oncomplete?.()); return tx;
    }
  };
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: db, onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } });
  expect((await getMatch('dual'))?.assisted).toBe(true);
  expect((await allMatches())[0].assisted).toBe(true);
  // IndexedDB remains usable when localStorage access itself is prohibited.
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); }, get length() { throw new Error('disabled'); } });
  expect((await getMatch('dual'))?.updatedAt).toBe(older.updatedAt);
  expect((await allMatches())[0].id).toBe('dual');
});
