import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,retries:0,
  reporter:'list',outputDir:'.local/browser-results',
  use:{baseURL:'http://127.0.0.1:8787',trace:'off',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['Pixel 7'],defaultBrowserType:'chromium'}}],
  webServer:{command:'npm run dev',url:'http://127.0.0.1:8787/api/health',reuseExistingServer:!process.env.CI,timeout:60_000},
});
