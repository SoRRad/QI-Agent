import {
  MOVING_RANGE_D4_N2,
  SIGMA_MULTIPLIER,
  XMR_INDIVIDUALS_MULTIPLIER,
} from "./constants";
import { mean } from "./median";
import type {
  ChartKind,
  ChartLimits,
  ControlChartOptions,
  Observation,
  SpcAnalysis,
  Violation,
} from "./types";
import { westernElectricViolations } from "./westernElectric";

/**
 * Control charts: XmR (individuals and moving range), p, u and c.
 *
 * p and u charts with VARIABLE subgroup sizes produce stepped limits, because
 * sigma depends on the subgroup size of each point. Flat limits on a variable
 * denominator are simply wrong: a month with 95 discharges has wider natural
 * variation than a month with 127, and drawing one limit across both either
 * over- or under-signals depending on the month.
 *
 * For p and u charts the plotted value is DERIVED here from numerator and
 * denominator rather than taken from the caller, so the chart and the stored
 * value cannot disagree.
 */
export function analyseControlChart(
  kind: Exclude<ChartKind, "run">,
  observations: Observation[],
  options: ControlChartOptions = {},
): SpcAnalysis {
  const multiplier = options.multiplier ?? 1;
  const notes: string[] = [];

  if (observations.length === 0) {
    return {
      kind,
      observations,
      limits: { centreLine: Number.NaN, upper: null, lower: null, sigma: null },
      violations: [],
      usefulObservations: 0,
      notes: ["No data points."],
    };
  }

  const { values, limits, resolved } = computeLimits(kind, observations, multiplier, options);

  if (observations.length < 12) {
    notes.push(
      `Only ${observations.length} points. Control limits computed from fewer than about 12 subgroups are unstable and should be treated as provisional.`,
    );
  }

  const violations: Violation[] = [...pointsBeyondLimits(values, limits)];

  if (options.westernElectric && limits.sigma) {
    violations.push(...westernElectricViolations(values, limits.centreLine, limits.sigma));
  }

  return {
    kind,
    observations: resolved,
    limits,
    violations,
    usefulObservations: values.filter((v) => v !== limits.centreLine).length,
    notes,
  };
}

interface ComputedLimits {
  values: number[];
  limits: ChartLimits;
  resolved: Observation[];
}

function computeLimits(
  kind: Exclude<ChartKind, "run">,
  observations: Observation[],
  multiplier: number,
  options: ControlChartOptions,
): ComputedLimits {
  switch (kind) {
    case "xmr":
      return xmr(observations, options);
    case "p":
      return proportionChart(observations, multiplier, options);
    case "u":
      return rateChart(observations, multiplier, options);
    case "c":
      return countChart(observations, options);
  }
}

/**
 * XmR — individuals and moving range.
 *
 *   mR_i  = |x_i - x_(i-1)|
 *   mRbar = mean of the moving ranges
 *   CL    = mean of the individuals
 *   UNPL  = CL + 2.660 * mRbar
 *   LNPL  = CL - 2.660 * mRbar
 *
 * 2.660 is 3 / d2 for n = 2 (d2 = 1.128). Source: Wheeler, *Understanding
 * Variation*; Montgomery, *Introduction to Statistical Quality Control*.
 *
 * Sigma is reported as one third of the limit distance, so the Western
 * Electric zones agree exactly with the limits rather than differing in the
 * fourth significant figure because of the published rounding of 2.660.
 */
function xmr(observations: Observation[], options: ControlChartOptions): ComputedLimits {
  const values = observations.map((o) => o.value);
  const centreLine = options.centreLine ?? mean(values);

  const movingRanges: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const current = values[i] as number;
    const previous = values[i - 1] as number;
    movingRanges.push(Math.abs(current - previous));
  }

  const mrBar = movingRanges.length > 0 ? mean(movingRanges) : 0;
  const halfWidth = XMR_INDIVIDUALS_MULTIPLIER * mrBar;
  const sigma = halfWidth / SIGMA_MULTIPLIER;

  return {
    values,
    resolved: observations,
    limits: {
      centreLine,
      upper: values.map(() => centreLine + halfWidth),
      lower: values.map(() => centreLine - halfWidth),
      sigma: values.map(() => sigma),
    },
  };
}

/** The moving range chart that accompanies an XmR individuals chart. */
export interface MovingRangeChart {
  /** One fewer than the individuals series; the first point has no range. */
  ranges: number[];
  centreLine: number;
  upper: number;
  /** Zero by convention: a range cannot be negative. */
  lower: number;
}

export function movingRangeChart(observations: Observation[]): MovingRangeChart {
  const values = observations.map((o) => o.value);
  const ranges: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    ranges.push(Math.abs((values[i] as number) - (values[i - 1] as number)));
  }
  const centreLine = ranges.length > 0 ? mean(ranges) : 0;
  return {
    ranges,
    centreLine,
    upper: MOVING_RANGE_D4_N2 * centreLine,
    lower: 0,
  };
}

/**
 * p chart — a proportion with a variable denominator.
 *
 *   pbar    = sum(numerators) / sum(denominators)
 *   sigma_i = sqrt( pbar * (1 - pbar) / n_i )
 *   limits  = pbar +/- 3 * sigma_i, clamped to [0, 1]
 *
 * pbar is the POOLED proportion, not the mean of the individual proportions.
 * Averaging the proportions would weight a month of 95 discharges equally
 * with a month of 127.
 */
function proportionChart(
  observations: Observation[],
  multiplier: number,
  options: ControlChartOptions,
): ComputedLimits {
  requireNumeratorAndDenominator(observations, "p");

  const totalNumerator = observations.reduce((s, o) => s + (o.numerator as number), 0);
  const totalDenominator = observations.reduce((s, o) => s + (o.denominator as number), 0);
  const pBar = totalDenominator === 0 ? 0 : totalNumerator / totalDenominator;

  const resolved = observations.map((o) => ({
    ...o,
    value: ((o.numerator as number) / (o.denominator as number)) * multiplier,
  }));
  const values = resolved.map((o) => o.value);

  // A frozen baseline centre line must drive the LIMITS as well, not just the
  // line. Computing sigma from the whole series while drawing the centre line
  // from a baseline produces a chart whose line and limits describe different
  // periods, which is worse than not offering the option at all.
  const base = options.centreLine ?? pBar;

  const sigma = observations.map((o) => {
    const n = o.denominator as number;
    return n === 0 ? 0 : Math.sqrt((base * (1 - base)) / n);
  });

  const centreLine = base * multiplier;

  return {
    values,
    resolved,
    limits: {
      centreLine,
      // Clamped to the interval a proportion can occupy: a limit above 1 or
      // below 0 is not a limit, it is an artefact of the normal
      // approximation being used near the boundary.
      upper: sigma.map((s) => Math.min(1, base + SIGMA_MULTIPLIER * s) * multiplier),
      lower: sigma.map((s) => Math.max(0, base - SIGMA_MULTIPLIER * s) * multiplier),
      sigma: sigma.map((s) => s * multiplier),
    },
  };
}

/**
 * u chart — a count per unit of exposure, with variable exposure.
 *
 *   ubar    = sum(counts) / sum(exposure)
 *   sigma_i = sqrt( ubar / n_i )
 *   limits  = ubar +/- 3 * sigma_i, lower clamped to 0
 */
function rateChart(
  observations: Observation[],
  multiplier: number,
  options: ControlChartOptions,
): ComputedLimits {
  requireNumeratorAndDenominator(observations, "u");

  const totalCount = observations.reduce((s, o) => s + (o.numerator as number), 0);
  const totalExposure = observations.reduce((s, o) => s + (o.denominator as number), 0);
  const uBar = totalExposure === 0 ? 0 : totalCount / totalExposure;

  const resolved = observations.map((o) => ({
    ...o,
    value: ((o.numerator as number) / (o.denominator as number)) * multiplier,
  }));
  const values = resolved.map((o) => o.value);

  // As with the p chart, a frozen centre line drives the limits too.
  const base = options.centreLine ?? uBar;

  const sigma = observations.map((o) => {
    const n = o.denominator as number;
    return n === 0 ? 0 : Math.sqrt(base / n);
  });

  const centreLine = base * multiplier;

  return {
    values,
    resolved,
    limits: {
      centreLine,
      upper: sigma.map((s) => (base + SIGMA_MULTIPLIER * s) * multiplier),
      lower: sigma.map((s) => Math.max(0, base - SIGMA_MULTIPLIER * s) * multiplier),
      sigma: sigma.map((s) => s * multiplier),
    },
  };
}

/**
 * c chart — counts over a constant area of opportunity.
 *
 *   cbar   = mean of the counts
 *   sigma  = sqrt(cbar)
 *   limits = cbar +/- 3 * sqrt(cbar), lower clamped to 0
 *
 * Use a u chart instead where the exposure varies; a c chart on varying
 * exposure attributes changes in denominator to changes in process.
 */
function countChart(observations: Observation[], options: ControlChartOptions): ComputedLimits {
  const counts = observations.map((o) => o.numerator ?? o.value);
  const cBar = options.centreLine ?? mean(counts);
  const sigma = Math.sqrt(Math.max(0, cBar));

  const resolved = observations.map((o, i) => ({ ...o, value: counts[i] as number }));

  return {
    values: counts,
    resolved,
    limits: {
      centreLine: cBar,
      upper: counts.map(() => cBar + SIGMA_MULTIPLIER * sigma),
      lower: counts.map(() => Math.max(0, cBar - SIGMA_MULTIPLIER * sigma)),
      sigma: counts.map(() => sigma),
    },
  };
}

function requireNumeratorAndDenominator(observations: Observation[], kind: string): void {
  for (const [index, o] of observations.entries()) {
    if (typeof o.numerator !== "number" || typeof o.denominator !== "number") {
      throw new Error(
        `A ${kind} chart needs a numerator and a denominator for every point; point ${index} ("${o.label}") is missing one. ` +
          `Use an XmR chart for a measurement that is not a count over a denominator.`,
      );
    }
  }
}

/** The basic control chart signal: a point outside the limits. */
function pointsBeyondLimits(values: readonly number[], limits: ChartLimits): Violation[] {
  if (!limits.upper || !limits.lower) return [];

  const violations: Violation[] = [];
  for (const [index, value] of values.entries()) {
    const upper = limits.upper[index];
    const lower = limits.lower[index];
    if (upper === undefined || lower === undefined) continue;

    if (value > upper) {
      violations.push({
        rule: "point_beyond_limits",
        pointIndices: [index],
        description: `Point beyond the upper limit: ${format(value)} against an upper limit of ${format(upper)}. A single point outside the limits is special cause.`,
      });
    } else if (value < lower) {
      violations.push({
        rule: "point_beyond_limits",
        pointIndices: [index],
        description: `Point beyond the lower limit: ${format(value)} against a lower limit of ${format(lower)}. A single point outside the limits is special cause.`,
      });
    }
  }
  return violations;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
