import { test, expect, type Page } from '@playwright/test';
import { newGame, applyCall, playCard, replay } from '../../src/core/game';
import { legalCards } from '../../src/core/play';
import { PASS, STRAINS, type GameState, type Seat } from '../../src/core/types';
import { createMatch, appendBoard, updateMatchTable, type Match } from '../../src/match/engine';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';

async function seed(page: Page, game: GameState, activeMatch?: Match) {
  const history = Array.from({ length: game.board - 1 }, (_, i) => { let previous = newGame(i + 1, `prior-${i}`); for (let j = 0; j < 4; j++) previous = applyCall(previous, previous.turn, PASS); return previous; });
  const raw = encodeSession({ ...emptySession(), game, history, ...(activeMatch ? { activeMatch } : {}), biddingSystem: 'sayc', gameSystem: 'sayc', playStrength: 'basic', delay: 1100 });
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
}
async function bounded(page: Page) {
  const result = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="bridge-table"]')!;
    const selectors = ['[data-testid="table-seat-N"]', '[data-testid="table-seat-E"]', '[data-testid="table-seat-S"]', '[data-testid="table-seat-W"]', '[data-testid="table-hand-S"] button', '[data-testid="table-hand-N"] button', '[data-testid="table-hand-E"] button', '[data-testid="table-hand-W"] button', '[aria-label="叫牌框"] button'];
    const outside = selectors.flatMap(selector => [...table.querySelectorAll<HTMLElement>(selector)]).filter(el => el.getClientRects().length).filter(el => { const r = el.getBoundingClientRect(); return r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; }).map(el => el.getAttribute('aria-label') ?? el.textContent);
    return { outside, table: table.getBoundingClientRect().toJSON(), scroll: [...document.querySelectorAll<HTMLElement>('html, body, main, [data-testid="bridge-table"], [aria-label="叫牌历史"]')].filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2).map(el => el.tagName + ':' + el.getAttribute('aria-label')) };
  });
  expect(result.outside).toEqual([]); expect(result.scroll).toEqual([]); expect(result.table.height).toBeGreaterThan(170);
}
for (const [width, height] of [[360, 800], [390, 844], [844, 390], [1280, 800], [1440, 900]]) test(`fixed table ${width}x${height}: controls, hands, history and settings fit`, async ({ page }) => {
  page.on('pageerror', error => console.log('UI ERROR', error.message)); await page.setViewportSize({ width, height });
  let game = newGame(3, 'v037-fixed-table');
  for (let i = 0; i < 20; i++) game = applyCall(game, game.turn, { kind: 'bid', level: Math.floor(i / 5) + 1, strain: STRAINS[i % 5] });
  await seed(page, game); await page.goto('/#/table');
  await expect(page.getByTestId('app')).toHaveAttribute('data-turn', 'S');
  await bounded(page);
  const auctionScroll = page.getByTestId('auction-history-scroll');
  await expect(auctionScroll.locator('[data-explanation]')).toHaveCount(20);
  await expect(page.getByRole('button', { name: '较早叫牌' })).toHaveCount(0);
  expect(await auctionScroll.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollTop > 0)).toBe(true);
  await auctionScroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await expect(auctionScroll.locator('[data-explanation]').first()).toBeInViewport();
  await bounded(page);
  await page.getByRole('button', { name: '选择 5 阶', exact: true }).click();
  await expect(page.getByRole('button', { name: '叫 5NT', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '不叫 Pass', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '体系卡', exact: true }).click({ timeout: 5000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await expect(dialog).not.toContainText('精确制');
  await page.getByRole('button', { name: '下一页体系卡', exact: true }).click();
  await expect(dialog).toContainText('约定 1');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (let i = 0; i < 4; i++) { expect(await dialog.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true); const next = page.getByRole('button', { name: '下一页游戏设置', exact: true }); if (await next.isEnabled()) await next.click(); }
  await page.screenshot({ path: `artifacts/v037-fixed-${width}x${height}.png` });
});

for (const declarer of ['S', 'W', 'E'] as Seat[]) for (const [width, height] of [[360,800],[390,844],[844,390],[1280,800],[1440,900]]) test(`dummy stays at its seat for ${declarer} declarer ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  const board = declarer === 'S' ? 3 : declarer === 'W' ? 4 : 2;
  let match = createMatch(`fixed-dummy-${declarer}-${width}`, { mode: 'total', seed: `v037-dummy-${declarer}` }, { biddingSystem: 'sayc', playStrength: 'basic' });
  for (let number = 1; number < board; number++) { let previous = replay(match.boards[match.currentBoard - 1].main); for (let i = 0; i < 4; i++) previous = applyCall(previous, previous.turn, PASS); match = appendBoard(updateMatchTable(match, 'main', previous)); }
  let game = replay(match.boards[board - 1].main);
  game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'NT' });
  for (let i = 0; i < 3; i++) game = applyCall(game, game.turn, PASS);
  game = playCard(game, game.turn, legalCards(game.hands[game.turn], game.currentTrick)[0].id);
  const dummy = game.contract!.dummy;
  match = updateMatchTable(match, 'main', game);
  await seed(page, game, match); await page.goto('/#/table');
  await expect(page.getByTestId(`table-seat-${dummy}`)).toBeVisible();
  await expect(page.getByTestId(`table-hand-${dummy}`)).toBeVisible();
  await bounded(page);
  const shownHand = page.getByTestId(`table-seat-${dummy}`).getByTestId(`table-hand-${dummy}`);
  expect(await shownHand.locator('button[data-card]').count()).toBeGreaterThan(0);
  if (dummy === 'E' || dummy === 'W') { await expect(shownHand.locator('button:not([disabled])')).toHaveCount(0); await expect(page.getByTestId(`table-hand-${dummy === 'E' ? 'W' : 'E'}`)).toHaveCount(0); }
  await page.screenshot({ path: `artifacts/live-board/fixed-seats/dummy-${dummy}-${width}x${height}.png` });
  if (declarer === 'S') {
    const hand = page.getByTestId(`table-hand-${dummy}`);
    const north = page.getByTestId('table-seat-N'); const south = page.getByTestId('table-seat-S');
    await expect(north.getByTestId('table-hand-N')).toBeVisible(); await expect(south.getByTestId('table-hand-S')).toBeVisible();
    await expect(south.getByTestId('table-hand-N')).toHaveCount(0);
    expect((await north.boundingBox())!.y).toBeLessThan((await south.boundingBox())!.y);
    const cardBox = await hand.locator('button').first().boundingBox(); expect(cardBox!.width).toBeGreaterThanOrEqual(38); expect(cardBox!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('button', { name: '我的手牌', exact: true })).toHaveCount(0);
    if (width <= 390) { const rows = await hand.locator('button').evaluateAll(cards => [...new Set(cards.map(card => Math.round(card.getBoundingClientRect().top)))].length); expect(rows).toBe(2); }
    await expect(hand.locator('button:not([disabled])').first()).toBeVisible();
    await hand.locator('button:not([disabled])').first().click();
    await expect.poll(async () => Number(await page.getByTestId('app').getAttribute('data-actions'))).toBeGreaterThanOrEqual(game.actions.length + 1);
  }
});



