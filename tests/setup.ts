// Tests that touch the database use DATABASE_URL_TEST — a separate database
// prepared by `pnpm test:db:prepare` — never the development database. The
// audit log is append-only, so tests exercising PHI blocks would otherwise
// leave permanent rows in the audit trail a demo shows.
//
// Suites that need a database skip themselves when neither is set, so the
// unit suite still runs on a machine with no Postgres.
import "dotenv/config";

if (process.env["DATABASE_URL_TEST"]) {
  process.env["DATABASE_URL"] = process.env["DATABASE_URL_TEST"];
}
