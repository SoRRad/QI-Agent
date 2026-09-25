import { toCsv } from "@/lib/csv";
import { MAX_TOTAL, RUBRIC, weightedTotal, type RubricScores } from "./rubric";

/**
 * Aggregating judges' scores into results (§6.6), with ties handled on
 * purpose rather than by accident.
 *
 * - A submission's score is the mean of its judges' weighted totals.
 * - Means are compared exactly (sum × count cross-multiplied, all integers),
 *   so two submissions tie when they genuinely tie, not when two rounded
 *   decimals happen to match — and never differ by a rounding artefact.
 * - Tied submissions share a rank (competition ranking: 1, 1, 3). Breaking a
 *   tie is the committee's decision, not an ordering the software invents;
 *   the export says which ranks are shared.
 * - Only submissions scored by every assigned judge are ranked. The rest are
 *   listed as awaiting scores: a provisional rank moves when the last judge
 *   scores, and would be read as final.
 */

export interface SubmissionScores {
  submissionId: string;
  title: string;
  program: string;
  presenters: string;
  assignedJudges: number;
  /** One per judge who has scored. */
  scores: RubricScores[];
}

export interface ResultRow {
  submissionId: string;
  title: string;
  program: string;
  presenters: string;
  assignedJudges: number;
  scoredJudges: number;
  status: "complete" | "awaiting_scores" | "unassigned";
  /** Sum of judges' weighted totals, and how many judges: the exact mean is sum / judges. */
  sum: number;
  /** The mean weighted total, for display only. Null when nothing is scored. */
  mean: number | null;
  criterionMeans: Record<string, number | null>;
  /** Competition rank among complete submissions; null otherwise. */
  rank: number | null;
  tied: boolean;
}

export function aggregate(submissions: readonly SubmissionScores[]): ResultRow[] {
  const rows: ResultRow[] = submissions.map((s) => {
    const totals = s.scores.map(weightedTotal).filter((t): t is number => t !== null);
    const sum = totals.reduce((n, t) => n + t, 0);
    const criterionMeans = Object.fromEntries(
      RUBRIC.map((c) => {
        const values = s.scores.map((sc) => sc[c.id]).filter((v): v is number => typeof v === "number");
        return [c.id, values.length ? values.reduce((n, v) => n + v, 0) / values.length : null];
      }),
    );
    const status: ResultRow["status"] = s.assignedJudges === 0 ? "unassigned" : totals.length >= s.assignedJudges ? "complete" : "awaiting_scores";
    return {
      submissionId: s.submissionId,
      title: s.title,
      program: s.program,
      presenters: s.presenters,
      assignedJudges: s.assignedJudges,
      scoredJudges: totals.length,
      status,
      sum,
      mean: totals.length ? sum / totals.length : null,
      criterionMeans,
      rank: null,
      tied: false,
    };
  });

  // a.sum / a.n compared with b.sum / b.n, without division.
  const compare = (a: ResultRow, b: ResultRow) => b.sum * a.scoredJudges - a.sum * b.scoredJudges;
  const complete = rows.filter((r) => r.status === "complete").sort((a, b) => compare(a, b) || a.title.localeCompare(b.title));
  complete.forEach((row, i) => {
    const previous = complete[i - 1];
    row.rank = previous && compare(previous, row) === 0 ? previous.rank : i + 1;
  });
  for (const row of complete) row.tied = complete.some((other) => other !== row && other.rank === row.rank);

  const others = rows.filter((r) => r.status !== "complete").sort((a, b) => a.title.localeCompare(b.title));
  return [...complete, ...others];
}

export function rankLabel(row: ResultRow): string {
  if (row.rank === null) return row.status === "unassigned" ? "No judges assigned" : `Awaiting scores (${row.scoredJudges} of ${row.assignedJudges})`;
  return row.tied ? `=${row.rank}` : String(row.rank);
}

const two = (n: number | null) => (n === null ? "" : n.toFixed(2));

/**
 * The results export (§6.6). The rank is a plain number and a shared rank is
 * flagged in the `tied` column: the "=1" the page shows would be read by a
 * spreadsheet as the formula =1.
 */
export function resultsCsv(rows: readonly ResultRow[]): string {
  return toCsv([
    ["rank", "tied", "title", "program", "presenters", "status", "judges_scored", "judges_assigned", `mean_total_of_${MAX_TOTAL}`, ...RUBRIC.map((c) => `mean_${c.id}`)],
    ...rows.map((r) => [
      r.rank === null ? "" : String(r.rank),
      r.tied ? "yes" : "no",
      r.title,
      r.program,
      r.presenters,
      r.status,
      String(r.scoredJudges),
      String(r.assignedJudges),
      two(r.mean),
      ...RUBRIC.map((c) => two(r.criterionMeans[c.id] ?? null)),
    ]),
  ]);
}
