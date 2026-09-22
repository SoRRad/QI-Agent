/**
 * Prepares the TEST database: applies migrations and loads the demo seed.
 *
 *   pnpm test:db:prepare
 *
 * Tests run against DATABASE_URL_TEST, never the development database. The
 * audit log is append-only by design, so tests that exercise PHI blocks would
 * otherwise leave permanent rows in the audit trail a demo shows.
 *
 * Deliberately NON-DESTRUCTIVE at the schema level: `migrate deploy` only
 * applies pending migrations and never drops anything. The seed then replaces
 * the demo rows. Two guards keep this away from real data: the target must
 * differ from DATABASE_URL, and its database name must contain "test".
 */
import "dotenv/config";
import { execSync } from "node:child_process";

const url = process.env["DATABASE_URL_TEST"];
if (!url) {
  console.error("DATABASE_URL_TEST is not set. Add it to .env; see .env.example.");
  process.exit(1);
}
if (url === process.env["DATABASE_URL"]) {
  console.error("DATABASE_URL_TEST must point at a different database from DATABASE_URL.");
  process.exit(1);
}
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (!/test/i.test(databaseName)) {
  console.error(`Refusing to prepare "${databaseName}": a test database's name must contain "test".`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url };
execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env });
execSync("pnpm exec tsx prisma/seed.ts", { stdio: "inherit", env });
console.log(`\ntest database "${databaseName}" is migrated and seeded`);
