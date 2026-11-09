import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 844 } });
const key = 'bridgelab.analysis.workspace.v3.6';
mkdirSync('artifacts/v312-ui', { recursive: true });
try {
  await page.goto(process.env.BRIDGELAB_TEST_URL ?? 'http://127.0.0.1:5207/#/analysis');
  await page.getByTestId('analysis-page').waitFor();
  await expect(page.getByText('分析位置与分支已自动保存', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '1');
  await expect.poll(() => page.evaluate(k => JSON.parse(localStorage.getItem(k)).cursor, key)).toBe(1);
  const validRaw = await page.evaluate(k => localStorage.getItem(k), key);
  await page.reload();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '1');
  await page.getByLabel('导入分析文件', { exact: true }).setInputFiles({ name: 'analysis.json', mimeType: 'application/json', buffer: Buffer.from(validRaw) });
  await expect(page.getByRole('status').filter({ hasText: '已导入。' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '已导入。' })).toHaveCount(0, { timeout: 4000 });
  await page.getByLabel('导入分析文件', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert').filter({ hasText: '请导入' })).toBeVisible();
  await page.getByRole('button', { name: '关闭分析提示', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请导入' })).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('bridgelab.analysis.')) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '自动保存失败，请导出分析文件。' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/v312-ui/analysis-save-error.png', fullPage: true });
  await expect(page.getByRole('alert').filter({ hasText: '自动保存失败，请导出分析文件。' })).toHaveCount(0, { timeout: 6500 });
  const report = { passed: true, analysisCursorSaved: 1, reloadRestored: true, successAutoDismissMs: 2000, errorAutoDismissMs: 5000, manualClose: true, invalidImportVisible: true, saveFailureVisible: true, successfulSaveFooterRemoved: true };
  writeFileSync('artifacts/v312-ui/page-notices.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
