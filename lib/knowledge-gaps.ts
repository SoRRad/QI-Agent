import { db } from "@/lib/db";

/**
 * The queue of documents the institution still owes.
 *
 * Every question Ask cannot answer from the library lands here, as does every
 * answer that had to rely on a LOCAL placeholder. Near-duplicate questions —
 * the same thing asked in different words — increment one gap rather than
 * adding a row each, using pg_trgm similarity, so the chair sees "asked 14
 * times" rather than fourteen rows.
 */

const SIMILARITY_THRESHOLD = 0.55;

export async function logKnowledgeGap(args: {
  question: string;
  gapSummary: string;
  askedById: string | null;
}): Promise<{ id: string; merged: boolean }> {
  const similar = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "KnowledgeGap"
    WHERE "status" IN ('open', 'doc_planned')
      AND similarity("question", ${args.question}) > ${SIMILARITY_THRESHOLD}
    ORDER BY similarity("question", ${args.question}) DESC
    LIMIT 1`;

  const existing = similar[0];
  if (existing) {
    await db.knowledgeGap.update({
      where: { id: existing.id },
      data: { askCount: { increment: 1 } },
    });
    return { id: existing.id, merged: true };
  }

  const created = await db.knowledgeGap.create({
    data: { question: args.question, gapSummary: args.gapSummary, askedById: args.askedById },
  });
  return { id: created.id, merged: false };
}
