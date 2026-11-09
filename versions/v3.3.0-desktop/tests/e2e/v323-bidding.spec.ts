import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseCall } from '../fixtures/v323-bidding';

const fixtureBytes = readFileSync('artifacts/v323-actual-table/production-sessions.json');
const fixtures = JSON.parse(fixtureBytes.toString()) as { id: string; expected: string; system: string; raw: string; turn: string }[];
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const key = 'bridgelab.session.v3.6';
for (const row of fixtures) {
  test(`production robot applies ${row.id}`, async ({ page }) => {
    const prefixLength = JSON.parse(row.raw).current.actions.length;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ key, raw }) => { localStorage.setItem(key, raw); }, { key, raw: row.raw });
    const html = await (await page.request.get('/')).text();
    expect(html).not.toContain('/@vite/client');
    const script = html.match(/assets\/(index-[\w-]+\.js)/)![1];
    const actualBytes = await (await page.request.get('/assets/' + script)).body();
    expect(sha(actualBytes)).toBe(sha(readFileSync('dist/assets/' + script)));
    await page.goto('/#/table');
    await expect(page.getByText('v3.2.3', { exact: true })).toHaveText('v3.2.3');
    await expect.poll(() => page.evaluate(({ key, index }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      return save.current?.actions[index]?.call ?? null;
    }, { key, index: prefixLength })).toEqual(parseCall(row.expected));
    const result = await page.evaluate(({ key, index }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      const app = document.querySelector<HTMLElement>('[data-testid="app"]')!;
      return { action: save.current.actions[index], current: save.current,
        model: { profile: app.dataset.slProfile, sha256: app.dataset.slLoadedSha,
          route: app.dataset.slLastRoute, status: app.dataset.slStatus },
        version: document.title, body: document.body.innerText };
    }, { key, index: prefixLength });
    expect(result.action.seat).toBe(row.turn);
    expect(result.model.profile).toBe('seed101-epoch08');
    expect(result.model.sha256).toBe('41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3');
    expect(result.body).not.toContain('牌局出现异常');
    expect(errors).toEqual([]);
    mkdirSync('artifacts/v323-production', { recursive: true });
    writeFileSync(`artifacts/v323-production/${row.id}.json`, JSON.stringify({ id: row.id,
      expected: parseCall(row.expected), source: 'Actual production page normal robot timer and persisted action',
      fixtureSHA256: sha(fixtureBytes), bundle: script, bundleSHA256: sha(actualBytes),
      action: result.action, model: result.model, pageErrors: errors }, null, 2));
  });
}
