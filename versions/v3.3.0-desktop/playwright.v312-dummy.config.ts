import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./artifacts/v312-dummy',testMatch:'dummy.spec.ts',workers:1,timeout:90000,
  outputDir:'artifacts/v312-dummy/test-results',
  reporter:[['list'],['json',{outputFile:'artifacts/v312-dummy/results.json'}]],
  use:{baseURL:process.env.V312_BASE_URL??'http://127.0.0.1:4186',channel:'msedge',screenshot:'only-on-failure',trace:'retain-on-failure'},
});
