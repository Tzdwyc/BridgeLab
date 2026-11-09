import { advisePlay, createPlayAdvisorRuntime } from './play-advisor-core';
import { type PlayAdviceRequest } from './play-advisor-types';

type Request = { id: number; request: PlayAdviceRequest };
const scope = self as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (value: unknown) => void };
const runtime = createPlayAdvisorRuntime();
scope.onmessage = async event => {
  const { id, request } = event.data;
  try {
    const result = await advisePlay(request, undefined, { ...runtime,
      onProgress: progress => scope.postMessage({ id, progress }) });
    scope.postMessage({ id, result });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : '实战分析失败' });
  }
};
