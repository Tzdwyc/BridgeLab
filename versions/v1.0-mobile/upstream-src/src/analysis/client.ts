import { SEATS, sideOf, type Strain } from '../core/types';
import { type AnalysisPosition, type DoubleDummyTableRequest, type DoubleDummyTableResult, type PositionResult, ENGINE } from './types';

export const CACHE_KEY = 'bridgelab.analysis.cache.v3.6';
const LIMIT = 400;
const TABLE_LIMIT = 24;
const TABLE_STRAINS: Strain[] = ['S', 'H', 'D', 'C', 'NT'];
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type PendingRequest = {
  kind: 'position'; position: AnalysisPosition; resolve: (result: PositionResult) => void;
  reject: (error: Error) => void; cleanup: () => void;
} | {
  kind: 'table'; request: DoubleDummyTableRequest; resolve: (result: DoubleDummyTableResult) => void;
  reject: (error: Error) => void; cleanup: () => void;
};
export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: unknown): void; terminate(): void;
}
export class AnalysisCancelled extends Error { constructor() { super('分析已取消'); this.name = 'AnalysisCancelled'; } }
export function validateResult(position: AnalysisPosition, result: PositionResult): boolean {
  if (!result || result.key !== position.key || result.engine !== ENGINE || !Number.isInteger(result.declarerTricks) || result.declarerTricks < 0 || result.declarerTricks > 13 || !Array.isArray(result.candidates)) return false;
  if (position.terminalTricks !== null) return result.declarerTricks === position.terminalTricks && !result.candidates.length;
  const ids = new Set(result.candidates.map(c => c.cardId));
  if (ids.size !== position.legalCards.length || result.candidates.length !== ids.size || position.legalCards.some(c => !ids.has(c.id))) return false;
  const declares = sideOf(position.actor) === position.declaringSide;
  const best = (declares ? Math.max : Math.min)(...result.candidates.map(c => c.declarerTricks));
  return best === result.declarerTricks && result.candidates.every(c => Number.isInteger(c.declarerTricks) && c.declarerTricks >= position.wonByDeclarer && c.declarerTricks <= position.wonByDeclarer + position.remainingTricks && c.loss === (declares ? best - c.declarerTricks : c.declarerTricks - best) && c.optimal === (c.loss === 0));
}
export function validateTableResult(request: DoubleDummyTableRequest, result: DoubleDummyTableResult): boolean {
  if (!result || result.key !== request.key || result.engine !== ENGINE || !result.table || Object.keys(result.table).length !== SEATS.length) return false;
  return SEATS.every(seat => {
    const row = result.table[seat];
    return !!row && Object.keys(row).length === TABLE_STRAINS.length && TABLE_STRAINS.every(strain => Number.isInteger(row[strain]) && row[strain] >= 0 && row[strain] <= 13);
  });
}

export class AnalysisClient {
  private worker: WorkerLike | null = null;
  private nextId = 0;
  private cache = new Map<string, PositionResult>();
  private tableCache = new Map<string, DoubleDummyTableResult>();
  private pending = new Map<number, PendingRequest>();
  cacheSaved = true;
  constructor(private storage?: StorageLike, private createWorker: () => WorkerLike = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), private timeoutMs = 30000) {
    try {
      const raw = storage?.getItem(CACHE_KEY) ?? storage?.getItem('bridgelab.analysis.cache.v3.5');
      if (raw && raw.length <= 2_000_000) {
        const file = JSON.parse(raw) as { engine: string; entries: [string, PositionResult][] };
        if (file.engine === ENGINE && Array.isArray(file.entries) && file.entries.length <= LIMIT) {
          for (const entry of file.entries) if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]?.key === entry[0]) this.cache.set(entry[0], entry[1]);
        }
      }
    } catch { this.cacheSaved = false; }
  }
  peek(position: AnalysisPosition): PositionResult | undefined {
    const cached = this.cache.get(position.key);
    if (!cached) return;
    if (!validateResult(position, cached)) { this.cache.delete(position.key); return; }
    this.cache.delete(position.key); this.cache.set(position.key, cached);
    return cached;
  }
  peekTable(request: DoubleDummyTableRequest): DoubleDummyTableResult | undefined {
    const cached = this.tableCache.get(request.key);
    if (!cached) return;
    if (!validateTableResult(request, cached)) { this.tableCache.delete(request.key); return; }
    this.tableCache.delete(request.key); this.tableCache.set(request.key, cached);
    return cached;
  }
  private persist() {
    if (!this.storage) return;
    try { this.storage.setItem(CACHE_KEY, JSON.stringify({ engine: ENGINE, entries: [...this.cache] })); this.cacheSaved = true; }
    catch { this.cacheSaved = false; }
  }
  private remember(result: PositionResult) {
    this.cache.delete(result.key); this.cache.set(result.key, result);
    while (this.cache.size > LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.persist();
  }
  private rememberTable(result: DoubleDummyTableResult) {
    this.tableCache.delete(result.key); this.tableCache.set(result.key, result);
    while (this.tableCache.size > TABLE_LIMIT) this.tableCache.delete(this.tableCache.keys().next().value!);
  }
  private startWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker(); this.worker = worker;
    worker.onmessage = event => {
      const { id, kind, result, error } = event.data as { id: number; kind?: 'position' | 'table'; result?: PositionResult | DoubleDummyTableResult; error?: string };
      const request = this.pending.get(id); if (!request) return;
      this.pending.delete(id); request.cleanup();
      if (error || !result || (kind !== undefined && kind !== request.kind)) { request.reject(new Error(error ?? '求解器返回的结果类型不匹配')); return; }
      if (request.kind === 'table') {
        const table = result as DoubleDummyTableResult;
        if (!validateTableResult(request.request, table)) request.reject(new Error('双明手总表未通过完整性检查'));
        else { this.rememberTable(table); request.resolve(table); }
      } else {
        const position = result as PositionResult;
        if (!validateResult(request.position, position)) request.reject(new Error('求解器返回的结果未通过完整性检查'));
        else { this.remember(position); request.resolve(position); }
      }
    };
    worker.onerror = () => this.cancel(new Error('本地求解器加载失败，可点击重新计算'));
    return worker;
  }
  solve(position: AnalysisPosition, signal?: AbortSignal): Promise<PositionResult> {
    if (signal?.aborted) return Promise.reject(new AnalysisCancelled());
    const cached = this.peek(position); if (cached) return Promise.resolve(cached);
    if (position.terminalTricks !== null) {
      const result: PositionResult = { key: position.key, engine: ENGINE, declarerTricks: position.terminalTricks, candidates: [], nodes: 0, elapsedMs: 0, heapBytes: 0 };
      this.remember(result); return Promise.resolve(result);
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => this.cancel(new AnalysisCancelled());
      const timer = setTimeout(() => this.cancel(new Error('此位置计算超过 30 秒，已停止求解。已算结果保留，可重试或换一个位置。')), this.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { kind: 'position', position, resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.startWorker().postMessage({ id, kind: 'position', position }); }
      catch (error) { this.pending.delete(id); cleanup(); reject(error instanceof Error ? error : new Error('无法创建本地求解器')); }
    });
  }
  solveTable(request: DoubleDummyTableRequest, signal?: AbortSignal): Promise<DoubleDummyTableResult> {
    if (signal?.aborted) return Promise.reject(new AnalysisCancelled());
    const cached = this.peekTable(request); if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => this.cancel(new AnalysisCancelled());
      const timer = setTimeout(() => this.cancel(new Error('双明手总表计算超过 30 秒，已停止求解。')), this.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { kind: 'table', request, resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.startWorker().postMessage({ id, kind: 'table', request }); }
      catch (error) { this.pending.delete(id); cleanup(); reject(error instanceof Error ? error : new Error('无法创建本地求解器')); }
    });
  }
  cancel(error: Error = new AnalysisCancelled()) {
    this.worker?.terminate(); this.worker = null;
    for (const request of this.pending.values()) { request.cleanup(); request.reject(error); }
    this.pending.clear();
  }
  dispose() { this.cancel(); this.persist(); }
}
