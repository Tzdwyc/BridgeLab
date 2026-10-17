import { test, expect, type Page } from '@playwright/test';
import { openDocument, exampleGame } from '../../src/analysis/model';
import { applyCall, applyClaim, controllerFor, newGame, playCard } from '../../src/core/game';
import { DEAL_LIBRARY_KEY } from '../../src/deal-editor/model';
import { WORKSPACE_KEY } from '../../src/analysis/persistence';
import { PASS } from '../../src/core/types';

async function noOverflow(page: Page, testid: string) {
  const errors = await page.getByTestId(testid).evaluate(root => [...root.querySelectorAll<HTMLElement>('*')].filter(element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2 && style.position !== 'absolute' && !['svg', 'path'].includes(element.tagName);
  }).map(element => `${element.tagName}.${element.className}: ${element.scrollHeight}/${element.clientHeight}`));
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
}

test('mobile deal assignment, metadata, saved-library pagination and reload preserve all 52 cards', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/#/deals');
  const seatNames = ['北', '东', '南', '西'];
  const suits = ['S', 'H', 'D', 'C'];
  for (let index = 0; index < 4; index++) {
    await page.getByRole('tab', { name: new RegExp(`${seatNames[index]}家`) }).click();
    await page.getByRole('tab', { name: `${suits[index]} 花色`, exact: true }).click();
    const buttons = page.locator('[data-testid="assignment-deck"] button:visible');
    await expect(buttons).toHaveCount(13);
    for (let card = 0; card < 13; card++) await buttons.nth(card).click();
  }
  await page.getByTestId('deal-metadata').click();
  await page.getByLabel('牌例名称', { exact: true }).fill('固定工作台完整牌例');
  await page.getByLabel('发牌人', { exact: true }).selectOption('E');
  await page.getByLabel('局况', { exact: true }).selectOption('Both');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByTestId('save-deal').click();
  await expect(page.getByRole('alert')).toContainText('已保存');
  const raw = await page.evaluate(key => localStorage.getItem(key)!, DEAL_LIBRARY_KEY);
  const library = JSON.parse(raw);
  expect(Object.values(library.deals[0].hands).map((hand: any) => hand.length)).toEqual([13, 13, 13, 13]);
  expect(library.deals[0]).toMatchObject({ dealer: 'E', vulnerability: 'Both' });
  await page.evaluate(({key, library}) => localStorage.setItem(key, JSON.stringify({version:1,deals:Array.from({length:8}, (_,index) => ({...library.deals[0],id:`long-${index}`,name:`牌例 ${index + 1} ` + '完整手牌与长名称分页核对'.repeat(5)}))})), {key:DEAL_LIBRARY_KEY,library});
  await page.reload();
  await page.getByRole('tab', { name: /保存库/ }).click();
  await expect(page.getByTestId('deal-library').locator('article')).toHaveCount(3);
  await noOverflow(page, 'deal-editor');
  await page.getByRole('navigation', { name: '保存库分页' }).getByRole('button', { name: '下一页' }).click();
  await page.getByRole('navigation', { name: '保存库分页' }).getByRole('button', { name: '下一页' }).click();
  await expect(page.getByTestId('deal-library').locator('article')).toHaveCount(2);
  await page.getByTestId('deal-library').locator('article').last().getByRole('button').first().click();
  await expect(page.getByTestId('deal-metadata')).toContainText('牌例 8');
  await expect(page.getByTestId('simulate-deal')).toBeVisible();
  await noOverflow(page, 'deal-editor');
});

test('all thirteen candidates remain reachable, branch undo and file round trip retain the original source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/analysis');
  await page.getByTestId('analysis-view-candidates').click();
  await expect(page.locator('[data-candidate]').first()).toBeVisible({timeout:45000});
  const source = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).source, WORKSPACE_KEY);
  const seen = new Set<string>();
  const pager = page.getByRole('navigation', { name: '候选牌分页' });
  for (let guard = 0; guard < 10; guard++) {
    for (const id of await page.locator('[data-candidate]').evaluateAll(cards => cards.map(card => card.getAttribute('data-candidate')!))) seen.add(id);
    if (await pager.getByRole('button', { name: '下一页' }).isDisabled()) break;
    await pager.getByRole('button', { name: '下一页' }).click();
  }
  expect(seen.size).toBe(13);
  await page.locator('[data-candidate]').first().click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '1');
  await page.getByTestId('analysis-view-routes').click();
  await expect(page.getByTestId('branch-comparison')).toBeVisible();
  await page.getByRole('button', { name: '撤回试打一张', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-cursor', '0');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).source, WORKSPACE_KEY)).toEqual(source);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出分析', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('v0.3.7');
  await page.getByLabel('导入分析文件', { exact: true }).setInputFiles((await file.path())!);
  await expect(page.getByRole('alert')).toContainText('已导入');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).source, WORKSPACE_KEY)).toEqual(source);
  await noOverflow(page, 'analysis-page');
  await page.getByRole('button', { name: '返回原局', exact: true }).click();
  await expect(page.getByTestId('analysis-page')).toHaveAttribute('data-branch', 'original');
});

test('ALL PASS hypothesis and claimed cutoff remain available on the short landscape screen', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  let passed = newGame(2, 'v037-passed-workbench');
  for (let index = 0; index < 4; index++) passed = applyCall(passed, passed.turn, PASS);
  const passDoc = openDocument(passed);
  await page.addInitScript(({key,raw}) => localStorage.setItem(key,raw), {key:WORKSPACE_KEY,raw:JSON.stringify(passDoc)});
  await page.goto('/#/analysis');
  await page.getByTestId('analysis-view-routes').click();
  await expect(page.getByTestId('passed-out-analysis-controls')).toBeVisible();
  await page.getByLabel('假设定约阶数', { exact: true }).selectOption('4');
  await page.getByLabel('假设定约花色', { exact: true }).selectOption('S');
  await page.getByRole('button', { name: '新建分支', exact: true }).click();
  await expect(page.getByTestId('branch-comparison')).toContainText('四家 Pass');
  await noOverflow(page, 'analysis-page');
  await page.getByTestId('analysis-view-board').click();
  await expect(page.getByTestId('analysis-transport')).toBeVisible();
  await noOverflow(page, 'analysis-page');
  let claimed = newGame(1, 'v037-claimed-workbench');
  claimed = applyCall(claimed, claimed.turn, {kind:'bid',level:1,strain:'NT'});
  for (let index = 0; index < 3; index++) claimed = applyCall(claimed, claimed.turn, PASS);
  claimed = playCard(claimed, claimed.turn, claimed.hands[claimed.turn][0].id);
  claimed = applyClaim(claimed, controllerFor(claimed), 0);
  const claimDoc = openDocument(claimed);
  await page.evaluate(({key,raw})=>localStorage.setItem(key,raw), {key:WORKSPACE_KEY,raw:JSON.stringify(claimDoc)});
  // A new page avoids addInitScript replacing the claim fixture on reload.
  await page.goto('/#/home');
  await page.goto('/#/analysis');
  await page.getByTestId('analysis-view-tricks').click();
  await expect(page.getByTestId('claim-analysis-cutoff')).toContainText('已出 1 张');
  await expect(page.getByLabel('打牌位置', { exact: true })).toHaveAttribute('max','1');
  await noOverflow(page, 'analysis-page');
});
