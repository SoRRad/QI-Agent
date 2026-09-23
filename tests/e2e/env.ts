/**
 * Where the browser suite's servers are. The trainee server runs the same
 * production build with a trainee as its configured identity (see
 * playwright.config.ts).
 */
export const TRAINEE_PORT = process.env["E2E_TRAINEE_PORT"] ?? "3101";
export const TRAINEE_BASE_URL = process.env["E2E_TRAINEE_BASE_URL"] ?? `http://127.0.0.1:${TRAINEE_PORT}`;
/** A seeded trainee who has not responded to the open pulse survey. */
export const E2E_TRAINEE_EMAIL = "resident2.medicine@example.edu";
