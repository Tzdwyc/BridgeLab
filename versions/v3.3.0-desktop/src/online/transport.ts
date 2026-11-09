export const defaultPort = 51894;

export interface Endpoint {
  address: string;
  port: number;
}

export function parseEndpoint(value: string): Endpoint {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(value.trim());
  if (!match) throw new Error('请输入房主显示的 IPv4 地址和端口。');
  const [a, b, ...rest] = match[1].split('.').map(Number);
  const port = match[2] ? Number(match[2]) : defaultPort;
  const privateAddress = a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
  if (!privateAddress || [b, ...rest].some(octet => octet > 255) || port < 1 || port > 65535) {
    throw new Error('请输入房主显示的局域网地址和有效端口。');
  }
  return { address: [a, b, ...rest].join('.'), port };
}

export class LanHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function lanApi<T>(operation: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/lan/' + operation, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new LanHttpError(response.status, typeof error?.error === 'string' ? error.error : '连接中断，请检查房主及 Wi-Fi。');
  }
  return response.json() as Promise<T>;
}
