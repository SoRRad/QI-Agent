import {
  MINIMUM_RUN_CHART_POINTS,
  SHIFT_LENGTH,
  TREND_LENGTH,
} from "./constants";
import { median, medianAbsoluteDeviation } from "./median";
import { runsCriticalValues } from "./runs";
import type { Observation, RunChartOptions, SpcAnalysis, Violation } from "./types";

/**
 * Run chart analysis: median centre line and the four rules from Perla,
 * Provost & Murray (2011).
 *
 * Two handling rules are easy to get wrong and are therefore stated here as
 * well as tested:
 *
 *   1. A point lying exactly ON the median is not counted at all. It is
 *      skipped when counting shifts and runs, and it does NOT break a shift.
 *      It is also excluded from the "useful observations" count that indexes
 *      the runs table.
 *   2. Where two consecutive points are EQUAL, one is ignored when counting a
 *      trend, because a repeated value is neither an increase nor a decrease.
 */
export function analyseRunChart(
  observations: Observation[],
  options: RunChartOptions = {},
): SpcAnalysis {
  const minimumPoints = options.minimumPoints ?? MINIMUM_RUN_CHART_POINTS;
  const values = observations.map((o) => o.value);
  const notes: string[] = [];

  if (values.length === 0) {
    return {
      kind: "run",
      observations,
      limits: { centreLine: Number.NaN, upper: null, lower: null, sigma: null },
      violations: [],
      usefulObservations: 0,
      notes: ["No data points."],
    };
  }

  const centreLine = options.centreLine ?? median(values);

  // Indices of points not lying on the centre line, in time order.
  const offCentre = values
    .map((value, index) => ({ value, index }))
    .filter((p) => p.value !== centreLine);
  const usefulObservations = offCentre.length;

  if (values.length < minimumPoints) {
    notes.push(
      `Only ${values.length} points. The run chart rules need at least ${minimumPoints} to be reliable, so they have not been applied.`,
    );
    return {
      kind: "run",
      observations,
      limits: { centreLine, upper: null, lower: null, sigma: null },
      violations: [],
      usefulObservations,
      notes,
    };
  }

  const violations: Violation[] = [
    ...detectShifts(offCentre, centreLine),
    ...detectTrends(values),
    ...detectRunCount(offCentre, centreLine, usefulObservations, notes),
  ];

  if (options.detectAstronomicalPoints) {
    violations.push(...surfaceAstronomicalCandidates(values, centreLine));
  }

  return {
    kind: "run",
    observations,
    limits: { centreLine, upper: null, lower: null, sigma: null },
    violations,
    usefulObservations,
    notes,
  };
}

interface OffCentrePoint {
  value: number;
  index: number;
}

/**
 * Rule 1 — a shift: six or more consecutive points on one side of the median.
 * Points on the median are already absent from `offCentre`, which is what
 * makes them neither counted nor shift-breaking.
 */
function detectShifts(offCentre: OffCentrePoint[], centreLine: number): Violation[] {
  const violations: Violation[] = [];
  let currentSide = 0;
  let group: OffCentrePoint[] = [];

  const flush = (): void => {
    if (group.length >= SHIFT_LENGTH) {
      const side = currentSide > 0 ? "above" : "below";
      const first = group[0] as OffCentrePoint;
      const last = group[group.length - 1] as OffCentrePoint;
      const skipped = last.index - first.index + 1 - group.length;
      violations.push({
        rule: "shift",
        pointIndices: group.map((p) => p.index),
        description:
          `Shift: ${group.length} consecutive points ${side} the median of ${format(centreLine)}` +
          (skipped > 0
            ? `, ignoring ${skipped} point${skipped === 1 ? "" : "s"} lying on the median.`
            : ".") +
          ` Six or more in a row on one side is more than chance alone would produce.`,
      });
    }
    group = [];
  };

  for (const point of offCentre) {
    const side = point.value > centreLine ? 1 : -1;
    if (side !== currentSide) {
      flush();
      currentSide = side;
    }
    group.push(point);
  }
  flush();

  return violations;
}

/**
 * Rule 2 — a trend: five or more consecutive points all increasing or all
 * decreasing. Consecutive equal values are collapsed first, so a repeated
 * value neither extends nor breaks a trend.
 *
 * Note that a trend is counted against the direction of successive points,
 * not against the median, so points on the median participate normally.
 */
function detectTrends(values: readonly number[]): Violation[] {
  // Collapse runs of equal consecutive values, keeping the first index.
  const collapsed: OffCentrePoint[] = [];
  for (const [index, value] of values.entries()) {
    const previous = collapsed[collapsed.length - 1];
    if (previous === undefined || previous.value !== value) {
      collapsed.push({ value, index });
    }
  }

  const violations: Violation[] = [];
  let direction = 0;
  let group: OffCentrePoint[] = collapsed.length > 0 ? [collapsed[0] as OffCentrePoint] : [];

  const flush = (): void => {
    if (group.length >= TREND_LENGTH) {
      const word = direction > 0 ? "increasing" : "decreasing";
      const first = group[0] as OffCentrePoint;
      const last = group[group.length - 1] as OffCentrePoint;
      violations.push({
        rule: "trend",
        pointIndices: group.map((p) => p.index),
        description:
          `Trend: ${group.length} consecutive points ${word}, from ${format(first.value)} to ${format(last.value)}. ` +
          `Five or more moving in one direction is more than chance alone would produce.`,
      });
    }
  };

  for (let i = 1; i < collapsed.length; i += 1) {
    const current = collapsed[i] as OffCentrePoint;
    const previous = collapsed[i - 1] as OffCentrePoint;
    const step = current.value > previous.value ? 1 : -1;

    if (step === direction) {
      group.push(current);
    } else {
      flush();
      direction = step;
      group = [previous, current];
    }
  }
  flush();

  return violations;
}

/**
 * Rule 3 — too few or too many runs. A run is a consecutive series of points
 * on the same side of the median; points on the median are excluded from both
 * the run count and the observation count that indexes the table.
 */
function detectRunCount(
  offCentre: OffCentrePoint[],
  centreLine: number,
  usefulObservations: number,
  notes: string[],
): Violation[] {
  if (offCentre.length === 0) {
    notes.push("Every point lies on the median, so the runs test does not apply.");
    return [];
  }

  let runs = 1;
  let side = (offCentre[0] as OffCentrePoint).value > centreLine ? 1 : -1;
  for (const point of offCentre.slice(1)) {
    const next = point.value > centreLine ? 1 : -1;
    if (next !== side) {
      runs += 1;
      side = next;
    }
  }

  const critical = runsCriticalValues(usefulObservations);
  if (!critical) {
    notes.push(
      `Only ${usefulObservations} useful observations (points not on the median). The runs test needs at least 10, so it has not been applied.`,
    );
    return [];
  }

  const allIndices = offCentre.map((p) => p.index);

  if (runs < critical.lower) {
    return [
      {
        rule: "too_few_runs",
        pointIndices: allIndices,
        description:
          `Too few runs: ${runs} run${runs === 1 ? "" : "s"} across ${usefulObservations} useful observations, where ${critical.lower} is the fewest expected from chance alone. ` +
          `The data is clustered on one side of the median and then the other, which means something other than chance is at work.`,
      },
    ];
  }

  if (runs > critical.upper) {
    return [
      {
        rule: "too_many_runs",
        pointIndices: allIndices,
        description:
          `Too many runs: ${runs} runs across ${usefulObservations} useful observations, where ${critical.upper} is the most expected from chance alone. ` +
          `The data oscillates across the median more than chance would produce, which often means two different processes are being plotted as one.`,
      },
    ];
  }

  return [];
}

/**
 * Rule 4 — astronomical point.
 *
 * This rule is deliberately a JUDGEMENT and not a calculation: every chart has
 * a largest point, and the rule is not "the largest point". The engine
 * therefore does not decide. It surfaces candidates using a transparent,
 * robust heuristic — distance from the median exceeding five times the median
 * absolute deviation — and marks them `requiresJudgement` so the interface
 * asks a human whether the point is genuinely astronomical and what its story
 * is.
 *
 * There is no published critical value for this rule, and the threshold below
 * is a surfacing heuristic rather than a test. That is recorded in
 * docs/VALIDATION.md so nobody mistakes it for one.
 */
const ASTRONOMICAL_MAD_MULTIPLE = 5;

function surfaceAstronomicalCandidates(
  values: readonly number[],
  centreLine: number,
): Violation[] {
  const mad = medianAbsoluteDeviation(values);
  if (mad === 0) return [];

  const threshold = ASTRONOMICAL_MAD_MULTIPLE * mad;
  const candidates = values
    .map((value, index) => ({ value, index, distance: Math.abs(value - centreLine) }))
    .filter((p) => p.distance > threshold);

  if (candidates.length === 0) return [];

  // Only the most extreme candidate is surfaced: the rule asks whether THE
  // point stands out, and offering a list defeats the judgement it calls for.
  const worst = candidates.reduce((a, b) => (b.distance > a.distance ? b : a));

  return [
    {
      rule: "astronomical_point",
      pointIndices: [worst.index],
      requiresJudgement: true,
      description:
        `Possible astronomical point: ${format(worst.value)} sits far from the median of ${format(centreLine)} relative to the spread of the rest of the series. ` +
        `This rule is a judgement, not a test — look at what happened in that period and record what you find. If the point looks ordinary to you, it is ordinary.`,
    },
  ];
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
