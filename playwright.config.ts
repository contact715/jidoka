import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the project Customer Portal E2E.
 *
 * Tests run against the Next.js dev server on :3000 (or :3001 if 3000
 * is busy). The store runs in mock mode by default, so tests work
 * without backend — click through login → dashboard → order accept →
 * message send, all against seeded data.
 *
 * Run locally: `npm run e2e`
 * Debug:       `npm run e2e:debug`
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PORTAL_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Wave-32d — reducedMotion belongs in the project-level `use` block,
    // not per-spec test.use(). The latter is TS2353 in @playwright/test
    // ≥ 1.50. Set once here so every spec inherits the same animation-off
    // stabilisation for deterministic screenshots + click handling.
    contextOptions: {
      reducedMotion: "reduce",
    },
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],

  // Wave-46 — drop the `process.env.CI ? ... : undefined` guard.
  //
  // Wave-32b shipped this gated on CI mode to avoid double-starting dev
  // when the user already had it running locally. The wave-40 + wave-45
  // SI Reviews both flagged the gate as the root cause of recurring
  // "rendered-verification skipped" gaps — locally, Playwright would not
  // start its own server, so visual specs required the user to start
  // dev manually with mocks. That manual prereq was skipped wave after
  // wave (4 retros documented it as honest-gap).
  //
  // Fix: always boot a mock-mode dev server. `reuseExistingServer: true`
  // means if the user already has dev running on :3000 in mock mode it
  // gets reused; otherwise Playwright starts one. No more manual prereq.
  webServer: {
    command: "NEXT_PUBLIC_USE_MOCKS=true npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
