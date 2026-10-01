import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end suite. It expects the built frontend to be served by the
 * FastAPI app. Build first (`npm run build`); the webServer block then starts
 * uvicorn. Override the target with DC_TEST_URL for an external deployment.
 */
const url = process.env.DC_TEST_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: url, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.DC_TEST_URL
    ? undefined
    : {
        command: 'python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000',
        url: `${url}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
