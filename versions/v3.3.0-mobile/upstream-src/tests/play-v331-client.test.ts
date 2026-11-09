import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlayAdvisorClient } from '../src/ai/play-advisor-client';
import { observe, type PlayObservation } from '../src/ai/observation';
import { exampleGame, replayLine } from '../src/analysis/model';
import { toRecord } from '../src/core/game';
import { type PlayDecision } from '../src/ai/play-advisor-types';
let obs: PlayObservation;
const request = () => ({ observation: obs, system: 'two-over-one' as const, strength: 'standard' as const });
beforeEach(() => { obs = observe(replayLine(toRecord(exampleGame('v331-client', 'NT', 'S'))).states[0]) as PlayObservation; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function workerFixture() {
  const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as Worker['onmessage'], onerror: null as Worker['onerror'] };
  const client = new PlayAdvisorClient(() => worker);
  const emit = (value: unknown) => worker.onmessage!.call(worker as unknown as Worker, { data: value } as MessageEvent);
  return { worker, client, emit };
}

function batch(): PlayDecision {
  return { cardId: obs.legalCards[0].id, candidates: obs.legalCards.map(card => ({ cardId: card.id, support: 1,
    expectedDeclarerTricks: 7, makeRate: 1, worstDeclarerTricks: 7, bestDeclarerTricks: 7 })),
    sampleCount: 1, attemptedSamples: 1, elapsedMs: 10, engine: 'sampled-dds', fallback: true,
    reasonTags: ['batch'], publicKey: 'public', diagnostics: { status: 'partial', completedSamples: 1, requestedSamples: 8 } };
}

test('hard timeout returns only the same request latest complete batch and terminates the overdue worker', async () => {
  vi.useFakeTimers();
  const { worker, client, emit } = workerFixture();
  const pending = client.advise({ ...request(), timeoutMs: 100 });
  emit({ id: 999, progress: batch() });
  emit({ id: 1, progress: batch() });
  await vi.advanceTimersByTimeAsync(250);
  const result = await pending;
  expect(result.engine).toBe('sampled-dds');
  expect(result.sampleCount).toBe(1);
  expect(result.diagnostics?.status).toBe('partial');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('incomplete progress is never retained and no-progress timeout rejects for the existing safety path', async () => {
  vi.useFakeTimers();
  const { client, emit } = workerFixture();
  const pending = client.advise({ ...request(), timeoutMs: 100 });
  const rejection = expect(pending).rejects.toThrow('超时');
  emit({ id: 1, progress: { ...batch(), candidates: [] } });
  await vi.advanceTimersByTimeAsync(250);
  await rejection;
});

test('explicit cancellation rejects even when a completed batch exists', async () => {
  const { client, emit } = workerFixture();
  const pending = client.advise(request());
  const rejection = expect(pending).rejects.toThrow('已取消');
  emit({ id: 1, progress: batch() });
  client.cancel();
  await rejection;
});

test('late events from a terminated worker cannot cancel or settle the replacement worker request', async () => {
  vi.useFakeTimers();
  const stale = workerFixture().worker;
  const fresh = workerFixture().worker;
  const client = new PlayAdvisorClient(vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(fresh));
  const first = client.advise({ ...request(), timeoutMs: 100 });
  const firstRejection = expect(first).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(250);
  await firstRejection;
  const second = client.advise(request());
  let settled = false;
  void second.then(() => { settled = true; });
  stale.onmessage!.call(stale as unknown as Worker, { data: { id: 2, result: batch() } } as MessageEvent);
  stale.onerror!.call(stale as unknown as Worker, {} as ErrorEvent);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(fresh.terminate).not.toHaveBeenCalled();
  fresh.onmessage!.call(fresh as unknown as Worker, { data: { id: 2, result: batch() } } as MessageEvent);
  expect(await second).toMatchObject({ engine: 'sampled-dds', sampleCount: 1 });
});
