import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'assets/www');
const require = createRequire(resolve(root, '../v0.3.6/package.json'));
const { chromium } = require('@playwright/test');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = resolve(webRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(webRoot + sep)) throw new Error('Outside web root');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const url = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [];
const nativeFilesSource = await readFile(resolve(root, 'lib/native_files.dart'), 'utf8');
const nativeFilesScript = nativeFilesSource.match(/const installNativeFilesScript = r'''([\s\S]*?)'''/)[1];
try {
  for (const [orientation, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.BridgeLabFiles = { postMessage: message => {
        const request = JSON.parse(message);
        if (request.action === 'saveFile') {
          window.__nativeFileExport = { name: request.name, text: request.text };
          queueMicrotask(() => window.__bridgeNativeFilesComplete({ id: request.id, value: true }));
        } else {
          queueMicrotask(() => window.__bridgeNativeFilesComplete({ id: request.id, value: window.__nativeFileExport || null }));
        }
      } };
    });
    await context.addInitScript({ content: nativeFilesScript });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByTestId('home-page').waitFor({ state: 'visible' });
    const homeNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/home-${orientation}.png`), fullPage: true });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('打牌强度').selectOption('basic');
    await page.getByLabel('机器人行动速度').selectOption('0');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('link', { name: '新牌局', exact: true }).click();
    const setupNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/setup-${orientation}.png`), fullPage: true });
    await page.getByText('复现发牌（可选）', { exact: true }).click();
    await page.getByLabel('随机种子', { exact: true }).fill('ui-human-declarer-v1');
    await page.getByLabel('本场打牌强度', { exact: true }).selectOption('basic');
    await page.getByRole('button', { name: '开始比赛 →', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="app"]')?.getAttribute('data-controller') === 'S');
    await page.mouse.move(0, 0);
    const table = page.getByTestId('bridge-table');
    await table.waitFor({ state: 'visible' });
    const historyInsideTable = await table.getByLabel('叫牌历史', { exact: true }).count() === 1;
    const biddingInsideTable = await table.getByLabel('叫牌框', { exact: true }).count() === 1;
    if (!historyInsideTable || !biddingInsideTable) throw new Error('New central table layout missing');
    const mobileCssLoaded = await page.evaluate(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/mobile.css')));
    const tableSeatCount = await table.locator('[data-testid^="table-seat-"]').count();
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const screenshot = resolve(root, `docs/new-table-${orientation}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.getByRole('link', { name: '历史牌局', exact: true }).click();
    await page.getByTestId('history-page').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '导出存档', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '牌局存档已导出。' }).waitFor();
    const nativeExport = await page.evaluate(() => window.__nativeFileExport);
    if (!nativeExport?.name.endsWith('.json') || !nativeExport.text.includes('bridgelab')) throw new Error('Native bridge did not receive archive JSON');
    await page.getByRole('button', { name: '导入存档', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /已导入/ }).waitFor();
    const historyNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/history-${orientation}.png`), fullPage: true });
    await page.getByRole('link', { name: '新牌局', exact: true }).click();
    await page.getByRole('button', { name: /双桌 IMP/ }).click();
    await page.getByLabel('本场打牌强度', { exact: true }).selectOption('basic');
    await page.getByRole('button', { name: '开始比赛 →', exact: true }).click();
    const score = page.getByLabel('双方 IMP 比分', { exact: true });
    await score.waitFor({ state: 'visible' });
    const impScoreText = await score.innerText();
    if (!/我方 0 : 0 对方 · 净 0 IMP/.test(impScoreText)) throw new Error(`Both team scores and net missing: ${impScoreText}`);
    const impNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: resolve(root, `docs/imp-score-${orientation}.png`), fullPage: true });
    results.push({ orientation, viewport, screenshot, historyInsideTable, biddingInsideTable, tableSeatCount, mobileCssLoaded, noHorizontalOverflow, homeNoHorizontalOverflow, setupNoHorizontalOverflow, historyNoHorizontalOverflow, nativeBridgeArchiveRoundtrip: true, impScoreText, impNoHorizontalOverflow, pageErrors: errors });
    if (tableSeatCount !== 4 || !mobileCssLoaded || !noHorizontalOverflow || !homeNoHorizontalOverflow || !setupNoHorizontalOverflow || !historyNoHorizontalOverflow || !impNoHorizontalOverflow || errors.length) throw new Error(`Web layout checks failed: ${orientation}`);
    await context.close();
  }
  const sync = JSON.parse(await readFile(resolve(root, 'docs/SYNC_MANIFEST.json'), 'utf8'));
  const mainBundleSha256 = createHash('sha256').update(await readFile(resolve(webRoot, 'assets', sync.desktopMainBundle))).digest('hex');
  await writeFile(resolve(root, 'docs/WEB_LAYOUT_VALIDATION.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), servedAssets: webRoot, desktopMainBundle: sync.desktopMainBundle, mainBundleSha256, browserVersion: browser.version(), browserExecutable: executablePath || 'Playwright bundled Chromium', evidenceBoundary: 'Chromium mobile web viewport; no Android device launch', results }, null, 2));
  console.log('New table layout verified with bundled mobile CSS in portrait and landscape web viewports.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
