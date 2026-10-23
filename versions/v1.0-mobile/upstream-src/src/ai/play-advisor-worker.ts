import { advisePlay } from './play-advisor-core';
import { type PlayAdviceRequest } from './play-advisor-types';

type Request = { id: number; request: PlayAdviceRequest };
const scope = self as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (value: unknown) => void };
scope.onmessage = async event => {
  const { id, request } = event.data;
  try { scope.postMessage({ id, result: await advisePlay(request) }); }
  catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : '实战分析失败' }); }
};
