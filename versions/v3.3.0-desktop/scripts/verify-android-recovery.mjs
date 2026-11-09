import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.resolve(root, '../v0.3.5-mobile');
const original = path.join(root, 'artifacts/stack-hotfix-before/dist');
const fixed = path.join(root, 'dist');
const origin = 'http://127.0.0.1:51893';
const sessionKey = 'bridgelab.session.v3.5';
const nativeSource = await readFile(path.join(mobile, 'lib/diagnostics.dart'), 'utf8');
const marker = "const packagedBundleRecoveryTemplate = r'''";
const start = nativeSource.indexOf(marker) + marker.length;
assert(start >= marker.length, 'Native recovery template is missing');
const template = nativeSource.slice(start, nativeSource.indexOf("''';", start));
const bundleName = html => html.match(/assets\/(index-[^"']+\.js)/)[1];
const originalBundle = bundleName(await readFile(path.join(original, 'index.html'), 'utf8'));
const fixedBundle = bundleName(await readFile(path.join(fixed, 'index.html'), 'utf8'));
assert.notEqual(originalBundle, fixedBundle, 'Build the repaired v0.3.5 before validation');
const recovery = template.replace('__EXPECTED_BUNDLE_JSON__', JSON.stringify(fixedBundle));
assert(!/localStorage\.|indexedDB\.|caches\.delete/.test(recovery));

const compiled = await build({ stdin: { contents: "export {incidentSeed, incidentSession} from './tests/fixtures/android-stack-incident.ts'; export {encodeSession, decodeSession} from './src/persistence/session.ts';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false });
const { Module } = createRequire(import.meta.url)('node:module');
const fixture = new Module(path.join(root, 'android-recovery-fixture.cjs'));
fixture._compile(compiled.outputFiles[0].text, fixture.filename = path.join(root, 'android-recovery-fixture.cjs'));
const { incidentSeed, incidentSession, encodeSession, decodeSession } = fixture.exports;
const saved = encodeSession(incidentSession());
const hash = value => createHash('sha256').update(value).digest('hex');

let current = original;
let holdOldWorker = true;
const server = createServer(async (req, res) => {
  const uri = new URL(req.url, origin);
  const selected = uri.pathname === '/sw.js' && holdOldWorker ? original : current;
  const relative = decodeURIComponent(uri.pathname === '/' ? '/index.html' : uri.pathname);
  const file = path.resolve(selected, '.' + relative);
  if (!file.startsWith(selected + path.sep)) { res.writeHead(400); res.end(); return; }
  try {
    const body = await readFile(file);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(51893, '127.0.0.1', resolve); });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; V2279A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.193 Mobile Safari/537.36' });
  await context.addInitScript(({ raw, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  }, { raw: saved, key: sessionKey });
  let page = await context.newPage();
  const originalErrors = [];
  page.on('console', message => { if (message.type() === 'error') originalErrors.push(message.text()); });
  await page.goto(`${origin}/index.html#/table`);
  await expect(page.getByText('BridgeLab 暂时无法显示牌桌')).toBeVisible();
  assert(originalErrors.some(message => message.includes('Maximum call stack size exceeded')));
  await page.evaluate(async () => {
    localStorage.setItem('bridgelab.session.v3.4', 'legacy-save-sentinel');
    localStorage.setItem('upgrade-sentinel', 'retained');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('upgrade-preservation-sentinel', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saved');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('saved', 'readwrite');
        tx.objectStore('saved').put('retained', 'proof');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    await navigator.serviceWorker.register('/sw.js');
    await Promise.race([navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Old service worker did not activate')), 45000))]);
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByText('BridgeLab 暂时无法显示牌桌')).toBeVisible();
  current = fixed;
  await page.close();
  page = await context.newPage();
  await page.goto(`${origin}/index.html#/table`);
  await expect(page.getByText('BridgeLab 暂时无法显示牌桌')).toBeVisible();
  const staleBundle = await page.evaluate(() => Array.from(document.scripts).map(script => script.src).find(src => /assets\/index-/.test(src)));
  assert(staleBundle.endsWith(originalBundle));
  console.log('Old v0.3.5 exception and cached old service worker reproduced.');
  const recoveredErrors = [];
  page.on('console', message => { if (message.type() === 'error') recoveredErrors.push(message.text()); });
  page.on('pageerror', error => recoveredErrors.push(error.message));
  holdOldWorker = false;
  await page.evaluate(recovery).catch(error => {
    if (!/Execution context was destroyed/.test(error.message)) throw error;
  });
  await expect(page.getByText('选择叫品', { exact: true })).toBeVisible();
  await expect(page.getByText('BridgeLab 暂时无法显示牌桌')).toHaveCount(0);
  await page.evaluate(recovery);
  assert.equal(await page.evaluate(() => window.__bridgePackagedBundleVerified), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), saved);
  await page.reload();
  await expect(page.getByText('选择叫品', { exact: true })).toBeVisible();
  await page.evaluate(recovery);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), saved);
  const sentinels = await page.evaluate(async () => ({
    legacy: localStorage.getItem('bridgelab.session.v3.4'), other: localStorage.getItem('upgrade-sentinel'),
    indexedDb: await new Promise((resolve, reject) => {
      const request = indexedDB.open('upgrade-preservation-sentinel', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('saved').objectStore('saved').get('proof');
        get.onsuccess = () => { db.close(); resolve(get.result); };
        get.onerror = () => reject(get.error);
      };
    })
  }));
  assert.deepEqual(sentinels, { legacy: 'legacy-save-sentinel', other: 'retained', indexedDb: 'retained' });
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/android-cached-save-recovered.png'), fullPage: true });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('机器人行动速度').selectOption('0');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText('● 离线资源已缓存', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('选择叫品', { exact: true })).toBeVisible();
  await expect(page.getByText('● 离线模式', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '不叫 Pass', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).current.actions.length, sessionKey)).toBeGreaterThan(3);
  let humanDecisions = 1;
  for (let guard = 0; guard < 100; guard++) {
    await expect.poll(async () => {
      const app = page.getByTestId('app');
      return ['complete', 'passedOut'].includes(await app.getAttribute('data-phase')) || await app.getAttribute('data-controller') === 'S';
    }, { timeout: 30000 }).toBe(true);
    const phase = await page.getByTestId('app').getAttribute('data-phase');
    if (phase === 'complete' || phase === 'passedOut') break;
    const rejectClaim = page.getByRole('button', { name: '不同意，继续打', exact: true });
    if (await rejectClaim.isVisible()) { await rejectClaim.click(); continue; }
    if (phase === 'auction') await page.getByRole('button', { name: '不叫 Pass', exact: true }).click();
    else await page.locator('button[data-card]:not([disabled])').first().click();
    humanDecisions++;
  }
  await expect(page.getByTestId('result')).toBeVisible();
  const completedRaw = await page.evaluate(key => localStorage.getItem(key), sessionKey);
  const completed = decodeSession(completedRaw);
  assert.equal(completed.game.board, 20);
  assert.equal(completed.game.seed, incidentSeed);
  assert.equal(completed.game.phase, 'complete');
  assert.equal(completed.game.completedTricks.length, 13);
  assert.equal(completed.game.actions.filter(action => action.kind === 'play').length, 52);
  assert.equal(completed.history.length, 19);
  await page.reload();
  await expect(page.getByTestId('result')).toBeVisible();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), completedRaw);
  await page.screenshot({ path: path.join(root, 'artifacts/android-recovered-offline-complete.png'), fullPage: true });
  assert.deepEqual(recoveredErrors, []);
  const report = {
    checkedAt: new Date().toISOString(), version: '0.3.5', originalBundle, fixedBundle,
    originalDist: original, repairedDist: fixed, nativeRecoverySource: path.join(mobile, 'lib/diagnostics.dart'),
    origin, sessionKey, exactCurrentBoard: 20, exactCurrentSeed: incidentSeed,
    originalPrefix: 'W:Pass N:2H E:X', originalErrorReproduced: true,
    originalError: originalErrors.find(message => message.includes('Maximum call stack size exceeded')).slice(0, 1500),
    staleServiceWorkerReproduced: true, nativeRecoveryScriptUsed: true,
    savedSessionSha256: hash(saved), rawSessionPreservedOnRecoveryAndReload: true,
    legacySessionAndOtherLocalStoragePreserved: true, indexedDbSentinelPreserved: true,
    canContinueBidding: true, offlineReloadAndFullBoard: true,
    completedBoard: 20, completedTricks: 13, actualPlayActions: 52, humanDecisions,
    completedSessionSha256: hash(completedRaw), newErrors: recoveredErrors,
    historyFixture: '19 synthetic passouts; current board uses the reported seed and actions',
    browserVersion: browser.version(), browserExecutable: executablePath || 'Playwright bundled Chromium',
    environment: 'Chromium mobile viewport and Android user agent; this is not an Android WebView or physical-device test',
    physicalDeviceTested: false
  };
  await writeFile(path.join(root, 'artifacts/android-recovery-validation.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(mobile, 'docs/STACK_HOTFIX_RECOVERY_VALIDATION.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
