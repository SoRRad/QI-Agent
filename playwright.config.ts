import { defineConfig } from "@playwright/test";

const PORT = process.env["PORT"] ?? "3000";
const baseURL = process.env["E2E_BASE_URL"] ?? `http://127.0.0.1:${PORT}`;

/**
 * Where a sandbox or CI image ships its own Chromium rather than the revision
 * this Playwright version pins, point at it with
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE instead of downloading a second browser.
 * Unset, Playwright resolves its own. See docs/DEPLOY.md.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
const launchOptions = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  // Both viewports are exercised for every destination, including axe
  // assertions. 375px is the primary target: trainees use this on a phone.
  projects: [
    {
      name: "mobile-375",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        ...launchOptions,
      },
    },
    {
      name: "desktop-1280",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
        ...launchOptions,
      },
    },
  ],
  webServer: process.env["E2E_BASE_URL"]
    ? undefined
    : {
        command: "pnpm start",
        url: baseURL,
        reuseExistingServer: !process.env["CI"],
        timeout: 120_000,
      },
});
