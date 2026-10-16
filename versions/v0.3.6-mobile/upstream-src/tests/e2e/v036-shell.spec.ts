import { test, expect, type Page } from '@playwright/test';
import { applyCall, replay } from '../../src/core/game';
import { PASS } from '../../src/core/types';
import { createMatch, updateMatchTable, type Match } from '../../src/match/engine';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';

function fixture(id: string, mode: 'total' | 'imp' = 'imp') {
  return createMatch(id, { mode, boardCount: 16, seed: `shell-${id}` }, { biddingSystem: 'two-over-one', playStrength: 'basic' });
}
async function seed(page: Page, match: Match) {
  const game = replay(match.boards[match.currentBoard - 1].main);
  const raw = encodeSession({ ...emptySession(), game, delay: 1100, biddingSystem: 'sayc', gameSystem: match.config.biddingSystem, playStrength: match.config.playStrength, activeMatch: match });
  await page.addInitScript(({ raw, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { raw, key: STORAGE_KEY });
}
const passOut = (match: Match) => {
  let game = replay(match.boards[0].main);
  for (let i = 0; i < 4; i++) game = applyCall(game, game.turn, PASS);
  return game;
};

test('root opens home; setup offers continuous total and 8/16/24 IMP', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.getByTestId('home-page').getByRole('link', { name: /开始打牌/ }).click();
  await expect(page.getByRole('button', { name: /累计总分/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^16 副/ })).toHaveCount(0);
  await page.getByRole('button', { name: /双桌 IMP/ }).click();
  await expect(page.getByRole('button', { name: /^16 副/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '8 副', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '24 副', exact: true })).toBeVisible();
  await page.getByLabel('本场打牌强度').selectOption('basic');
  await page.getByRole('button', { name: /开始比赛/ }).click();
  await expect(page.getByLabel('比赛进度')).toContainText('第 1 / 16 副');
  await expect(page.getByLabel('双方 IMP 比分')).toHaveText('我方 0 : 0 对方 · 净 0 IMP');
  await expect(page.getByRole('button', { name: /悔牌/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /提示/, exact: false }).filter({ hasText: '提示' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: '重打本副' })).toBeDisabled();
});

test('home pauses a restored match; continue and new match preserve its archive', async ({ page }) => {
  await seed(page, fixture('pause-and-archive'));
  await page.goto('/');
  await expect(page.getByTestId('continue-match')).toContainText('第 1 / 16 副');
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  await page.waitForTimeout(1400);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
  await page.getByTestId('continue-match').click();
  await expect(page.getByTestId('bridge-table')).toBeVisible();
  await page.getByRole('link', { name: '新牌局', exact: true }).click();
  await page.getByLabel('本场打牌强度').selectOption('basic');
  await page.getByRole('button', { name: /开始比赛/ }).click();
  await expect(page.getByLabel('比赛进度')).toContainText('累计总分');
  await page.getByRole('link', { name: '历史牌局', exact: true }).click();
  await expect(page.getByTestId('history-page').getByRole('link', { name: /双桌 IMP/ })).toBeVisible();
  await expect(page.getByTestId('history-page').getByRole('link', { name: /累计总分/ })).toBeVisible();
});

test('history hides reference data before both finish and uses archived bidding system', async ({ page }) => {
  let match = fixture('history-lock');
  match = updateMatchTable(match, 'reference', passOut(match));
  await seed(page, match);
  await page.goto('/#/history/history-lock');
  await expect(page.getByTestId('history-board')).toContainText('本副尚未结束');
  await expect(page.getByRole('button', { name: /参考桌复盘/ })).toHaveCount(0);
  await expect(page.getByText('参考桌 · 南北原始分')).toHaveCount(0);
});

test('settled IMP offers comparison, historical auction explanations and analysis return', async ({ page }) => {
  let match = fixture('history-ready'); const game = passOut(match);
  match = updateMatchTable(updateMatchTable(match, 'main', game), 'reference', game);
  const savedExplanation = '历史说明快照：仅使用本副保存的公开叫牌说明。';
  match.boards[0].mainExplanations![0] = savedExplanation;
  await seed(page, match);
  await page.goto('/#/history/history-ready');
  await expect(page.getByTestId('history-board')).toContainText('0 IMP');
  await expect(page.getByLabel('双方 IMP 比分')).toHaveText('我方 0 : 0 对方 · 净 0 IMP');
  await page.getByText('主桌叫牌记录与解释', { exact: true }).click();
  await expect(page.getByLabel('历史叫牌记录').first()).toContainText('2/1');
  await page.getByLabel('历史叫牌记录').first().getByRole('button').first().click();
  await expect(page.getByRole('tooltip')).toHaveText(savedExplanation);
  await expect(page.getByTestId('history-page')).toContainText('软件 v0.3.6');
  await page.getByRole('button', { name: /主桌叫牌与出牌复盘/ }).click();
  await expect(page.getByTestId('analysis-page')).toBeVisible();
  await page.getByRole('link', { name: '返回历史牌局', exact: true }).click();
  await expect(page).toHaveURL(/#\/history\/history-ready$/);
});

test('phone home, setup and history stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await seed(page, fixture('phone'));
  for (const route of ['home', 'setup', 'history', 'history/phone']) {
    await page.goto(`/#/${route}`);
    await expect(page.getByTestId('app')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow, route).toBe(false);
  }
  await page.screenshot({ path: 'artifacts/v036-home-phone.png', fullPage: true });
});
