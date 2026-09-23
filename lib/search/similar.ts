import { db } from "@/lib/db";
import type { LlmDependencies } from "@/lib/llm";
import { LlmOutputError, LlmRefusalError } from "@/lib/llm";
import { runPrompt } from "@/lib/llm/run";
import { duplicateRerankPrompt } from "@/lib/llm/prompts";

/**
 * "Has anyone already tried this?" — duplicate detection at intake (ADR-0003).
 *
 *   1. Recall: pg_trgm similarity over title and problem statement, across
 *      every program and every status, archived included. Archived projects
 *      are the most useful precedent there is.
 *   2. Judgement: one model call over the candidates, returning which match
 *      and a sentence on what overlaps.
 *
 * What a prior project achieved and why it ended come from its record, never
 * from the model. If the model is unavailable, the recall candidates are
 * still shown, labelled as unranked: the committee would rather a trainee see
 * a possibly-related project than nothing.
 */

export const RECALL_LIMIT = 15;

export interface SimilarProject {
  id: string;
  title: string;
  program: string;
  cohortYear: number | null;
  status: string;
  outcomeSummary: string | null;
  endReason: string | null;
  /** The model's sentence on what overlaps; null when unranked. */
  reason: string | null;
}

export interface SimilarResult {
  ranked: boolean;
  projects: SimilarProject[];
}

interface Row {
  id: string;
  title: string;
  problemStatement: string;
  status: string;
  cohortYear: number | null;
  outcomeSummary: string | null;
  endReason: string | null;
  program: string;
  score: number;
}

export async function recallSimilar(
  text: { title: string; problemStatement: string },
  excludeId: string | null,
): Promise<Row[]> {
  return db.$queryRaw<Row[]>`
    SELECT p.id, p.title, p."problemStatement", p.status::text AS status, p."cohortYear",
           p."outcomeSummary", p."endReason", pr.name AS program,
           GREATEST(
             similarity(p.title, ${text.title}),
             word_similarity(${text.title}, p.title),
             similarity(p."problemStatement", ${text.problemStatement}),
             word_similarity(${text.problemStatement}, p."problemStatement")
           )::float AS score
    FROM "Project" p JOIN "Program" pr ON pr.id = p."programId"
    WHERE p.id <> ${excludeId ?? ""}
    ORDER BY score DESC
    LIMIT ${RECALL_LIMIT}
  `;
}

export async function findSimilarProjects(
  text: { title: string; problemStatement: string },
  context: { excludeId: string | null; userId: string | null },
  deps: LlmDependencies = {},
): Promise<SimilarResult> {
  const rows = await recallSimilar(text, context.excludeId);
  if (rows.length === 0) return { ranked: true, projects: [] };

  const keyed = rows.map((row, i) => ({ key: `p${i + 1}`, row }));
  const toProject = (row: Row, reason: string | null): SimilarProject => ({
    id: row.id,
    title: row.title,
    program: row.program,
    cohortYear: row.cohortYear,
    status: row.status,
    outcomeSummary: row.outcomeSummary,
    endReason: row.endReason,
    reason,
  });

  try {
    const output = await runPrompt(
      duplicateRerankPrompt,
      {
        title: text.title,
        problemStatement: text.problemStatement,
        candidates: keyed.map(({ key, row }) => ({
          key,
          title: row.title,
          problemStatement: row.problemStatement,
          program: row.program,
          cohortYear: row.cohortYear,
          status: row.status,
        })),
      },
      { userId: context.userId },
      deps,
    );
    const byKey = new Map(keyed.map(({ key, row }) => [key, row]));
    return {
      ranked: true,
      projects: output.matches.flatMap((m) => {
        const row = byKey.get(m.key);
        return row ? [toProject(row, m.reason)] : [];
      }),
    };
  } catch (error) {
    if (!(error instanceof LlmOutputError || error instanceof LlmRefusalError)) {
      // A configuration or network failure should not block intake.
      console.error("[projects.duplicate_rerank] unavailable", error);
    }
    return { ranked: false, projects: rows.slice(0, 3).map((row) => toProject(row, null)) };
  }
}
