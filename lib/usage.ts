/**
 * Usage instrumentation (addition D4).
 *
 * These counts are the institutional funding case, and they are worthless if
 * collection starts late — so every counted action records from day one, even
 * where the dashboard that reads them does not exist yet.
 */

import { db } from "@/lib/db";
import type { Role, UsageEventKind } from "@/lib/generated/prisma/client";

export interface UsageActor {
  id?: string | null;
  role?: Role | null;
  programId?: string | null;
}

export async function recordUsage(
  kind: UsageEventKind,
  actor: UsageActor = {},
  extra?: { entityId?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.usageEvent.create({
    data: {
      kind,
      userId: actor.id ?? null,
      role: actor.role ?? null,
      programId: actor.programId ?? null,
      entityId: extra?.entityId ?? null,
      metadata: (extra?.metadata ?? undefined) as never,
    },
  });
}
