import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'v323-bidding.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 12000 },
  outputDir: './artifacts/v323-production/test-results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/v323-production/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5215', channel: 'msedge', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
