import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Needs Postgres: `npm run db:up`, or TEST_DATABASE_URL.
    globalSetup: ['tests/support/global-setup.ts'],
    setupFiles: ['tests/support/database.ts'],
    hookTimeout: 30_000,
    // Expected warnings (canceled applications, failed exchanges) are noise here.
    env: { LOG_LEVEL: 'silent' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
