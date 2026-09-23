import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { E2E_TRAINEE_EMAIL, TRAINEE_BASE_URL, TRAINEE_PORT } from "./tests/e2e/env";

/**
 * The browser suite runs its own server, on its own port, against the TEST
 * database. It never reuses a development server: flows here trip PHI blocks,
 * and the audit log they write to is append-only, so running them against the
 * demo database would leave permanent rows in the audit trail a demo shows.
 */
const PORT = process.env["E2E_PORT"] ?? "3100";
const baseURL = process.env["E2E_BASE_URL"] ?? `http://127.0.0.1:${PORT}`;
const databaseUrl = process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"];


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
  globalSetup: "./tests/e2e/global-setup.ts",
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
    : [
        {
          command: "pnpm start",
          url: `${baseURL}/api/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            PORT,
            ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
          },
        },
        // A second production server whose configured identity is a trainee.
        // Production ignores the dev role switcher, so this is how the suite
        // exercises trainee-only flows (the pulse survey) without adding a way
        // to change user that production would also have.
        {
          command: "pnpm start",
          url: `${TRAINEE_BASE_URL}/api/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            PORT: TRAINEE_PORT,
            DEV_USER_EMAIL: E2E_TRAINEE_EMAIL,
            ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
          },
        },
      ],
});
