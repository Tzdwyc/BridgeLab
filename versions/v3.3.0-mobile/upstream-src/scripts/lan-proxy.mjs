const limit = 64 * 1024;

function reply(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function privateAddress(address) {
  if (typeof address !== 'string' || !/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  return octets.every(n => n <= 255) && octets.join('.') === address &&
    (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}

async function readJson(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('LAN message too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function lanProxy(req, res, path) {
  const host = req.headers.host;
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? '') ||
      (req.headers.origin && req.headers.origin !== 'http://' + host) ||
      (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
    return reply(res, 403, { error: '请从本机 BridgeLab 打开联机入口。' });
  }
  if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
    return reply(res, 405, { error: '无效的联机请求。' });
  }
  if (path === '/api/lan/capabilities') {
    req.resume();
    return reply(res, 200, { canHost: false });
  }
  if (path !== '/api/lan/connect') return reply(res, 404, { error: '请使用 Android APP 创建房间。' });
  let body;
  try { body = await readJson(req); }
  catch { return reply(res, 400, { error: '联机请求格式无效。' }); }
  const { address, port, payload } = body ?? {};
  if (!privateAddress(address) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return reply(res, 400, { error: '房主局域网地址或联机请求无效。' });
  }
  try {
    const response = await fetch('http://' + address + ':' + port + '/api/lan/message', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7500),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      throw new Error('Invalid room response');
    }
    // Convert fetch byte chunks to Buffer before reading bounded JSON.
    const stream = (async function* () { for await (const chunk of response.body) yield Buffer.from(chunk); })();
    reply(res, 200, await readJson(stream));
  } catch {
    reply(res, 502, { error: '无法连接房主。请确认房间仍开放，且设备接在同一 Wi-Fi。' });
  }
}
