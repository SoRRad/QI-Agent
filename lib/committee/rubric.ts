/**
 * The judging rubric (§6.6). One definition, used by the event kit that
 * prints it, the form judges score on, and the aggregation that ranks the
 * results — so the rubric a judge reads is the rubric that is counted.
 *
 * Each criterion is scored 1–5. Weights are whole numbers so that a judge's
 * weighted total is an integer and ties can be compared exactly.
 */

export interface Criterion {
  id: string;
  label: string;
  weight: number;
  /** What a 5 looks like, for the judge. */
  anchor: string;
}

export const RUBRIC: readonly Criterion[] = [
  {
    id: "problem_aim",
    label: "Problem and aim",
    weight: 2,
    anchor: "A local problem sized with data, and an aim with all five elements.",
  },
  {
    id: "measures",
    label: "Measures",
    weight: 2,
    anchor: "Outcome, process and balancing measures, each with an operational definition.",
  },
  {
    id: "method",
    label: "Method",
    weight: 2,
    anchor: "A driver diagram, and PDSA cycles that each tested a prediction.",
  },
  {
    id: "results",
    label: "Results",
    weight: 3,
    anchor: "Annotated run or control charts, read with the rules, not by eye.",
  },
  {
    id: "sustainability",
    label: "Sustainability and lessons",
    weight: 2,
    anchor: "A named owner for the change, and an honest account of what did not work.",
  },
  {
    id: "presentation",
    label: "Presentation",
    weight: 1,
    anchor: "Clear to a reader outside the specialty, within the time or word limit.",
  },
];

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;
export const MAX_TOTAL = RUBRIC.reduce((n, c) => n + c.weight * SCORE_MAX, 0);

export type RubricScores = Record<string, number>;

/** The weighted total of one judge's scores, or null if any criterion is missing or out of range. */
export function weightedTotal(scores: RubricScores): number | null {
  let total = 0;
  for (const c of RUBRIC) {
    const s = scores[c.id];
    if (typeof s !== "number" || !Number.isInteger(s) || s < SCORE_MIN || s > SCORE_MAX) return null;
    total += s * c.weight;
  }
  return total;
}
