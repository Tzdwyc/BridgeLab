import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e', fullyParallel:false,workers:1,timeout:90000,expect:{timeout:12000},
 reporter:[['list'],['json',{outputFile:'artifacts/e2e-migration-before.json'}]],
 use:{baseURL:'http://127.0.0.1:4180',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000},launchOptions:{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}}}],
 webServer:{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4180 --strictPort',url:'http://127.0.0.1:4180',reuseExistingServer:false}
});
