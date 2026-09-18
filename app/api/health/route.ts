import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Health endpoint (addition D3).
 *
 * Reports database reachability, migration state, and the active LLM provider
 * NAME. It never returns a key or any fragment of one — not a prefix, not a
 * length, not a masked form. `configured` is a boolean and nothing more.
 */

export const dynamic = "force-dynamic";

interface MigrationRow {
  name: string;
  finished_at: Date | null;
}

function providerName(): string {
  return process.env["LLM_PROVIDER"] ?? "mock";
}

function providerConfigured(provider: string): boolean {
  switch (provider) {
    case "mock":
      return true;
    case "anthropic":
      return !!process.env["ANTHROPIC_API_KEY"];
    case "azure-openai":
      return !!process.env["AZURE_OPENAI_ENDPOINT"] && !!process.env["AZURE_OPENAI_API_KEY"];
    case "openai-compatible":
      return !!process.env["OPENAI_COMPATIBLE_BASE_URL"];
    default:
      return false;
  }
}

export async function GET(): Promise<NextResponse> {
  const provider = providerName();

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

  const ok = databaseReachable && migrations.pending.length === 0;

  return NextResponse.json(
    {
      ok,
      database: { reachable: databaseReachable },
      migrations,
      llm: { provider, configured: providerConfigured(provider) },
    },
    { status: ok ? 200 : 503 },
  );
}
