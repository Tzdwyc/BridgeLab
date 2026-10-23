import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', outputDir: '../../artifacts/table-runs/run-' + Date.now(), testMatch: 'v037-table-*.spec.ts', workers: 1, timeout: 120000, use: { baseURL: process.env.BRIDGELAB_TEST_URL || 'http://127.0.0.1:4179', headless: true, channel: 'msedge', screenshot: 'only-on-failure' }, reporter: [['list']] });





