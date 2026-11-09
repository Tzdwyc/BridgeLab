import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { lanProxy } from './lan-proxy.mjs';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.BRIDGELAB_PORT || 5215);
if (!existsSync(resolve(root, 'index.html'))) {
  console.error('未找到构建文件。请先运行 npm install 和 npm run build。'); process.exit(1);
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
mime['.wasm'] = 'application/wasm';
mime['.woff2'] = 'font/woff2';
mime['.txt'] = 'text/plain; charset=utf-8';
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/lan/')) { void lanProxy(req, res, pathname); return; }
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(path));
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.on('error', error => { console.error(`启动失败：${error.message}。可用 BRIDGELAB_PORT 环境变量更换端口。`); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  console.log(`BridgeLab v3.3.0 已启动：http://127.0.0.1:${port}`);
  console.log('桌面端可加入 Android APP 创建的局域网房间。');
});
