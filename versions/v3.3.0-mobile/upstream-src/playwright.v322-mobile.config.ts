import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'v322-mobile-summary.spec.ts', workers: 1,
  timeout: 45000, expect: { timeout: 10000 },
  outputDir: './artifacts/v322-ui/test-results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/v322-ui/results.json' }]],
  use: { baseURL: process.env.V322_BASE_URL ?? 'http://127.0.0.1:5214', channel: 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.V322_BASE_URL ? undefined : { command: 'npm run preview -- --port 5214 --strictPort', url: 'http://127.0.0.1:5214', reuseExistingServer: false },
});
