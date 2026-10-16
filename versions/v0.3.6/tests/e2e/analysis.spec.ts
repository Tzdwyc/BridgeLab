import { test, expect, type Page } from '@playwright/test';
import { exampleGame, EXAMPLES, replayLine, openDocument } from '../../src/analysis/model';
import { toRecord, applyCall, newGame } from '../../src/core/game';
import { robotStep } from '../../src/controller/robot';
import { encodeSession, emptySession } from '../../src/persistence/session';
import { analysisPosition, doubleDummyTableRequest } from '../../src/analysis/adapter';
import { DdsEngine } from '../../src/analysis/engine';
import { type DoubleDummyTableResult } from '../../src/analysis/types';
import { PASS, SEATS, STRAINS } from '../../src/core/types';

const example = exampleGame('v03-example-nt', 'NT', 'S');
const line = replayLine(toRecord(example));
let engine: DdsEngine;
const expectedTables = new Map<string, DoubleDummyTableResult>();
test.beforeAll(async () => {
  engine = await DdsEngine.create();
  for (const fixture of EXAMPLES) {
    const game = exampleGame(fixture.seed, fixture.strain, fixture.declarer, fixture.board);
    expectedTables.set(fixture.id, engine.table(doubleDummyTableRequest(replayLine(toRecord(game)).states[0])));
  }
});
async function seedGame(page: Page) {
  await page.addInitScript(raw => localStorage.setItem('bridgelab.session.v3.6', raw), encodeSession({ ...emptySession(), game: example }));
}
async function jump(page: Page, cursor: number) {
  await page.getByLabel('打牌位置', { exact: true }).focus();
  await page.getByLabel('打牌位置', { exact: true }).press('Home');
  for (let i = 0; i < cursor; i++) await page.getByLabel('打牌位置', { exact: true }).press('ArrowRight');
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', String(cursor));
}
async function waitCandidate(page: Page) {
  await expect(page.locator('button[data-candidate]').first()).toBeVisible({ timeout: 30000 });
}
async function expectDoubleDummyTable(page: Page, expected: DoubleDummyTableResult, current: string) {
  const table = page.getByTestId('double-dummy-table');
  await expect(table).toBeVisible({ timeout: 30000 });
  await expect(table.locator('[data-dd-cell]')).toHaveCount(20);
  for (const seat of SEATS) for (const strain of STRAINS) {
    await expect(table.locator(`[data-dd-cell="${seat}-${strain}"]`)).toHaveAttribute('data-tricks', String(expected.table[seat][strain]));
  }
  await expect(table.locator('[data-current="true"]')).toHaveCount(1);
  await expect(table.locator(`[data-dd-cell="${current}"]`)).toHaveAttribute('data-current', 'true');
}
async function tableValues(page: Page) {
  return page.getByTestId('double-dummy-table').locator('[data-dd-cell]').evaluateAll(cells =>
    cells.map(cell => `${cell.getAttribute('data-dd-cell')}:${cell.getAttribute('data-tricks')}`));
}

test('real 53-position analysis, all candidates, counterfactual optimal continuation and original preservation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seedGame(page); await page.goto('/#/table'); const saved = await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.6'));
  await page.getByRole('button', { name: '主桌逐墩分析 →', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toBeVisible(); await waitCandidate(page);
  await expectDoubleDummyTable(page, expectedTables.get('nt')!, 'S-NT');
  const openingTable = await tableValues(page);
  await page.getByRole('button', { name: '计算整副 53 个位置', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-results', '53', { timeout: 60000 });
  let badIndex = 0;
  for (let i = 0; i < 52; i++) if (engine.solve(analysisPosition(line.states[i])).candidates.some(c => c.loss > 0)) { badIndex = i; break; }
  await jump(page, badIndex); const expected = engine.solve(analysisPosition(line.states[badIndex]));
  expect(await tableValues(page)).toEqual(openingTable);
  await expect(page.locator('button[data-candidate]')).toHaveCount(expected.candidates.length);
  await expect(page.locator('button[data-candidate][data-optimal=true]')).toHaveCount(expected.candidates.filter(c => c.optimal).length);
  for (const card of expected.candidates) {
    const button = page.locator(`button[data-candidate="${card.cardId}"]`);
    await expect(button).toHaveAttribute('data-tricks', String(card.declarerTricks)); await expect(button).toHaveAttribute('data-loss', String(card.loss));
  }
  const chosen = expected.candidates.find(c => c.loss > 0)!;
  expect(chosen).toBeDefined(); await page.locator(`button[data-candidate="${chosen.cardId}"]`).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', String(badIndex + 1));
  await expect(page.getByTestId('branch-comparison')).toBeVisible();
  expect(await tableValues(page)).toEqual(openingTable);
  await page.getByRole('button', { name: '按最优牌续打至结束 →', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '52', { timeout: 60000 });
  await expect(page.getByTestId('branch-comparison')).toContainText(`${chosen.declarerTricks} 墩`);
  expect(await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.6'))).toBe(saved);
  await page.screenshot({ path: 'artifacts/desktop-analysis-branch.png', fullPage: true });
  await page.getByRole('button', { name: '撤回试打一张', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '51');
  await page.reload(); await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '51');
  await expect(page.getByTestId('branch-comparison')).toBeVisible();
  await page.getByRole('button', { name: '返回原局', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch', 'original');
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', String(badIndex));
  await page.screenshot({ path: 'artifacts/desktop-analysis.png', fullPage: true });
  await page.getByRole('link', { name: '牌桌', exact: true }).click(); await expect(page.getByTestId('result')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('bridgelab.session.v3.6'))).toBe(saved); expect(errors).toEqual([]);
});

test('offline first analysis boots cached WASM worker and computes an uncached full board', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seedGame(page); await page.goto('/#/table'); await expect(page.getByText('● 离线资源已缓存', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; localStorage.removeItem('bridgelab.analysis.cache.v3.6'); });
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: '主桌逐墩分析 →', exact: true }).click(); await waitCandidate(page);
  await expectDoubleDummyTable(page, expectedTables.get('nt')!, 'S-NT');
  await expect(page.getByTestId('dd-value')).toContainText(String(engine.solve(analysisPosition(line.states[0])).declarerTricks));
  await page.getByLabel('分析牌局', { exact: true }).selectOption('hearts'); await waitCandidate(page);
  await expectDoubleDummyTable(page, expectedTables.get('hearts')!, 'E-H');
  const heartsTable = await tableValues(page);
  await page.getByLabel('分析牌局', { exact: true }).selectOption('spades'); await waitCandidate(page);
  await expectDoubleDummyTable(page, expectedTables.get('spades')!, 'N-S');
  expect(await tableValues(page)).not.toEqual(heartsTable);
  await page.getByRole('button', { name: '计算整副 53 个位置', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-results', '53', { timeout: 60000 });
  await expect(page.getByText('● 离线模式', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-results', '53');
  await page.screenshot({ path: 'artifacts/desktop-analysis-offline.png', fullPage: true }); expect(errors).toEqual([]);
});

test('all-pass board opens the double-dummy table and supports a hypothetical contract', async ({ page }) => {
  let passed = newGame(1, 'all-pass-analysis-v03');
  for (let index = 0; index < 4; index++) passed = applyCall(passed, passed.turn, PASS);
  await page.addInitScript(raw => localStorage.setItem('bridgelab.session.v3.6', raw), encodeSession({ ...emptySession(), game: passed }));
  await page.goto('/#/table');
  await expect(page.getByText('四家不叫，流局', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '双明手分析 →', exact: true }).click();
  await expect(page.getByTestId('passed-out-analysis-controls')).toBeVisible();
  await expect(page.getByTestId('passed-out-analysis-start')).toBeVisible();
  await expect(page.getByTestId('double-dummy-table')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('analysis-step')).toHaveText('0 / 0');
  await page.getByLabel('假设定约阶数').selectOption('4');
  await page.getByLabel('假设定约花色').selectOption('S');
  await page.getByLabel('假设定约庄家').selectOption('N');
  await expect(page.getByText(/假设：/)).toBeVisible();
  await waitCandidate(page);
  await page.locator('button[data-candidate]').first().click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch', /.+/);
  await expect(page.getByTestId('analysis-step')).toHaveText('1 / 52');
});

test('export/import, saved routes, keyboard navigation and cancelled continuation remain usable', async ({ page }) => {
  await page.goto('/#/analysis'); await waitCandidate(page);
  await page.getByRole('button', { name: '新建分支', exact: true }).click();
  await page.locator('button[data-candidate]').first().click(); await waitCandidate(page);
  await page.getByRole('button', { name: '按最优牌续打至结束 →', exact: true }).click();
  await page.getByRole('button', { name: '取消计算', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已停止');
  const document = await page.evaluate(() => JSON.parse(localStorage.getItem('bridgelab.analysis.workspace.v3.6')!));
  expect(document.activeBranch).not.toBeNull();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出分析', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('BridgeLab-v0.3.6');
  await page.getByLabel('分析牌局', { exact: true }).selectOption('spades'); await waitCandidate(page);
  await page.getByLabel('导入分析文件', { exact: true }).setInputFiles({ name: 'analysis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch', document.activeBranch);
  const cursor = Number(await page.getByTestId('analysis-page').getAttribute('data-cursor'));
  await page.locator('h1').click(); await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', String(Math.max(0, cursor - 1)));
  await page.getByLabel('导入分析文件', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch', document.activeBranch);
  await page.getByRole('button', { name: '返回原局', exact: true }).click();
  await page.getByRole('button', { name: '自动回放', exact: true }).click();
  await expect.poll(async () => Number(await page.getByTestId('analysis-page').getAttribute('data-cursor'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: '暂停回放', exact: true }).click();
});

test('desktop layout and distinct vector spade/club marks are visible in auction history', async ({ page }) => {
  let game = newGame(1, 'suit-shapes');
  for (const call of [{ kind: 'bid', level: 1, strain: 'S' }, PASS, { kind: 'bid', level: 2, strain: 'C' }, PASS, PASS, PASS] as const) game = applyCall(game, game.turn, call);
  for (let n = 0; n < 52; n++) game = robotStep(game).game;
  await page.addInitScript(raw => localStorage.setItem('bridgelab.session.v3.6', raw), encodeSession({ ...emptySession(), game }));
  await page.goto('/#/table');
  await page.getByRole('button', { name: '叫牌进程', exact: true }).click();
  const history = page.getByLabel('叫牌历史', { exact: true });
  const spade = history.locator('svg[data-suit=S]'); const club = history.locator('svg[data-suit=C]');
  await expect(spade).toBeVisible(); await expect(club).toBeVisible();
  expect((await spade.boundingBox())!.width).toBeGreaterThanOrEqual(18); expect((await club.boundingBox())!.width).toBeGreaterThanOrEqual(18);
  expect(await spade.evaluate(el => getComputedStyle(el).color)).not.toBe(await club.evaluate(el => getComputedStyle(el).color));
  expect(await spade.locator('path').getAttribute('d')).not.toBe(await club.locator('path').getAttribute('d'));
  await history.screenshot({ path: 'artifacts/clear-suit-history.png' });
  await page.getByRole('link', { name: '分析室', exact: true }).click(); await waitCandidate(page);
  await expectDoubleDummyTable(page, expectedTables.get('nt')!, 'S-NT');
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/desktop-analysis-1280.png', fullPage: true });
});

test('inert ALERT control and post-opening STOP cards appear in the bidding flow', async ({ page }) => {
  let game = newGame(1, 'alert-stop-cards');
  game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'D' });
  game = applyCall(game, game.turn, PASS);
  await page.addInitScript(raw => localStorage.setItem('bridgelab.session.v3.6', raw), encodeSession({ ...emptySession(), game }));
  await page.goto('/#/table');
  const history = page.getByLabel('叫牌历史', { exact: true });
  await expect(page.getByRole('button', { name: 'ALERT（暂未启用）', exact: true })).toBeDisabled();
  await expect(history.getByLabel(/^STOP：/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '叫 2S', exact: true })).toHaveAttribute('data-stop', 'true');
  await expect(page.getByRole('button', { name: '叫 1S', exact: true })).not.toHaveAttribute('data-stop', 'true');
  await page.getByRole('button', { name: '叫 2S', exact: true }).click();
  await expect(history.getByLabel(/^STOP：/)).toBeVisible();
  await page.screenshot({ path: 'artifacts/desktop-alert-stop.png', fullPage: true });
});

test('all bidding systems have visible cards, persist preferences and apply on the next board or replay', async ({ page }) => {
  await page.addInitScript(raw => {
    if (!localStorage.getItem('bridgelab.session.v3.6')) localStorage.setItem('bridgelab.session.v3.6', raw);
  }, encodeSession({ ...emptySession(), game: example }));
  await page.goto('/#/table');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('叫牌体系', { exact: true }).selectOption('precision');
  await expect(page.getByRole('dialog')).toContainText('本副使用SAYC＋2/1进局逼叫＋RKCB 1430');
  await page.getByRole('button', { name: '查看完整体系卡与支持范围', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SAYC＋2/1进局逼叫＋RKCB 1430', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2/1 进局逼叫', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '精确制', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Stayman');
  await page.screenshot({ path: 'artifacts/desktop-system-cards.png', fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('叫牌体系', { exact: true })).toHaveValue('precision');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '下一副牌 →', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bridgelab.session.v3.6')!).gameSystem)).toBe('precision');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('叫牌体系', { exact: true }).selectOption('two-over-one');
  await expect(page.getByRole('dialog')).toContainText('本副使用精确制');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '重打本副', exact: true }).click();
  await page.getByRole('button', { name: '确认重打', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bridgelab.session.v3.6')!).gameSystem)).toBe('two-over-one');
});
