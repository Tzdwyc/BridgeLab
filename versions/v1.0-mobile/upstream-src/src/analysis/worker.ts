import { DdsEngine } from './engine';
import { type AnalysisPosition, type DoubleDummyTableRequest } from './types';

type WorkerRequest = { id: number; kind: 'position'; position: AnalysisPosition }
  | { id: number; kind: 'table'; request: DoubleDummyTableRequest };
const scope = self as unknown as { onmessage: (event: MessageEvent<WorkerRequest>) => void; postMessage: (value: unknown) => void };
let engine: Promise<DdsEngine> | null = null;
scope.onmessage = async event => {
  const { id, kind } = event.data;
  try {
    engine ??= DdsEngine.create();
    const dds = await engine;
    const result = kind === 'table' ? dds.table(event.data.request) : dds.solve(event.data.position);
    scope.postMessage({ id, kind, result });
  } catch (error) {
    scope.postMessage({ id, kind, error: error instanceof Error ? error.message : 'DDS 初始化或求解失败' });
  }
};
