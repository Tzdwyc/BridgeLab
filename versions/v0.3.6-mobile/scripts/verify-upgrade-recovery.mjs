import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.resolve(mobile, '../v0.3.6');
const oldDesktop = path.resolve(mobile, '../v0.3.5');
const oldAssets = path.resolve(mobile, '../v0.3.5-mobile/assets/www');
const newAssets = path.join(mobile, 'assets/www');
const require = createRequire(path.join(desktop, 'package.json'));
const { build } = require('esbuild');
const { Module } = require('node:module');
const { chromium, expect } = require('@playwright/test');
const compile = async (directory, contents) => {
  const result = await build({ stdin: { contents, resolveDir: directory }, bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = new Module(path.join(directory, 'recovery-fixture.cjs'));
  module._compile(result.outputFiles[0].text, module.filename = path.join(directory, 'recovery-fixture.cjs'));
  return module.exports;
};
const fixture = await compile(oldDesktop, "export {incidentSeed, incidentSession} from './tests/fixtures/android-stack-incident.ts'; export {encodeSession} from './src/persistence/session.ts';");
const { decodeSession } = await compile(desktop, "export {decodeSession} from './src/persistence/session.ts';");
const saved = fixture.encodeSession(fixture.incidentSession());
const previousKey = 'bridgelab.session.v3.5', currentKey = 'bridgelab.session.v3.6';
const bundleName = html => html.match(/assets\/(index-[^"']+\.js)/)[1];
const previousBundle = bundleName(await readFile(path.join(oldAssets, 'index.html'), 'utf8'));
const currentBundle = bundleName(await readFile(path.join(newAssets, 'index.html'), 'utf8'));
assert.notEqual(previousBundle, currentBundle);
const nativeSource = await readFile(path.join(mobile, 'lib/diagnostics.dart'), 'utf8');
const recovery = nativeSource.match(/const packagedBundleRecoveryTemplate = r'''([\s\S]*?)'''/)[1]
  .replace('__EXPECTED_BUNDLE_JSON__', JSON.stringify(currentBundle));
assert(!/localStorage\.|indexedDB\.|caches\.delete/.test(recovery));
let activeAssets = oldAssets, holdPreviousWorker = true;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const selected = url.pathname === '/sw.js' && holdPreviousWorker ? oldAssets : activeAssets;
  const filename = path.resolve(selected, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!filename.startsWith(selected + path.sep)) { response.writeHead(400); response.end(); return; }
  try {
    const bytes = await readFile(filename);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
    response.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ raw, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { raw: saved, key: previousKey });
  let page = await context.newPage();
  await page.goto(origin + '/index.html');
  await page.getByTestId('bridge-table').waitFor();
  await page.evaluate(async () => {
    localStorage.setItem('upgrade-sentinel', 'retained');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('upgrade-preservation-sentinel', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saved');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('saved', 'readwrite');
        tx.objectStore('saved').put('retained', 'proof');
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), saved);
  activeAssets = newAssets;
  await page.close();
  page = await context.newPage();
  await page.goto(origin + '/index.html');
  await page.getByTestId('bridge-table').waitFor();
  const staleBundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /assets\/index-/.test(src)));
  assert(staleBundle.endsWith(previousBundle), 'Previous Workbox cache did not serve the old HTML');
  // Open the historical route directly after upgrade; it must wait for the
  // old-save archive migration instead of rendering an empty list.
  await page.evaluate(() => history.replaceState(null, '', '/index.html#/history'));
  page.on('pageerror', error => errors.push(error.message));
  holdPreviousWorker = false;
  await page.evaluate(recovery).catch(error => { if (!/Execution context was destroyed/.test(error.message)) throw error; });
  const migratedHistory = page.getByTestId('history-page');
  await migratedHistory.waitFor();
  await migratedHistory.locator('a[href^="#/history/"]').first().waitFor();
  const migratedArchiveCount = await migratedHistory.locator('a[href^="#/history/"]').count();
  assert.equal(migratedArchiveCount, 1, 'Direct history should show one migrated legacy archive');
  await page.screenshot({ path: path.join(mobile, 'docs/upgrade-direct-history.png'), fullPage: true });
  await page.getByRole('link', { name: /返回首页/ }).click();
  await page.getByTestId('home-page').waitFor();
  await page.getByTestId('continue-match').waitFor();
  await page.evaluate(recovery);
  assert.equal(await page.evaluate(() => window.__bridgePackagedBundleVerified), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), saved);
  assert.equal(await page.evaluate(key => localStorage.getItem(key + '.backup.v3.6'), previousKey), saved);
  await expect(page.getByTestId('continue-match')).toContainText('第 20 副');
  await page.screenshot({ path: path.join(mobile, 'docs/upgrade-recovered-home.png'), fullPage: true });
  await page.getByTestId('continue-match').click();
  await page.getByTestId('bridge-table').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('机器人行动速度').selectOption('0');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  // Loading a legacy save is read-only except its backup; the first explicit
  // preference/action persists the current-version session key.
  const migrated = decodeSession(await page.evaluate(key => localStorage.getItem(key), currentKey));
  assert.equal(migrated.game.board, 20);
  assert.equal(migrated.game.seed, fixture.incidentSeed);
  assert.equal(migrated.game.actions.length, 3);
  assert.equal(migrated.history.length, 19);
  await expect(page.getByText('● 离线资源已缓存', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('bridge-table').waitFor();
  await page.evaluate(recovery);
  assert.equal(await page.evaluate(() => window.__bridgePackagedBundleVerified), true);
  await expect(page.getByText('● 离线模式', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '不叫 Pass', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '不叫 Pass', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).current.actions.length, currentKey)).toBeGreaterThan(3);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), saved);
  const sentinels = await page.evaluate(async () => ({ local: localStorage.getItem('upgrade-sentinel'), indexed: await new Promise((resolve, reject) => {
    const request = indexedDB.open('upgrade-preservation-sentinel', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, get = db.transaction('saved').objectStore('saved').get('proof');
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
  }) }));
  assert.deepEqual(sentinels, { local: 'retained', indexed: 'retained' });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(mobile, 'docs/upgrade-offline-continued.png'), fullPage: true });
  const report = { verifiedAt: new Date().toISOString(), previousVersion: '0.3.5+39', version: '0.3.6+40', previousBundle, currentBundle,
    origin, packagedOrigin: 'http://127.0.0.1:51893', originBoundary: 'Ephemeral test port, with one stable origin retained across old/new phases. Native wrapper fixed port checked separately.',
    previousRawSha256: createHash('sha256').update(saved).digest('hex'), stalePreviousWorkboxCacheReproduced: true, exactNativeRecoveryScriptExecuted: true,
    rawV035Unchanged: true, migrationBackupMatchesV035: true, migratedBoard: 20, migratedSeed: fixture.incidentSeed, migratedActions: 3, migratedHistoryCount: 19,
    directHistoryContainsMigratedArchive: true, migratedArchiveCount, homeContinueVisible: true, offlineReloadAndContinuedBid: true, localStorageAndIndexedDbSentinelsPreserved: true, errors,
    fixtureBoundary: 'Reported board-20 seed and actions; 19 prior passouts are synthetic continuity fixtures.',
    evidenceBoundary: 'Chromium mobile browser emulation with real Workbox/cache and exact native JavaScript. Android WebView, installation and physical device not tested.',
    browserVersion: browser.version(), browserExecutable: executablePath || 'Playwright Chromium' };
  await writeFile(path.join(mobile, 'docs/UPGRADE_RECOVERY_VALIDATION.json'), JSON.stringify(report, null, 2));
  console.log('v0.3.5+39 cached bundle → v0.3.6 migration, native recovery, home continue and offline bid passed.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
