import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.resolve(mobile, '../v0.3.7');
const oldDesktop = path.resolve(mobile, 'artifacts/previous-code43/upstream-src');
const oldAssets = path.resolve(mobile, 'artifacts/upgrade-code43-assets');
const newAssets = path.join(mobile, 'assets/www');
const previousExtraction = JSON.parse(await readFile(path.join(mobile, 'docs/CODE43_ASSET_EXTRACTION.json'), 'utf8'));
assert.equal(previousExtraction.version, '0.3.7+43');
const require = createRequire(path.resolve(mobile, '../v0.3.6/package.json'));
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
const { makeCompletedArchive } = await compile(oldDesktop, `
import {createMatch,updateMatchTable,validateMatch} from './src/match/engine.ts';
import {replay,applyCall,playCard} from './src/core/game.ts';
import {legalCards} from './src/core/play.ts';
export function makeCompletedArchive(){let match=createMatch('v36-preserved-archive',{mode:'total',assisted:true,seed:'upgrade-archive-fixture'},{biddingSystem:'sayc',playStrength:'basic'});let game=replay(match.boards[0].main);for(const call of [{kind:'bid',level:1,strain:'NT'},{kind:'pass'},{kind:'pass'},{kind:'pass'}])game=applyCall(game,game.turn,call);while(game.phase==='play')game=playCard(game,game.turn,legalCards(game.hands[game.turn],game.currentTrick)[0].id);match=updateMatchTable(match,'main',game);return validateMatch({...match,status:'completed',endedAt:match.updatedAt});}
`);
const archiveFixture = makeCompletedArchive();
const { decodeSession } = await compile(desktop, "export {decodeSession} from './src/persistence/session.ts';");
const saved = fixture.encodeSession(fixture.incidentSession());
const previousKey = 'bridgelab.session.v3.6', currentKey = previousKey;
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

async function chooseSetting(page, label, buttonName) {
  for (let i=0;i<10;i++) {
    const group=page.getByRole('group',{name:label,exact:true});
    if (await group.count() && await group.isVisible()) {
      await group.getByRole('button',{name:buttonName}).click(); return;
    }
    const next=page.getByRole('button',{name:'下一页游戏设置',exact:true});
    if (!await next.count() || !await next.isEnabled()) break;
    await next.click();
  }
  throw new Error('Settings page not found: '+label);
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ raw, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { raw: saved, key: previousKey });
  let page = await context.newPage();
  await page.goto(origin + '/index.html#/table');
  await page.getByTestId('bridge-table').waitFor();
  await page.evaluate(async archive => {
    await new Promise((resolve,reject)=>{const r=indexedDB.open('bridgelab.library.v3.6',1);r.onupgradeneeded=()=>r.result.createObjectStore('matches',{keyPath:'id'});r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result, tx=db.transaction('matches','readwrite');tx.objectStore('matches').put(archive);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
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
  }, archiveFixture);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), saved);
  activeAssets = newAssets;
  await page.close();
  page = await context.newPage();
  await page.goto(origin + '/index.html#/table');
  await page.getByTestId('bridge-table').waitFor();
  const staleBundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /assets\/index-/.test(src)));
  assert(staleBundle.endsWith(previousBundle), 'Previous Workbox cache did not serve the old HTML');
  // The same v3.6 IndexedDB archive must remain available after the UI upgrade.
  await page.evaluate(() => history.replaceState(null, '', '/index.html#/history'));
  page.on('pageerror', error => errors.push(error.message));
  holdPreviousWorker = false;
  await page.evaluate(recovery).catch(error => { if (!/Execution context was destroyed/.test(error.message)) throw error; });
  const migratedHistory = page.getByTestId('history-page');
  await migratedHistory.waitFor();
  await migratedHistory.locator('a[href^="#/history/"]').first().waitFor();
  const migratedArchiveCount = await migratedHistory.locator('a[href^="#/history/"]').count();
  assert.equal(migratedArchiveCount, 1, 'Direct history should show the existing v3.6 archive');
  await page.screenshot({ path: path.join(mobile, 'docs/upgrade-direct-history.png'), fullPage: true });
  await page.getByTestId('history-page').getByRole('link', { name: /首页/ }).click();
  await page.getByTestId('home-page').waitFor();
  await page.getByTestId('continue-match').waitFor();
  await page.evaluate(recovery);
  assert.equal(await page.evaluate(() => window.__bridgePackagedBundleVerified), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), saved);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), saved);
  assert.equal(await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.7')), null);
  await expect(page.getByTestId('continue-match')).toContainText('第 20 副');
  await page.screenshot({ path: path.join(mobile, 'docs/upgrade-recovered-home.png'), fullPage: true });
  await page.getByTestId('continue-match').click();
  await page.getByTestId('bridge-table').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await chooseSetting(page, '机器人行动速度', '即时');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  // An explicit preference still persists the unchanged v3.6 schema and key.
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
  const archiveAfter = await page.evaluate(() => new Promise((resolve,reject)=>{const r=indexedDB.open('bridgelab.library.v3.6',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('matches').objectStore('matches').get('v36-preserved-archive');q.onsuccess=()=>{db.close();resolve(q.result);};q.onerror=()=>reject(q.error);};}));
  assert.deepEqual(archiveAfter, archiveFixture);
  assert.equal(await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.7')), null);
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
  await page.evaluate(() => { location.hash='/history/v36-preserved-archive'; });
  await page.getByTestId('history-board').waitFor();
  await page.getByRole('button',{name:'主桌叫牌与出牌复盘 →',exact:true}).click();
  const analysis=page.getByTestId('analysis-page');
  await analysis.waitFor();
  await expect(analysis).toHaveAttribute('data-cursor','0');
  await page.getByRole('button',{name:'下一张',exact:true}).click();
  await expect(analysis).toHaveAttribute('data-cursor','1');
  await page.getByRole('button',{name:'跳到结束',exact:true}).click();
  await expect(analysis).toHaveAttribute('data-cursor','52');
  await page.getByRole('button',{name:'回到首攻前',exact:true}).click();
  await expect(analysis).toHaveAttribute('data-cursor','0');
  await page.screenshot({path:path.join(mobile,'docs/upgrade-offline-replay.png'),fullPage:false});
  assert.deepEqual(errors, []);

  const report = { verifiedAt: new Date().toISOString(), previousVersion: '0.3.7+43', previousVersionCode:43, version: '0.3.7+44', versionCode:44, previousApk: previousExtraction.sourceApk, previousApkSha256: previousExtraction.sourceApkSha256, previousBundle, currentBundle,
    origin, packagedOrigin: 'http://127.0.0.1:51893', originBoundary: 'Ephemeral test port, with one stable origin retained across old/new phases. Native wrapper fixed port checked separately.',
    previousRawSha256: createHash('sha256').update(saved).digest('hex'), stalePreviousWorkboxCacheReproduced: true, exactNativeRecoveryScriptExecuted: true,
    sessionV36UnchangedBeforeUserAction: true, existingV36ArchiveUnchanged: true, rawCode43UnchangedBeforeUserAction:true, existingCode43ArchiveUnchanged:true, rawV036UnchangedBeforeUserAction:true, existingV036ArchiveUnchanged:true, compatibilityAliasMeaning:"V036-named legacy fields describe retained v3.6 storage schema; the real previous APK tested is code43, not software v0.3.6", retainedStorageKey: currentKey, retainedLibraryDatabase: 'bridgelab.library.v3.6', noV037StorageKeyCreated: true, preservedBoard: 20, preservedSeed: fixture.incidentSeed, actionsBeforeOfflineContinuation: 3, preservedHistoryCount: 19,
    directHistoryContainsPreservedV36Archive: true, preservedArchiveCount: migratedArchiveCount, homeContinueVisible: true, offlineReloadAndContinuedBid: true, offlineArchivedReplay: true, offlineReplayPositions: [0,1,52,0], localStorageAndIndexedDbSentinelsPreserved: true, errors,
    fixtureBoundary: 'Reported board-20 seed and actions; 19 prior passouts are synthetic continuity fixtures. The separate completed code43 archive is a deterministic legal first-card fixture with 52 actual plays.',
    evidenceBoundary: 'Chromium mobile browser emulation with real Workbox/cache and exact native JavaScript. Android WebView, installation and physical device not tested.',
    browserVersion: browser.version(), browserExecutable: executablePath || 'Playwright Chromium' };
  await writeFile(path.join(mobile, 'docs/UPGRADE_RECOVERY_VALIDATION.json'), JSON.stringify(report, null, 2));
  console.log('v0.3.7+43 cached bundle → v0.3.7+44 native recovery, preserved v3.6 session/library, home continue, offline bid and 52-play archived replay passed.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
