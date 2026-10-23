import { type PlayAdviceRequest, type PlayDecision } from './play-advisor-types';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
export class PlayAdvisorClient {
  private worker: WorkerLike | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: PlayDecision) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private createWorker: () => WorkerLike = () => new Worker(new URL('./play-advisor-worker.ts', import.meta.url), { type: 'module' })) {}
  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker(); this.worker = worker;
    worker.onmessage = event => {
      const { id, result, error } = event.data as { id: number; result?: PlayDecision; error?: string };
      const pending = this.pending.get(id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(id);
      if (error || !result) pending.reject(new Error(error ?? '实战分析返回空结果'));
      else pending.resolve(result);
    };
    worker.onerror = () => this.cancel(new Error('实战分析 Worker 加载失败'));
    return worker;
  }
  advise(request: PlayAdviceRequest): Promise<PlayDecision> {
    const id = ++this.sequence;
    const limit = request.timeoutMs ?? (request.strength === 'challenge' ? 2500 : 1200);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(new Error('实战分析超时，已切换安全打法')), limit + 150);
      this.pending.set(id, { resolve, reject, timer });
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
