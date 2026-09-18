// Tests that touch the database read DATABASE_URL from .env, the same as the
// application. Suites that need it skip themselves when it is absent so the
// unit suite still runs on a machine with no Postgres.
import "dotenv/config";
