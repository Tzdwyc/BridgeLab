import { test, expect, type Page } from '@playwright/test';
import { newGame, applyCall } from '../../src/core/game';
import { encodeSession, emptySession } from '../../src/persistence/session';
import { PASS, type Call, type Strain } from '../../src/core/types';

async function publicHistory(page: Page, sequence: string) {
  let game = newGame(1, 'v033-contextual-history-ui');
  for (const token of sequence.split(' ')) {
    const call: Call = token === 'P' ? PASS : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
    game = applyCall(game, game.turn, call);
  }
  await page.addInitScript(raw => localStorage.setItem('bridgelab.session.v3.6', raw),
    encodeSession({ ...emptySession(), game, delay: 1100, playStrength: 'basic' }));
  await page.goto('/#/table');
}

// GPT-selected contextual meanings, checked in the visible history rather than an opening placeholder.
test('two-over-one and opener continuation show their original game force on hover', async ({ page }) => {
  await publicHistory(page, '1S P 2H P 3C P');
  await page.getByLabel('南 2♥', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('13+');
  await expect(page.getByRole('tooltip')).toContainText(/5\+张|5张/);
  await expect(page.getByRole('tooltip')).toContainText(/进局逼叫|逼局/);
  await page.mouse.move(0, 0);
  await page.getByLabel('北 3♣', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText(/进局逼叫|逼局/);
  await expect(page.getByRole('tooltip')).toContainText('v0.3.6');
  await expect(page.getByRole('tooltip')).not.toContainText('范围详见体系卡');
  await page.screenshot({ path: 'artifacts/v033-contextual-hover-desktop.png' });
});

test('a passed-hand new suit is explained as nonforcing in the history', async ({ page }) => {
  await publicHistory(page, 'P P 1C P 1H P 1S P');
  await page.getByLabel('北 1♥', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('6–12 HCP');
  await expect(page.getByRole('tooltip')).toContainText('不逼叫');
});

test('a weak-two raise stays preemptive and can be read by touch hold', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await publicHistory(page, '2D P 3D P');
  const raise = page.getByLabel('南 3♦', { exact: true });
  await raise.scrollIntoViewIfNeeded();
  await raise.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 9, isPrimary: true });
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByRole('tooltip')).toContainText(/阻击|阻塞/);
  await expect(page.getByRole('tooltip')).toContainText('不逼叫');
  await expect(page.getByRole('tooltip')).toContainText('不额外承诺邀请');
  const bounds = await page.getByRole('tooltip').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/v033-contextual-longpress-mobile.png' });
  await raise.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 9, isPrimary: true });
});
