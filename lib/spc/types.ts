/**
 * Types for the statistical process control engine.
 *
 * Nothing in lib/spc imports a language model, and nothing in it is allowed
 * to. Every number a chart displays originates here. A model may be handed an
 * `SpcAnalysis` to interpret; it never produces one.
 */

export type ChartKind = "run" | "xmr" | "p" | "u" | "c";

/** A single plotted observation. */
export interface Observation {
  /** Display label for the period, e.g. "Mar 2026". */
  label: string;
  /**
   * The plotted value. For p and u charts this is derived from numerator and
   * denominator rather than supplied, so that the chart and the stored value
   * cannot disagree.
   */
  value: number;
  numerator?: number | undefined;
  denominator?: number | undefined;
}

export type RunChartRuleName =
  | "shift"
  | "trend"
  | "too_few_runs"
  | "too_many_runs"
  | "astronomical_point";

export type ControlChartRuleName =
  | "point_beyond_limits"
  | "we_two_of_three_beyond_2_sigma"
  | "we_four_of_five_beyond_1_sigma"
  | "we_eight_on_one_side";

export type RuleName = RunChartRuleName | ControlChartRuleName;

/**
 * A rule violation. The plain-language description is generated here, in
 * TypeScript, so that the narration of a chart carries the same numbers as
 * the chart itself.
 */
export interface Violation {
  rule: RuleName;
  /** Zero-based indices into the observation series. */
  pointIndices: number[];
  /** Plain language, suitable for display without further processing. */
  description: string;
  /**
   * True where the rule is a prompt for human judgement rather than a
   * statistical test. Only the astronomical point rule sets this.
   */
  requiresJudgement?: boolean;
}

/** A centre line and, where the chart has them, limits per point. */
export interface ChartLimits {
  /** Median for a run chart; mean or weighted mean for a control chart. */
  centreLine: number;
  /**
   * Upper limit per point. Constant-length charts repeat the same value;
   * p and u charts with variable subgroup sizes produce stepped limits.
   * Null where the chart has no limits (a run chart).
   */
  upper: number[] | null;
  lower: number[] | null;
  /** Per-point sigma, where defined. Used by the Western Electric zones. */
  sigma: number[] | null;
}

export interface SpcAnalysis {
  kind: ChartKind;
  observations: Observation[];
  limits: ChartLimits;
  violations: Violation[];
  /**
   * Points not lying exactly on the centre line. Run chart rules are counted
   * against these, and the runs test is indexed by this count.
   */
  usefulObservations: number;
  /**
   * Set where the series is too short for the rules to be applied. The chart
   * still plots; the rules are simply not evaluated.
   */
  notes: string[];
}

export interface RunChartOptions {
  /**
   * A frozen centre line, for testing later points against a baseline period
   * rather than against the whole series.
   */
  centreLine?: number;
  /**
   * Minimum points before the four rules are evaluated. The library document
   * and the committee's teaching both use 12.
   */
  minimumPoints?: number;
  /** Surface astronomical point candidates for human judgement. */
  detectAstronomicalPoints?: boolean;
}

export interface ControlChartOptions {
  /**
   * Western Electric supplementary rules. Default OFF: applying all of them
   * alongside the run chart rules inflates false signals on the short series
   * that trainee projects actually produce.
   *
   * The basic rule — a point beyond the limits — is always evaluated, because
   * it is the control chart's defining signal rather than a supplementary
   * test.
   */
  westernElectric?: boolean;
  /** Multiply proportions or rates for display, e.g. 100 for percent. */
  multiplier?: number;
  /**
   * A frozen centre line from a baseline period. Given in the measure's
   * NATURAL units — a proportion for a p chart, a rate for a u chart, a count
   * for a c chart — before any display multiplier is applied.
   *
   * Freezing the centre line freezes the limits with it: both are computed
   * from the baseline rather than from the whole series.
   */
  centreLine?: number;
}
