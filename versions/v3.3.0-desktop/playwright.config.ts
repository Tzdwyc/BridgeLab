import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  timeout: 90000, expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'artifacts/e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4177', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }
  ],
  webServer: { command: 'npm run preview -- --port 4177 --strictPort', url: 'http://127.0.0.1:4177', reuseExistingServer: false }
});
