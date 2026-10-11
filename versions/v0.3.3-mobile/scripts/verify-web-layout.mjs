import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'assets/www');
const require = createRequire(resolve(root, '../v0.3.3/package.json'));
const { chromium } = require('@playwright/test');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = resolve(webRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(webRoot + '\\')) throw new Error('Outside web root');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [orientation, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('打牌强度').selectOption('basic');
    await page.getByLabel('机器人行动速度').selectOption('0');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '新牌局', exact: true }).click();
    await page.getByLabel('随机种子', { exact: true }).fill('ui-human-declarer-v1');
    await page.getByRole('dialog').getByRole('button', { name: '开始新牌局', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="app"]')?.getAttribute('data-controller') === 'S');
    const table = page.getByTestId('bridge-table');
    await table.waitFor({ state: 'visible' });
    const historyInsideTable = await table.getByLabel('叫牌历史', { exact: true }).count() === 1;
    const biddingInsideTable = await table.getByLabel('叫牌框', { exact: true }).count() === 1;
    if (!historyInsideTable || !biddingInsideTable) throw new Error('New central table layout missing');
    const mobileCssLoaded = await page.evaluate(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/mobile.css')));
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const screenshot = resolve(root, `docs/new-table-${orientation}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({ orientation, viewport, screenshot, historyInsideTable, biddingInsideTable, mobileCssLoaded, noHorizontalOverflow, pageErrors: errors });
    if (!mobileCssLoaded || !noHorizontalOverflow || errors.length) throw new Error(`Web layout checks failed: ${orientation}`);
    await context.close();
  }
  await writeFile(resolve(root, 'docs/WEB_LAYOUT_VALIDATION.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), servedAssets: webRoot, evidenceBoundary: 'Chromium mobile web viewport; no Android device launch', results }, null, 2));
  console.log('New table layout verified with bundled mobile CSS in portrait and landscape web viewports.');
} finally {
  await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
