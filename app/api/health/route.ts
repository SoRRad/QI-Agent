import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { driverFromEnv } from "@/lib/llm";
import { loadPhiConfig } from "@/lib/phi";

/**
 * Health endpoint (addition D3).
 *
 * Reports database reachability, migration state, the active LLM provider and
 * model NAMES, and whether the PHI scanner's extension file loaded. It never
 * returns a key or any fragment of one — not a prefix, not a length, not a
 * masked form. `configured` is a boolean and nothing more.
 */

export const dynamic = "force-dynamic";

interface MigrationRow {
  name: string;
  finished_at: Date | null;
}

function llmStatus(): { provider: string; model: string | null; configured: boolean } {
  const provider = process.env["LLM_PROVIDER"] ?? "mock";
  try {
    // The same selection the application uses, so health cannot disagree with
    // what a real request would do.
    const driver = driverFromEnv();
    return { provider: driver.name, model: driver.model, configured: true };
  } catch {
    return { provider, model: null, configured: false };
  }
}

export async function GET(): Promise<NextResponse> {
  let databaseReachable = false;
  let migrations: { applied: number; pending: string[]; latest: string | null } = {
    applied: 0,
    pending: [],
    latest: null,
  };

  try {
    const rows = await db.$queryRawUnsafe<MigrationRow[]>(
      `SELECT "migration_name" AS name, "finished_at" FROM "_prisma_migrations" ORDER BY "started_at" ASC`,
    );
    databaseReachable = true;
    const applied = rows.filter((r) => r.finished_at !== null);
    migrations = {
      applied: applied.length,
      pending: rows.filter((r) => r.finished_at === null).map((r) => r.name),
      latest: applied.at(-1)?.name ?? null,
    };
  } catch {
    databaseReachable = false;
  }

  const phi = loadPhiConfig();
  const llm = llmStatus();
  const ok = databaseReachable && migrations.pending.length === 0 && llm.configured;

  return NextResponse.json(
    {
      ok,
      database: { reachable: databaseReachable },
      migrations,
      llm,
      phi: {
        // The built-in rules always apply; this reports only the committee's
        // extension file. An invalid file is ignored, loudly, not half-applied.
        extensionFileValid: phi.error === null,
        additionalRules: phi.rules.length,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
