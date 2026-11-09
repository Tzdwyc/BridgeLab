import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './artifacts/v313-ui', testMatch: 'v313-ui.spec.ts', workers: 1, fullyParallel: false,
  timeout: 120000, expect: { timeout: 10000 },
  outputDir: './artifacts/v313-ui/test-results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/v313-ui/results.json' }], ['html', { outputFolder: 'artifacts/v313-ui/report', open: 'never' }]],
  use: { baseURL: process.env.V313_BASE_URL ?? 'http://127.0.0.1:4187', channel: 'msedge', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.V313_BASE_URL ? undefined : {
    command: 'npm run preview -- --port 4187 --strictPort', url: 'http://127.0.0.1:4187', reuseExistingServer: false,
  },
});
