import { test, expect, type Page } from '@playwright/test';
import { encodeSession } from '../../src/persistence/session';
import { incidentSession } from '../fixtures/android-stack-incident';

const key = 'bridgelab.session.v3.6';
const legacyKey = 'bridgelab.session.v3.5';
async function restore(page: Page) {
  const saved = encodeSession(incidentSession());
  await page.addInitScript(({ raw, storageKey }) => {
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, raw);
  }, { raw: saved, storageKey: legacyKey });
  await page.goto('/#/table');
  await expect(page.getByText('选择叫品', { exact: true })).toBeVisible();
  await expect(page.getByText('BridgeLab 暂时无法显示牌桌')).toHaveCount(0);
  return saved;
}
async function readyForSouth(page: Page) {
  await expect.poll(async () => {
    const app = page.getByTestId('app'), phase = await app.getAttribute('data-phase');
    return phase === 'complete' || phase === 'passedOut' || await app.getAttribute('data-controller') === 'S';
  }, { timeout: 30000 }).toBe(true);
}

for (const mobile of [false, true]) {
  test(`v035 reported board20 survives restore/reload and continues (${mobile ? 'phone' : 'desktop'})`, async ({ page }, info) => {
    if (mobile) await page.setViewportSize({ width: 393, height: 852 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const saved = await restore(page);
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), legacyKey)).toBe(saved);
    const bids = page.getByRole('button', { name: /^叫 [1-7](C|D|H|S|NT)$/ });
    await expect(bids).toHaveCount(35);
    await expect(page.getByRole('button', { name: '叫 1C', exact: true })).toBeDisabled();
    // The disabled low controls are still given explanations during render.
    expect((await page.getByRole('button', { name: '叫 1C', exact: true }).getAttribute('title'))!.length).toBeGreaterThan(0);
    expect((await page.getByRole('button', { name: '叫 2NT', exact: true }).getAttribute('title'))!.length).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByText('选择叫品', { exact: true })).toBeVisible();
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), legacyKey)).toBe(saved);
    await page.screenshot({ path: `artifacts/stack-regression/incident-${mobile ? 'phone' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('button', { name: '不叫 Pass', exact: true }).click();
    await expect.poll(async () => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).current.actions.length, key)).toBeGreaterThan(3);
    const current = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key);
    expect(current.current.board).toBe(20);
    expect(current.history).toHaveLength(19);
    expect(errors).toEqual([]);
    await info.attach('incident-restored-session', { body: JSON.stringify({ mobile, errors, currentActions: current.current.actions.length,
      historyCount: current.history.length, board: current.current.board }), contentType: 'application/json' });
  });
}

test('reported board20 completes all 52 cards offline after recovery and survives offline reload', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await restore(page);
  await expect(page.getByText('● 离线资源已缓存', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('打牌强度').selectOption('basic');
  await page.getByLabel('机器人行动速度').selectOption('0');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('● 离线模式', { exact: true })).toBeVisible();
  await expect(page.getByText('选择叫品', { exact: true })).toBeVisible();
  // South has not previously named NT; 7NT gives South control of declarer/dummy
  // and deterministically exercises all human play decisions rather than passing out.
  await page.getByRole('button', { name: '叫 7NT', exact: true }).click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'play');
  let decisions = 0;
  for (let guard = 0; guard < 80; guard++) {
    await readyForSouth(page);
    if (await page.getByTestId('app').getAttribute('data-phase') === 'complete') break;
    const card = page.locator('button[data-card]:not([disabled])').first();
    await expect(card).toBeVisible();
    await card.click();
    decisions++;
  }
  expect(decisions).toBe(26);
  await expect(page.getByText('已完成 13 墩 · 查看记录', { exact: true })).toBeVisible();
  const before = await page.evaluate(storageKey => localStorage.getItem(storageKey), key);
  const record = JSON.parse(before!);
  expect(record.current.actions.filter((action: { kind: string }) => action.kind === 'play')).toHaveLength(52);
  await page.reload();
  await expect(page.getByTestId('result')).toBeVisible();
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe(before);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/stack-regression/incident-offline-complete.png', fullPage: true });
  await info.attach('offline-completion', { body: JSON.stringify({ board: 20, offline: true, decisions, cards: 52, tricks: 13,
    errors, historyCount: record.history.length }), contentType: 'application/json' });
});
