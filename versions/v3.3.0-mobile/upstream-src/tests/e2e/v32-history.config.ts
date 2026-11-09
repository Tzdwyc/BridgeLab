import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.', testMatch: 'v32-history-navigation.spec.ts', webServer: undefined,
  reporter: [['list'], ['json', { outputFile: process.cwd()+'/artifacts/v32-history-navigation-production.json' }]],
  use: { ...base.use, baseURL: process.env.V32_BASE_URL ?? 'http://127.0.0.1:4182' },
  projects: [{ name: 'desktop', use: { ...base.projects![0].use, channel: 'msedge' } }]
});
