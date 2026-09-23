import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runStallJob } from "@/lib/jobs/stall";
import { runWithContext } from "@/lib/request-context";

/**
 * The nightly stall job (ADR-0001). The logic is lib/jobs/stall.ts; this route
 * only authenticates the caller.
 *
 * Accepted credentials, both compared in constant time against JOB_SECRET:
 *   - `x-job-secret: <secret>`         the self-hosted scheduler in docker-compose
 *   - `authorization: Bearer <secret>` Vercel Cron (set CRON_SECRET = JOB_SECRET)
 *
 * The route refuses to run at all when JOB_SECRET is unset, or left at the
 * example value in production.
 */

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env["JOB_SECRET"];
  if (!secret) return false;
  if (process.env.NODE_ENV === "production" && secret === "change-me-in-production") return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const header = request.headers.get("x-job-secret") ?? "";
  const expected = Buffer.from(secret);
  return [bearer, header].some((given) => {
    const g = Buffer.from(given);
    return g.length === expected.length && timingSafeEqual(g, expected);
  });
}

async function handle(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const result = await runWithContext({ userId: null, acknowledgedPhi: new Set() }, () =>
    runStallJob({ baseUrl: process.env["APP_URL"] ?? "" }),
  );
  // Ids and counts only: titles are fine to return, reasons are not needed by a scheduler.
  return NextResponse.json({ checked: result.checked, stalled: result.stalled.map((s) => s.id) });
}

export const POST = handle;
export const GET = handle;
