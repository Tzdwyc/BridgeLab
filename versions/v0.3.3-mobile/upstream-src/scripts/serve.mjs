import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.BRIDGELAB_PORT || 5193);
if (!existsSync(resolve(root, 'index.html'))) {
  console.error('未找到构建文件。请先运行 npm install 和 npm run build。'); process.exit(1);
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
mime['.wasm'] = 'application/wasm';
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(path));
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.on('error', error => { console.error(`启动失败：${error.message}。可用 BRIDGELAB_PORT 环境变量更换端口。`); process.exit(1); });
server.listen(port, '0.0.0.0', () => {
  console.log(`BridgeLab v0.3.3 已启动：http://localhost:${port}`);
  console.log('关闭此窗口会停止本地服务。此服务只提供本地静态文件，无云端 AI。');
  for (const interfaces of Object.values(networkInterfaces())) for (const address of interfaces ?? []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`同一局域网电脑：http://${address.address}:${port}（离线缓存请使用本机 localhost）`);
  }
});
