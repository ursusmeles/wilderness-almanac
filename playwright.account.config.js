import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'account.spec.js',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4180' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort',
    env: { VITE_API_ENABLED: 'true' },
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});
