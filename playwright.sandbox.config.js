import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';

// Focused source-served checks for Sandbox tools on desktop and mobile.
export default defineConfig({
  ...config,
  testMatch: ['party-journal.spec.js', 'panels.spec.js', 'workspace-controls.spec.js'],
  reporter: 'list',
  use: { ...config.use, baseURL: 'http://127.0.0.1:4180' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});
