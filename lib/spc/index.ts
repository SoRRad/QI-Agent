/**
 * Deterministic statistical process control.
 *
 * THE RULE FOR THIS DIRECTORY: nothing here imports a language model, and
 * nothing here may. Every median, control limit, run count and percentage a
 * chart displays originates in these functions, all of which are pure and
 * unit tested against the cases listed in docs/VALIDATION.md.
 *
 * A model may be handed an `SpcAnalysis` to interpret in prose. It is never
 * given a raw series, and a guard rejects any model output containing a
 * numeric token absent from the analysis it was given.
 */

export type {
  BaselineInfo,
  ChartKind,
  ChartLimits,
  ControlChartOptions,
  ControlChartRuleName,
  Observation,
  RuleName,
  RunChartOptions,
  RunChartRuleName,
  SpcAnalysis,
  Violation,
} from "./types";

export {
  D2_N2,
  MINIMUM_RUN_CHART_POINTS,
  MOVING_RANGE_D4_N2,
  SHIFT_LENGTH,
  SIGMA_MULTIPLIER,
  TREND_LENGTH,
  XMR_INDIVIDUALS_MULTIPLIER,
} from "./constants";

export { mean, median, medianAbsoluteDeviation } from "./median";
export { RUNS_TAIL_ALPHA, runDistribution, runsCriticalValues } from "./runs";
export type { RunsCriticalValues } from "./runs";
export { analyseRunChart } from "./runChart";
export { analyseControlChart, movingRangeChart } from "./controlChart";
export type { MovingRangeChart } from "./controlChart";
export { westernElectricViolations } from "./westernElectric";
export {
  analyseAgainstBaseline,
  frozenParameters,
  MINIMUM_BASELINE_POINTS,
  RECOMMENDED_BASELINE_POINTS,
} from "./baseline";

import { analyseControlChart } from "./controlChart";
import { analyseRunChart } from "./runChart";
import type {
  ChartKind,
  ControlChartOptions,
  Observation,
  RunChartOptions,
  SpcAnalysis,
} from "./types";

/**
 * Analyse a series as the given chart type. The single entry point the
 * application uses, so that no caller has to remember which analyser matches
 * which chart kind.
 */
export function analyse(
  kind: ChartKind,
  observations: Observation[],
  options: RunChartOptions & ControlChartOptions = {},
): SpcAnalysis {
  return kind === "run"
    ? analyseRunChart(observations, options)
    : analyseControlChart(kind, observations, options);
}
