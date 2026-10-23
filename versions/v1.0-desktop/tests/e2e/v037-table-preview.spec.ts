import { test, expect } from '@playwright/test';
import { newGame, applyCall, playCard } from '../../src/core/game';
import { legalCards } from '../../src/core/play';
import { emptySession, encodeSession, STORAGE_KEY } from '../../src/persistence/session';
import { PASS } from '../../src/core/types';

test('table preview captures', async ({ page }) => {
  const initial = newGame(1, 'BridgeLab-v037-preview');
  let auction = applyCall(initial, initial.turn, { kind: 'bid', level: 1, strain: 'H' });
  auction = applyCall(auction, auction.turn, PASS);
  let play = auction;
  play = applyCall(play, play.turn, { kind: 'bid', level: 2, strain: 'H' });
  for (let i = 0; i < 3; i++) play = applyCall(play, play.turn, PASS);
  play = playCard(play, play.turn, legalCards(play.hands[play.turn], play.currentTrick)[0].id);
  await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key: STORAGE_KEY, raw: encodeSession({ ...emptySession(), game: auction, delay: 1100, playStrength: 'basic' }) });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/#/table');
  await expect(page.getByTestId('bridge-table')).toBeVisible();
  await page.screenshot({ path: 'artifacts/preview/table-desktop-1440x900.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/preview/table-phone-390x844.png' });
  const raw = encodeSession({ ...emptySession(), game: play, delay: 1100, playStrength: 'basic' });
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
  await page.setViewportSize({ width: 844, height: 390 }); await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'play');
  await page.screenshot({ path: 'artifacts/preview/table-landscape-play-844x390.png' });
});
