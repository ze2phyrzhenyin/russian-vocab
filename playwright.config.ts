import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',timeout:90000,expect:{timeout:15000},fullyParallel:false,workers:1,retries:0,reporter:[['list'],['html',{open:'never'}]],
  webServer:process.env.PLAYWRIGHT_BASE_URL?undefined:{command:'pnpm start',url:'http://localhost:4186/api/config',reuseExistingServer:true,timeout:30000},
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4186',trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
