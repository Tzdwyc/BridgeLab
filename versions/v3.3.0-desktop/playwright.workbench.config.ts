import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',testMatch:'v037-workbench.spec.ts',outputDir:'artifacts/workbench-test-results',workers:1,fullyParallel:false,timeout:90000,
 reporter:[['list'],['json',{outputFile:'artifacts/v037-workbench-e2e.json'}]],
 use:{baseURL:'http://127.0.0.1:4178',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}},
});

