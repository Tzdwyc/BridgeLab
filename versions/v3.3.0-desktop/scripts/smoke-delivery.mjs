import { chromium, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const baseURL = 'http://localhost:5191';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const started = Date.now();
try {
  const response = await page.goto(baseURL);
  expect(response.status()).toBe(200);
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
  await expect(page.getByText('● 离线资源已缓存', { exact: true })).toBeVisible({ timeout: 30000 });
  const manifestURL = await page.locator('link[rel=manifest]').getAttribute('href');
  expect((await page.request.get(new URL(manifestURL, baseURL).href)).status()).toBe(200);
  const traversal = await page.request.get(`${baseURL}/%2e%2e%2fpackage.json`);
  expect([403, 404]).toContain(traversal.status());
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('机器人行动速度').selectOption('0');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新牌局', exact: true }).click();
  await page.getByLabel('随机种子', { exact: true }).fill('delivery-smoke-v3.1');
  await page.getByRole('dialog').getByRole('button', { name: '开始新牌局', exact: true }).click();
  let bidChosen = false; let humanPlays = 0;
  for (let guard = 0; guard < 100; guard++) {
    await expect.poll(async () => {
      const app = page.getByTestId('app'); const phase = await app.getAttribute('data-phase');
      return phase === 'complete' || phase === 'passedOut' || await app.getAttribute('data-controller') === 'S';
    }, { timeout: 15000 }).toBe(true);
    const phase = await page.getByTestId('app').getAttribute('data-phase');
    if (phase === 'complete' || phase === 'passedOut') break;
    if (phase === 'auction') {
      if (!bidChosen) {
        const north = await page.getByLabel('叫牌历史', { exact: true }).locator('div').nth(1).locator(':scope > span').first().innerText();
        await page.getByRole('button', { name: `叫 7${north.includes('NT') ? 'S' : 'NT'}`, exact: true }).click();
        bidChosen = true;
      } else await page.getByRole('button', { name: '不叫 Pass', exact: true }).click();
    } else { await page.locator('button[data-card]:not([disabled])').first().click(); humanPlays++; }
  }
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByText('已完成 13 墩 · 查看记录', { exact: true })).toBeVisible();
  expect(humanPlays).toBe(26);
  const score = await page.getByTestId('board-score').innerText();
  await context.setOffline(true); await page.reload();
  await expect(page.getByTestId('result')).toBeVisible();
  expect(await page.getByTestId('board-score').innerText()).toBe(score);
  await expect(page.getByText('● 离线模式', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('bridgelab.analysis.cache.v3.1'));
  await page.getByRole('button', { name: '逐墩分析 →', exact: true }).click();
  await expect(page.locator('button[data-candidate]').first()).toBeVisible({ timeout: 30000 });
  const ddTable = page.getByTestId('double-dummy-table');
  await expect(ddTable.locator('[data-dd-cell]')).toHaveCount(20);
  await expect(ddTable.locator('[data-dd-cell][data-tricks]')).toHaveCount(20, { timeout: 30000 });
  await expect(ddTable.locator('[data-current="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: '计算整副 53 个位置', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-results', '53', { timeout: 60000 });
  await page.screenshot({ path: 'artifacts/delivery-offline-analysis.png', fullPage: true });
  expect(errors).toEqual([]);
  const report = { passed: true, version: '0.3.1', baseURL, entryStatus: response.status(), traversalStatus: traversal.status(), humanPlays, tricks: 13, offlineReload: true, scoreRestored: true, freshOfflineDdsTableCells: 20, freshOfflineDdsPositions: 53, pageErrors: errors, elapsedMs: Date.now() - started, executedAt: new Date().toISOString() };
  writeFileSync('artifacts/delivery-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
