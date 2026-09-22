import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { phiExtension, type AuditWriter } from "@/lib/phi/extension";

/**
 * The ONLY place a database client is constructed for application code.
 *
 * Every client returned from here carries the PHI guard (lib/phi/extension.ts)
 * inside it, so free text cannot reach a table without being scanned.
 * tests/phi/chokepoint.test.ts fails the build if anything under app/, lib/ or
 * components/ constructs a client of its own or writes with raw SQL.
 *
 * Prisma 7 connects through a driver adapter rather than its own engine
 * binary; keeping the adapter here keeps the connection story in one file for
 * the self-hosted path.
 */
function baseClient(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function createDb() {
  const base = baseClient();

  // Writes PHI audit entries through the UNEXTENDED client, on its own
  // connection. A blocked write rolls back its transaction; the record that it
  // was blocked must not roll back with it.
  const writeAudit: AuditWriter = async (entry) => {
    await base.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata as never,
      },
    });
  };

  return base.$extends(phiExtension(writeAudit));
}

export type Db = ReturnType<typeof createDb>;

// A single client across hot reloads in development; Next re-evaluates modules
// on every change and each new client opens its own connection pool.
const globalForDb = globalThis as unknown as { db?: Db };

export const db: Db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
