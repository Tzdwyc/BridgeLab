import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { applyClaim } from '../../src/core/game';
import { mobileLongAuction, mobilePlay } from '../fixtures/v322-mobile';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';

// Use the native candidate's actual override, not a desktop-only approximation.
const mobileCss = readFileSync(new URL('../../../v3.2.2-mobile/mobile-overrides/mobile.css', import.meta.url), 'utf8');
async function open(page: Page, game: ReturnType<typeof mobilePlay>) {
  const raw = encodeSession({ ...emptySession(), game, delay: 1100, playStrength: 'basic' });
  await page.addInitScript(({ key, raw, css }) => {
    localStorage.setItem(key, raw);
    addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); });
  }, { key: STORAGE_KEY, raw, css: mobileCss });
  await page.goto('/#/table');
  await expect(page.getByTestId('bridge-table')).toBeVisible();
}

async function targetCaptionFits(page: Page) {
  const summary = page.getByTestId('trick-score');
  const caption = summary.getByTestId('score-target-caption');
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText('目标 9');
  const geometry = await summary.evaluate(element => {
    const label = element.querySelector('[data-testid="score-target-caption"]')!;
    const other = [...element.querySelectorAll('[data-side]')].find(column => !column.contains(label))!;
    const value = other.querySelector('[role=meter] > span:first-of-type')!.getBoundingClientRect();
    const caption = label.getBoundingClientRect(), box = element.getBoundingClientRect();
    return {
      overlaps: Math.min(caption.right, value.right) > Math.max(caption.left, value.left)
        && Math.min(caption.bottom, value.bottom) > Math.max(caption.top, value.top),
      inside: caption.left >= box.left && caption.right <= box.right && caption.top >= box.top && caption.bottom <= box.bottom,
    };
  });
  expect(geometry.overlaps, 'target caption covers the other partnership trick value').toBe(false);
  expect(geometry.inside, 'target caption extends outside the compact summary').toBe(true);
}

async function reviewButtonsFitAtMaxScroll(page: Page) {
  const main = page.locator('main');
  await main.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => main.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
  const pane = (await main.boundingBox())!;
  const nav = (await page.getByRole('navigation', { name: '主导航' }).boundingBox())!;
  for (const name of ['叫牌记录', '上一墩']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeInViewport();
    const box = (await button.boundingBox())!;
    expect(box.y + box.height, `${name} extends below its scrolling main pane`).toBeLessThanOrEqual(pane.y + pane.height + .5);
    expect(box.y + box.height, `${name} is covered by the fixed navigation`).toBeLessThanOrEqual(nav.y + .5);
  }
}

for (const [width, height] of [[320, 568], [360, 800], [430, 932], [568, 320], [800, 360], [932, 430]]) {
  test(`phone summary and fixed navigation ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const game = mobilePlay('E', 2);
    await open(page, game);
    if (width === 320 && height === 568) {
      // Check before scrolling: an overfull west dummy must never rise into
      // the north seat's label row when a short portrait pane scrolls.
      const north = page.getByTestId('table-seat-N').locator(':scope > div').first();
      const west = page.getByTestId('table-seat-W').locator(':scope > div').first();
      await expect(north).toBeInViewport();
      await expect(west).toBeInViewport();
      const n = (await north.boundingBox())!, w = (await west.boundingBox())!;
      const overlapX = Math.min(n.x + n.width, w.x + w.width) - Math.max(n.x, w.x);
      const overlapY = Math.min(n.y + n.height, w.y + w.height) - Math.max(n.y, w.y);
      expect(overlapX > 0 && overlapY > 0, 'north and west seat labels overlap').toBe(false);
      await page.screenshot({ path: 'artifacts/v322-ui/play-initial-320x568.png' });
    }
    const summary = page.getByTestId('trick-score');
    await expect(summary.getByTestId('score-contract')).toHaveText(/3NT XX东家庄/);
    await expect(summary.getByRole('meter', { name: /^南北/ })).toHaveAttribute('aria-valuenow', `${game.tricksWon.NS}`);
    await expect(summary.getByRole('meter', { name: /^东西/ })).toHaveAttribute('aria-valuenow', `${game.tricksWon.EW}`);
    await expect(summary.locator('[data-testid="score-target"]')).toHaveAttribute('data-target', '9');
    await targetCaptionFits(page);
    await expect(summary.getByText(`还差 ${9 - game.tricksWon.EW} 墩`, { exact: true })).toBeVisible();
    await expect(summary.getByText(/^还需 .* 墩成约$/)).toBeHidden();
    for (const locator of await page.getByTestId('bridge-table').locator('[data-card-count], [data-contract-summary]').all()) await expect(locator).toBeHidden();
    const hand = page.getByTestId('table-hand-S');
    const handBox = await hand.boundingBox(), scoreBox = await summary.boundingBox();
    expect(scoreBox!.y).toBeGreaterThanOrEqual(handBox!.y + handBox!.height);
    const nav = page.getByRole('navigation', { name: '主导航' });
    await expect(nav.getByRole('link')).toHaveCount(4);
    const before = await nav.boundingBox();
    await reviewButtonsFitAtMaxScroll(page);
    expect(await nav.boundingBox()).toEqual(before);
    expect(await summary.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const row = await hand.locator('button').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)));
    expect(new Set(row).size).toBe(1);
    await page.screenshot({ path: `artifacts/v322-ui/play-${width}x${height}.png` });
    if (width === 320 && height === 568) {
      // Match the actual short native WebView height as well as the fixture.
      await page.setViewportSize({ width: 320, height: 579 });
      await reviewButtonsFitAtMaxScroll(page);
      await page.screenshot({ path: 'artifacts/v322-ui/review-320x579.png' });
    }
  });
}

test('north-south declarer target caption stays separate on short portrait and landscape phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page, mobilePlay('S', 2));
  for (const [width, height] of [[320, 568], [360, 800], [568, 320], [800, 360]]) {
    await page.setViewportSize({ width, height });
    await targetCaptionFits(page);
    await reviewButtonsFitAtMaxScroll(page);
    await page.screenshot({ path: `artifacts/v322-ui/target-NS-${width}x${height}.png` });
  }
});

test('completed claim keeps one summary and review buttons on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const game = mobilePlay('S');
  await open(page, applyClaim(game, 'S', 9 - game.tricksWon.NS));
  await expect(page.getByTestId('trick-score')).toHaveAttribute('data-settled', 'true');
  await expect(page.getByTestId('score-contract')).toBeVisible();
  await expect(page.getByTestId('trick-score').getByText('成约', { exact: true })).toBeVisible();
  for (const locator of await page.getByTestId('bridge-table').locator('[data-contract-summary]').all()) await expect(locator).toBeHidden();
});

test('long auction retains its full record and can scroll independently', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await open(page, mobileLongAuction());
  const history = page.getByTestId('auction-history-scroll');
  await expect(history.locator('[data-explanation]')).toHaveCount(18);
  await history.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await expect(history.locator('[data-explanation]').first()).toBeInViewport();
});
