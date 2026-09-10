import { defineConfig, devices } from "@playwright/test";

// docs/06-test-plan.md Section 5 (System Test Scenarios) and Section 2's
// tooling table ("Playwright for end-to-end system tests"). Points at a
// local dev server by default (spawned automatically below); set
// E2E_BASE_URL to run the same specs against a real deployment (staging,
// once one exists -- see DEPLOYMENT.md) instead, in which case this
// config assumes something else is already serving that URL and doesn't
// try to spawn anything.

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const usingLocalDevServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // This environment pre-installs Chromium at a fixed path rather
        // than the version @playwright/test's package.json pins -- point
        // at it directly instead of trying to download a matching build.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  ...(usingLocalDevServer
    ? {
        webServer: {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
});
