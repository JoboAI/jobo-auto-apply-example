import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3311',
    viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx tests/e2e/server.ts',
    url: 'http://127.0.0.1:3311',
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: 'list',
})
