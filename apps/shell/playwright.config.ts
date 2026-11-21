import { defineConfig, devices } from '@playwright/test';

// Hermetic E2E (HB-QUAL-03): the shell is served by `vite preview`, the PocketBase API is mocked
// with page.route, and no third-party site is contacted.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:4173', ...devices['Pixel 7'], trace: 'off' },
  projects: [{ name: 'phone-chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm run build && pnpm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
