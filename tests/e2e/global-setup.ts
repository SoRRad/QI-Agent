import { execSync } from "node:child_process";

/**
 * Reseeds the TEST database before the suite, so flows that change state —
 * submitting the pulse survey, theming responses, publishing a digest — start
 * from the same demo every run. Skipped when the suite targets an external
 * server (E2E_BASE_URL), which owns its own data.
 */
export default function globalSetup(): void {
  if (process.env["E2E_BASE_URL"]) return;
  execSync("pnpm -s test:db:prepare", { stdio: "inherit" });
}
