import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps',
  // Playwright's default testMatch also picks up the vitest `*.test.ts` files that live beside the
  // app sources, which then crash on `describe`. Each app keeps its own `e2e/`, so match on that
  // rather than narrowing testDir to one of them.
  testMatch: '**/e2e/**/*.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @ppt4ai/ime-lab dev --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @ppt4ai/editor build && pnpm --filter @ppt4ai/playground dev --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
