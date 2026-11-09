import { type PlayAdviceRequest, type PlayDecision } from './play-advisor-types';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
type Pending = {
  resolve: (value: PlayDecision) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  request: PlayAdviceRequest;
  started: number;
  latest?: PlayDecision;
};

function completeBatch(request: PlayAdviceRequest, result: PlayDecision): boolean {
  const legal = new Set(request.observation.legalCards.map(card => card.id));
  return result.engine === 'sampled-dds' && result.sampleCount > 0 && legal.has(result.cardId)
    && result.candidates.length === legal.size
    && new Set(result.candidates.map(candidate => candidate.cardId)).size === legal.size
    && result.candidates.every(candidate => legal.has(candidate.cardId) && candidate.support === result.sampleCount
      && Number.isFinite(candidate.expectedDeclarerTricks) && Number.isFinite(candidate.makeRate));
}

export class PlayAdvisorClient {
  private worker: WorkerLike | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  constructor(private createWorker: () => WorkerLike = () => new Worker(new URL('./play-advisor-worker.ts', import.meta.url), { type: 'module' })) {}
  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker(); this.worker = worker;
    worker.onmessage = event => {
      if (this.worker !== worker) return;
      const { id, result, progress, error } = event.data as { id: number; result?: PlayDecision; progress?: PlayDecision; error?: string };
      const pending = this.pending.get(id); if (!pending) return;
      if (progress) {
        if (completeBatch(pending.request, progress) && progress.sampleCount >= (pending.latest?.sampleCount ?? 0)) pending.latest = progress;
        return;
      }
      clearTimeout(pending.timer); this.pending.delete(id);
      if (error || !result) {
        if (pending.latest) pending.resolve(this.partial(pending.latest, error ?? '实战分析返回空结果', pending.started));
        else pending.reject(new Error(error ?? '实战分析返回空结果'));
      } else pending.resolve(result);
    };
    worker.onerror = () => { if (this.worker === worker) this.recoverAndStop(new Error('实战分析 Worker 加载失败')); };
    return worker;
  }
  private partial(latest: PlayDecision, reason: string, started: number): PlayDecision {
    return { ...latest, elapsedMs: Math.max(latest.elapsedMs, performance.now() - started), fallback: true, reasonTags: [...latest.reasonTags, reason],
      diagnostics: { ...latest.diagnostics, status: 'partial', requestedSamples: latest.diagnostics?.requestedSamples ?? latest.sampleCount,
        completedSamples: latest.sampleCount, stopReason: reason } };
  }
  /** A crashed or overdue worker may still have delivered a complete, usable batch. */
  private recoverAndStop(error: Error) {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      if (pending.latest) pending.resolve(this.partial(pending.latest, error.message, pending.started));
      else pending.reject(error);
    }
    this.pending.clear();
  }
  advise(request: PlayAdviceRequest): Promise<PlayDecision> {
    const id = ++this.sequence;
    const limit = request.timeoutMs ?? (request.strength === 'challenge' ? 2500 : 1200);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.recoverAndStop(new Error('实战分析超时，已保留完整批次或切换安全打法')), limit + 150);
      this.pending.set(id, { resolve, reject, timer, request, started: performance.now() });
      try { this.ensureWorker().postMessage({ id, request: { ...request, timeoutMs: limit } }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error('无法启动实战分析')); }
    });
  }
  cancel(error = new Error('实战分析已取消')) {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  dispose() { this.cancel(); }
}
