import { test, expect } from '@playwright/test';
import { appendBoard, createMatch, updateMatchTable } from '../../src/match/engine';
import { applyCall, newGame, replay, toRecord } from '../../src/core/game';
import { PASS } from '../../src/core/types';
import { robotStep } from '../../src/controller/robot';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';
import { openDocument } from '../../src/analysis/model';

test('direct historical startup waits for the old-save archive migration', async ({ page }) => {
  let first = newGame(1, 'direct-history-upgrade');
  for (let i = 0; i < 4; i++) first = applyCall(first, first.turn, PASS);
  const raw = encodeSession({ ...emptySession(), history: [first], game: newGame(2, 'direct-history-current') });
  await page.addInitScript(raw => { if (!localStorage.getItem('bridgelab.session.v3.5')) localStorage.setItem('bridgelab.session.v3.5', raw); }, raw);
  await page.goto('/#/history');
  const archived = page.getByTestId('history-page').getByRole('link', { name: /累计总分/ });
  await expect(archived).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.5'))).toBe(raw);
  expect(await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.5.backup.v3.6'))).toBe(raw);
  await archived.click(); await expect(page.getByTestId('history-board')).toHaveCount(2);
  await expect(page.getByTestId('history-page')).toContainText('旧存档未逐副记录叫牌体系');
});

test('an eight-board match reaches one final archive and cannot alter settled scores', async ({ page }) => {
  let match = createMatch('eight-board-finish', { mode: 'imp', boardCount: 8, seed: 'eight-board-finish' }, { biddingSystem: 'sayc', playStrength: 'basic' });
  for (let number = 1; number <= 8; number++) {
    let game = replay(match.boards[number - 1].main);
    for (let guard = 0; game.phase !== 'complete' && game.phase !== 'passedOut' && guard < 180; guard++) game = robotStep(game).game;
    match = updateMatchTable(match, 'main', game);
    if (number < 8) { match = updateMatchTable(match, 'reference', game); match = appendBoard(match); }
  }
  const raw = encodeSession({ ...emptySession(), game: replay(match.boards[7].main), history: match.boards.slice(0, 7).map(b => replay(b.main)), gameSystem: 'sayc', playStrength: 'basic', activeMatch: match });
  await page.addInitScript(({ raw, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { raw, key: STORAGE_KEY });
  await page.goto('/#/table');
  await expect(page.getByRole('link', { name: /本场比赛结果/ })).toBeVisible({ timeout: 30000 });
  const completed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(completed.activeMatch.completedBoards).toBe(8); expect(completed.activeMatch.status).toBe('completed');
  await page.getByRole('link', { name: /本场比赛结果/ }).click();
  await expect(page.getByTestId('history-board')).toHaveCount(8);
  await expect(page.getByTestId('history-page')).toContainText('已完成');
  await expect(page.getByRole('button', { name: /继续比赛/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('history-board')).toHaveCount(8);
  await page.screenshot({ path: 'artifacts/v036-eight-board-history.png', fullPage: true });
});

test('actual second-table robots finish independently; reload and offline analysis retain one IMP entry', async ({ page, context }) => {
  test.setTimeout(120000);
  let match = createMatch('actual-reference', { mode: 'imp', boardCount: 8, seed: 'actual-reference-036' }, { biddingSystem: 'sayc', playStrength: 'basic' });
  let main = replay(match.boards[0].main);
  for (let guard = 0; main.phase !== 'complete' && main.phase !== 'passedOut' && guard < 180; guard++) main = robotStep(main).game;
  match = updateMatchTable(match, 'main', main);
  const raw = encodeSession({ ...emptySession(), game: main, gameSystem: 'sayc', playStrength: 'basic', activeMatch: match });
  await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key: STORAGE_KEY, raw });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/table');
  await expect(page.getByRole('region', { name: '双桌比较', exact: true })).toBeVisible({ timeout: 45000 });
  const completed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(completed.activeMatch.completedBoards).toBe(1);
  expect(completed.activeMatch.boards[0].reference.actions.length).toBeGreaterThan(3);
  expect(completed.activeMatch.boards[0].reference.actions).not.toBeNull();
  expect(completed.activeMatch.boards[0].main).toEqual(toRecord(main));
  const result = completed.activeMatch.boards[0];
  expect(result.difference).toBe(result.scoreNS - result.referenceScoreNS);
  const before = completed.activeMatch.totalImps;
  await expect(page.getByText('离线资源已缓存', { exact: false })).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(page.getByRole('region', { name: '双桌比较', exact: true })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).activeMatch.totalImps, STORAGE_KEY)).toBe(before);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('region', { name: '双桌比较', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /参考桌复盘/ }).click();
  await expect(page.getByTestId('analysis-page')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/v036-reference-offline.png', fullPage: true });
});

test('direct analysis URL cannot load the unfinished IMP deal from an old analysis workspace', async ({ page }) => {
  const match = createMatch('analysis-gate', { mode: 'imp', seed: 'analysis-gate' }, { biddingSystem: 'sayc', playStrength: 'basic' });
  const game = replay(match.boards[0].main);
  const session = encodeSession({ ...emptySession(), game, gameSystem: 'sayc', playStrength: 'basic', activeMatch: match });
  // An independent prior analysis with this deal must not expose current hidden cards.
  let finished = game;
  for (let guard = 0; finished.phase !== 'complete' && finished.phase !== 'passedOut' && guard < 180; guard++) finished = robotStep(finished).game;
  const document = JSON.stringify(openDocument(finished));
  await page.addInitScript(({ session, document, key }) => { localStorage.setItem(key, session); localStorage.setItem('bridgelab.analysis.workspace.v3.5', document); }, { session, document, key: STORAGE_KEY });
  await page.goto('/#/analysis');
  await expect(page.getByText('本副两桌尚未全部结束，结束后可以复盘。', { exact: true })).toBeVisible();
  expect(await page.getByLabel('分析牌局').inputValue()).not.toBe(`1:${game.seed}`);
});

test('Android native file bridge is preferred over Blob/file input and cancellation remains silent', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { saved: [] as string[], cancel: false, opens: 0 };
    (window as unknown as { fileTest: typeof state }).fileTest = state;
    window.BridgeLabNativeFiles = {
      saveFile: async (name, text) => { if (state.cancel) return false; state.saved.push(JSON.stringify({ name, text })); return true; },
      openFile: async () => { state.opens++; return null; }
    };
  });
  await page.goto('/#/history');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已导出');
  const saved = await page.evaluate(() => (window as unknown as { fileTest: { saved: string[] } }).fileTest.saved);
  expect(saved).toHaveLength(1); expect(JSON.parse(saved[0]).name).toContain('v0.3.6');
  expect(JSON.parse(JSON.parse(saved[0]).text).format).toBe('bridgelab.matches');
  await page.evaluate(() => { (window as unknown as { fileTest: { cancel: boolean } }).fileTest.cancel = true; });
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: '导入存档', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { fileTest: { opens: number } }).fileTest.opens)).toBe(1);
});
