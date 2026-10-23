import { expect, it, vi } from 'vitest';
import { newGame } from '../src/core/game';
import { emptySession, encodeSession, LEGACY_STORAGE_KEY } from '../src/persistence/session';

const gate = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { ready, release };
});
vi.mock('../src/persistence/library', async original => {
  const real = await original<typeof import('../src/persistence/library')>();
  return { ...real,
    archiveLegacySession: vi.fn(async (session: Parameters<typeof real.archiveLegacySession>[0]) => { await gate.ready; return real.archiveLegacySession(session); }),
    listMatches: vi.fn(real.listMatches), getMatch: vi.fn(real.getMatch), allMatches: vi.fn(real.allMatches)
  };
});

it('waits for startup migration before history, detail, export, or replacing a legacy session', async () => {
  const values = new Map<string, string>();
  values.set(LEGACY_STORAGE_KEY, encodeSession({ ...emptySession(), game: newGame(1, 'startup-legacy') }));
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }
  });
  const { useGame, migrationReady } = await import('../src/controller/store');
  const library = await import('../src/persistence/library');
  await vi.waitFor(() => expect(library.archiveLegacySession).toHaveBeenCalledTimes(1));
  const history = useGame.getState().listMatches();
  const detail = useGame.getState().getMatch('unknown');
  const backup = useGame.getState().exportMatches();
  const replacement = useGame.getState().startMatch({ mode: 'total', seed: 'after-startup' });
  await Promise.resolve(); await Promise.resolve();
  expect(library.listMatches).not.toHaveBeenCalled();
  expect(library.getMatch).not.toHaveBeenCalled();
  expect(library.allMatches).not.toHaveBeenCalled();
  expect(library.archiveLegacySession).toHaveBeenCalledTimes(1);
  expect(useGame.getState().game?.seed).toBe('startup-legacy');
  gate.release(); await migrationReady;
  const [rows, missing, raw] = await Promise.all([history, detail, backup]);
  await replacement;
  expect(rows.some(row => row.legacy)).toBe(true);
  expect(missing).toBeNull();
  expect(JSON.parse(raw).matches.some((match: { legacy?: boolean }) => match.legacy)).toBe(true);
  const legacyRows = (await library.allMatches()).filter(row => row.legacy);
  expect(legacyRows).toHaveLength(1);
  expect(useGame.getState().game?.seed).toContain('after-startup');
  expect(values.has(`${LEGACY_STORAGE_KEY}.backup.v3.6`)).toBe(true);
});
