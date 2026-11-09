import { expect, test } from '@playwright/test';
import { applyCall, replay } from '../../src/core/game';
import { PASS } from '../../src/core/types';
import { appendBoard, createMatch, updateMatchTable } from '../../src/match/engine';

function completed(id: string, count: number, order: number) {
  let match = createMatch(id, { mode: 'imp', boardCount: 8, seed: id }, { biddingSystem: 'sayc', playStrength: 'basic' });
  for (let n = 0; n < count; n++) {
    let game = replay(match.boards[n].main);
    for (let call = 0; call < 4; call++) game = applyCall(game, game.turn, PASS);
    match = updateMatchTable(updateMatchTable(match, 'main', game), 'reference', game);
    if (n + 1 < count) match = appendBoard(match);
  }
  match.updatedAt = `2026-11-06T00:00:0${order}.000Z`;
  return match;
}

test('history board eight and reference view survive review, reopening, reload and list return', async ({ page }) => {
  const matches = Array.from({ length: 8 }, (_, n) => completed(`nav-${n}`, n === 1 ? 8 : 1, n));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(matches => {
    for (const match of matches) {
      const key = `bridgelab.library.v3.6.match.${encodeURIComponent(match.id)}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(match));
    }
  }, matches);
  await page.goto('/#/history');
  await page.getByRole('button', { name: '双桌 IMP', exact: true }).click();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.locator('a[href="#/history/nav-1"]').click();
  for (let n = 0; n < 7; n++) await page.getByRole('button', { name: '下一副', exact: true }).click();
  await expect(page.getByRole('heading', { name: /第 8 副/ })).toBeVisible();
  await page.getByRole('button', { name: '参考桌叫牌', exact: true }).click();
  const original = await page.evaluate(() => localStorage.getItem('bridgelab.library.v3.6.match.nav-1'));
  await page.getByRole('button', { name: '参考桌复盘 →', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-entry', 'review');
  await page.getByTestId('analysis-stage-auction').click();
  await page.getByTestId('analysis-call-2').click();
  await page.getByTestId('analysis-return-origin').click();
  await expect(page).toHaveURL(/#\/history\/nav-1$/);
  await expect(page.getByRole('heading', { name: /第 8 副/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '参考桌叫牌', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('heading', { name: /第 8 副/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '参考桌叫牌', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '参考桌复盘 →', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-stage', 'auction');
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-call-cursor', '2');
  await page.reload();
  await expect(page.getByTestId('analysis-landing')).toBeVisible();
  await page.getByTestId('analysis-continue').click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-stage', 'auction');
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-call-cursor', '2');
  await page.getByTestId('analysis-return-origin').click();
  await page.getByRole('link', { name: '← 全部历史', exact: true }).click();
  await expect(page.getByRole('button', { name: '双桌 IMP', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('a[href="#/history/nav-1"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('bridgelab.library.v3.6.match.nav-1'))).toBe(original);
  expect(errors).toEqual([]);
});
