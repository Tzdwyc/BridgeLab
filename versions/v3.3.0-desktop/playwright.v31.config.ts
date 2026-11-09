import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './artifacts/v31-ui', testMatch: 'v31-ui.spec.ts', workers: 1, fullyParallel: false,
  timeout: 120000, expect: { timeout: 10000 },
  outputDir: './artifacts/v31-ui/test-results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/v31-ui/results.json' }], ['html', { outputFolder: 'artifacts/v31-ui/report', open: 'never' }]],
  use: { baseURL: process.env.V31_BASE_URL ?? 'http://127.0.0.1:4184', channel: 'msedge', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.V31_BASE_URL ? undefined : {
    command: 'npm run preview -- --port 4184 --strictPort', url: 'http://127.0.0.1:4184', reuseExistingServer: false,
  },
});
