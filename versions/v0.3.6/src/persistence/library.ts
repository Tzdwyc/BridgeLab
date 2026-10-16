import type { Match, MatchMode, MatchSummary } from '../match/engine';
import { matchSummary, validateMatch } from '../match/engine';
import type { Session } from './session';
import { isFinished, toRecord } from '../core/game';

const DB_NAME = 'bridgelab.library.v3.6';
const FALLBACK_PREFIX = 'bridgelab.library.v3.6.match.';
let database: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('此浏览器不支持 IndexedDB'));
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('matches', { keyPath: 'id' }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = () => { database = null; reject(request.error ?? new Error('比赛档案库不可用')); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('matches', mode), request = operation(tx.objectStore('matches'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? request.error ?? new Error('比赛档案保存失败'));
  });
}
function fallbackRead(): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(FALLBACK_PREFIX)) {
      const raw = localStorage.getItem(key);
      if (raw) matches.push(validateMatch(JSON.parse(raw)));
    }
  }
  return matches;
}
export async function putMatch(match: Match): Promise<void> {
  const copy = validateMatch(match);
  const old = await getMatch(copy.id);
  if (old) {
    if (JSON.stringify(old) !== JSON.stringify(copy)) throw new Error('已归档比赛不能覆盖，请使用新的比赛标识');
    return;
  }
  try { await transaction('readwrite', store => store.put(copy)); }
  catch { localStorage.setItem(`${FALLBACK_PREFIX}${encodeURIComponent(copy.id)}`, JSON.stringify(copy)); }
}
export async function getMatch(id: string): Promise<Match | null> {
  let stored: unknown;
  let databaseAvailable = false;
  try { stored = await transaction('readonly', store => store.get(id)); databaseAvailable = true; } catch { /* fallback below */ }
  let fallback: string | null = null;
  try { fallback = localStorage.getItem(`${FALLBACK_PREFIX}${encodeURIComponent(id)}`); }
  catch (error) { if (!databaseAvailable) throw error; }
  const primary = stored ? validateMatch(stored) : null, secondary = fallback ? validateMatch(JSON.parse(fallback)) : null;
  return primary && secondary ? (secondary.updatedAt > primary.updatedAt ? secondary : primary) : primary ?? secondary;
}
export async function allMatches(): Promise<Match[]> {
  let rows: Match[] = [];
  let databaseAvailable = false;
  try { rows = (await transaction('readonly', store => store.getAll())).map(validateMatch); databaseAvailable = true; } catch { /* fallback below */ }
  const merged = new Map(rows.map(match => [match.id, match]));
  let fallback: Match[] = [];
  try { fallback = fallbackRead(); } catch (error) { if (!databaseAvailable) throw error; }
  for (const match of fallback) {
    const old = merged.get(match.id);
    if (!old || match.updatedAt > old.updatedAt) merged.set(match.id, match);
  }
  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function listMatches(mode?: MatchMode): Promise<MatchSummary[]> {
  return (await allMatches()).filter(match => !mode || match.mode === mode).map(matchSummary);
}
export async function exportMatches(): Promise<string> { return JSON.stringify({ format: 'bridgelab.matches', version: 1, matches: await allMatches() }, null, 2); }
export async function importMatches(raw: string): Promise<number> {
  if (raw.length > 50_000_000) throw new Error('导入文件过大');
  const file = JSON.parse(raw);
  if (file?.format !== 'bridgelab.matches' || file.version !== 1 || !Array.isArray(file.matches) || file.matches.length > 1000) throw new Error('比赛档案格式不支持');
  // Validate the entire file before writing any record. Existing archives are immutable.
  const matches = file.matches.map(validateMatch) as Match[];
  const ids = new Set<string>();
  for (const match of matches) { if (ids.has(match.id)) throw new Error('文件包含重复比赛标识'); ids.add(match.id); }
  const additions: Match[] = [];
  for (const match of matches) {
    const old = await getMatch(match.id);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(match)) throw new Error('同名比赛已有不同内容，已保留现有存档');
      continue;
    }
    additions.push(match);
  }
  if (!additions.length) return 0;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('matches', 'readwrite'), store = tx.objectStore('matches');
      for (const match of additions) store.put(match);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('导入失败'));
    });
  } catch {
    const written: string[] = [];
    try {
      for (const match of additions) {
        const key = `${FALLBACK_PREFIX}${encodeURIComponent(match.id)}`;
        localStorage.setItem(key, JSON.stringify(match)); written.push(key);
      }
    } catch (error) { for (const key of written) localStorage.removeItem(key); throw error; }
  }
  return additions.length;
}

/** Deterministic identity makes migration retry-safe; the original storage key is untouched. */
export async function archiveLegacySession(session: Session): Promise<void> {
  const games = [...session.history, ...(session.game ? [session.game] : [])];
  if (!games.length) return;
  const records = games.map(toRecord), content = JSON.stringify(records);
  // Two independent integer streams also work on LAN HTTP (where crypto.subtle is absent).
  let first = 2166136261, second = 5381;
  for (let i = 0; i < content.length; i++) { first = Math.imul(first ^ content.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ content.charCodeAt(i); }
  const id = `legacy-v035-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${content.length}`;
  if (await getMatch(id)) return;
  const now = new Date().toISOString();
  const allComplete = games.every(isFinished);
  const match: Match = { version: 1, id, legacy: true, softwareVersion: '0.3.5', mode: 'total', boardCount: games.length, assisted: true,
    status: allComplete ? 'completed' : 'unfinished', createdAt: now, updatedAt: now, seed: games[0].seed,
    currentBoard: games.length, config: { biddingSystem: session.gameSystem, playStrength: session.playStrength },
    boards: games.map(game => ({ number: game.board, main: toRecord(game), reference: null, scoreNS: null, referenceScoreNS: null, difference: null, imps: null })),
    totalScore: 0, totalImps: 0, completedBoards: 0 };
  await putMatch(match);
}
