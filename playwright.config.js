import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({testDir:'./tests/e2e',workers:1,use:{baseURL:'http://127.0.0.1:5173',viewport:{width:1500,height:970},launchOptions:{executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}},webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI}});
