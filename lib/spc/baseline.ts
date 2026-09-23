import { analyseControlChart } from "./controlChart";
import { mean, median } from "./median";
import { analyseRunChart } from "./runChart";
import type {
  ChartKind,
  ControlChartOptions,
  Observation,
  RunChartOptions,
  SpcAnalysis,
} from "./types";

/**
 * Freezing a baseline.
 *
 * A team that changes something at month 13 wants to know whether months 13
 * onward differ from months 1–12. Computing the centre line from all 24 months
 * answers a different question — it averages the old process with the new —
 * so the standard practice (Provost & Murray, *The Health Care Data Guide*)
 * is to compute the centre line and limits from the baseline
 * period only, and extend them across the later points.
 *
 * The frozen parameters are computed HERE, from the baseline points, in the
 * chart's natural units. Nothing about a baseline is ever supplied by a
 * caller as a number.
 */

/** Minimum baseline length accepted at all. Below 12 the result is flagged. */
export const MINIMUM_BASELINE_POINTS = 2;
/** Baselines shorter than this carry a note that the centre line is provisional. */
export const RECOMMENDED_BASELINE_POINTS = 12;

/**
 * The centre line (and, for XmR, the average moving range) of the first
 * `length` observations, in the units `analyse` expects for `centreLine`:
 *
 *   run  median of the baseline values
 *   xmr  mean of the baseline values, and the mean of the moving ranges
 *        WITHIN the baseline (the range spanning the boundary is excluded)
 *   p    pooled proportion: sum(numerators) / sum(denominators)
 *   u    pooled rate: sum(counts) / sum(exposure)
 *   c    mean of the baseline counts
 *
 * p and u are pooled for the same reason the full-series centre line is:
 * averaging the monthly proportions would weight a small month equally with a
 * large one.
 */
export function frozenParameters(
  kind: ChartKind,
  observations: readonly Observation[],
  length: number,
): { centreLine: number; movingRangeBar?: number } {
  if (!Number.isInteger(length) || length < MINIMUM_BASELINE_POINTS || length > observations.length) {
    throw new RangeError(
      `A baseline needs between ${MINIMUM_BASELINE_POINTS} and ${observations.length} points; got ${length}.`,
    );
  }
  const base = observations.slice(0, length);

  switch (kind) {
    case "run":
      return { centreLine: median(base.map((o) => o.value)) };
    case "xmr": {
      const values = base.map((o) => o.value);
      const ranges = values.slice(1).map((v, i) => Math.abs(v - (values[i] as number)));
      return { centreLine: mean(values), movingRangeBar: mean(ranges) };
    }
    case "p":
    case "u": {
      const numerator = base.reduce((s, o) => s + (o.numerator ?? Number.NaN), 0);
      const denominator = base.reduce((s, o) => s + (o.denominator ?? Number.NaN), 0);
      if (!Number.isFinite(numerator) || !(denominator > 0)) {
        throw new Error(`A ${kind} chart baseline needs a numerator and a positive denominator for every point.`);
      }
      return { centreLine: numerator / denominator };
    }
    case "c":
      return { centreLine: mean(base.map((o) => o.numerator ?? o.value)) };
  }
}

/**
 * Analyse a series against a centre line (and limits) frozen from its first
 * `baselineLength` points.
 *
 * On a RUN chart, the two runs rules are dropped: the runs table gives the
 * expected number of runs about the median OF THE POINTS BEING COUNTED, and a
 * baseline median extended over later points is not that. The shift and trend
 * rules are what detect change against an extended baseline.
 */
export function analyseAgainstBaseline(
  kind: ChartKind,
  observations: Observation[],
  baselineLength: number,
  options: RunChartOptions & ControlChartOptions = {},
): SpcAnalysis {
  const frozen = frozenParameters(kind, observations, baselineLength);
  const analysis =
    kind === "run"
      ? analyseRunChart(observations, { ...options, ...frozen })
      : analyseControlChart(kind, observations, { ...options, ...frozen });

  const notes = [...analysis.notes];
  let violations = analysis.violations;
  if (kind === "run") {
    violations = violations.filter((v) => v.rule !== "too_few_runs" && v.rule !== "too_many_runs");
    notes.push(
      "The runs rules are not applied against a frozen baseline median: the runs table assumes the median of the points being counted. Shifts and trends are what detect change against a baseline.",
    );
  }
  if (baselineLength < RECOMMENDED_BASELINE_POINTS) {
    notes.push(
      `The baseline has only ${baselineLength} points. A centre line frozen from fewer than about ${RECOMMENDED_BASELINE_POINTS} is provisional; re-freeze it once more baseline data is available.`,
    );
  }

  return {
    ...analysis,
    violations,
    notes,
    baseline: {
      length: baselineLength,
      firstLabel: observations[0]?.label ?? "",
      lastLabel: observations[baselineLength - 1]?.label ?? "",
    },
  };
}
