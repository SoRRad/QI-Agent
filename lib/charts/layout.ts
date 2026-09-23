import type { RuleName, SpcAnalysis } from "@/lib/spc";

/**
 * Chart geometry, as a pure function of an analysis and a width.
 *
 * No React and no DOM here, so the same geometry drives the interactive chart
 * in the browser and — in phase 9 — the PNG rasterised into PDF exports. One
 * rendering path, two outputs (ADR-0006): the chart in a report is the chart
 * on screen.
 *
 * Every number drawn comes from `analysis`, which came from lib/spc. This file
 * decides only where things go.
 */

export interface ChartAnnotation {
  label: string;
  /** 1-based period index, as stored on Annotation. */
  periodIndex: number | null;
  description?: string | null;
}

export interface LayoutInput {
  analysis: SpcAnalysis;
  /** Display unit suffix: "%" for a p chart in percent, "" otherwise. */
  unit: string;
  annotations: ChartAnnotation[];
  width: number;
  height?: number;
}

/**
 * normal    common-cause point
 * pattern   part of a shift, trend or Western Electric pattern (special cause
 *           shown by the pattern, not by the point alone)
 * special   beyond a control limit
 * judgement an astronomical point CANDIDATE — a prompt to look, not a finding
 */
export type PointKind = "normal" | "pattern" | "special" | "judgement";

export interface PlottedPoint {
  index: number;
  x: number;
  y: number;
  value: number;
  label: string;
  kind: PointKind;
}

export interface RuleBracket {
  rule: RuleName;
  label: string;
  x1: number;
  x2: number;
  lane: number;
  y: number;
  pointIndices: number[];
}

export interface ChartLayout {
  width: number;
  height: number;
  compact: boolean;
  plot: { left: number; top: number; right: number; bottom: number };
  step: number;
  points: PlottedPoint[];
  line: string;
  yTicks: Array<{ value: number; y: number; label: string }>;
  xLabels: Array<{ index: number; x: number; label: string; anchor: "start" | "middle" | "end" }>;
  centre: {
    y: number;
    value: number;
    label: string;
    name: string;
    /** x where a frozen baseline ends and the extension begins; null when not frozen. */
    frozenUntilX: number | null;
  };
  upper: { path: string; stepped: boolean; label: string } | null;
  lower: { path: string; stepped: boolean; label: string } | null;
  brackets: RuleBracket[];
  annotations: Array<{ number: number; x: number; label: string; period: string | null; description: string | null }>;
  xAxisY: number;
}

/** Rules drawn as a bracket over the periods they span. */
const PATTERN_RULES: Partial<Record<RuleName, string>> = {
  shift: "Shift",
  trend: "Trend",
  we_eight_on_one_side: "8 on one side",
  we_two_of_three_beyond_2_sigma: "2 of 3 beyond 2σ",
  we_four_of_five_beyond_1_sigma: "4 of 5 beyond 1σ",
};

const LANE_HEIGHT = 16;
const MAX_LANES = 3;

export function layoutChart(input: LayoutInput): ChartLayout {
  const { analysis, unit, width } = input;
  const compact = width < 560;
  const n = analysis.observations.length;

  // ---- which points carry a point-level signal
  // Precedence: beyond a limit > part of a pattern > judgement candidate.
  const kind = new Map<number, PointKind>();
  const rank: Record<PointKind, number> = { normal: 0, judgement: 1, pattern: 2, special: 3 };
  const mark = (i: number, k: PointKind) => {
    if (rank[k] > rank[kind.get(i) ?? "normal"]) kind.set(i, k);
  };
  for (const v of analysis.violations) {
    if (v.rule === "point_beyond_limits") v.pointIndices.forEach((i) => mark(i, "special"));
    else if (v.rule === "astronomical_point") v.pointIndices.forEach((i) => mark(i, "judgement"));
    else if (PATTERN_RULES[v.rule]) v.pointIndices.forEach((i) => mark(i, "pattern"));
  }

  // ---- brackets, packed into lanes so none overlap
  const patterns = analysis.violations
    .filter((v) => PATTERN_RULES[v.rule] && v.pointIndices.length > 0)
    .map((v) => ({
      rule: v.rule,
      label: PATTERN_RULES[v.rule] ?? v.rule,
      first: Math.min(...v.pointIndices),
      last: Math.max(...v.pointIndices),
      pointIndices: v.pointIndices,
    }))
    .sort((a, b) => a.first - b.first || b.last - a.last);
  const laneEnds: number[] = [];
  const placed = patterns.map((p) => {
    let lane = laneEnds.findIndex((end) => end < p.first);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = p.last;
    return { ...p, lane };
  }).filter((p) => p.lane < MAX_LANES);
  const lanes = placed.length > 0 ? Math.max(...placed.map((p) => p.lane)) + 1 : 0;

  // ---- vertical rhythm, top to bottom
  const flagBand = input.annotations.some((a) => a.periodIndex !== null) ? 22 : 8;
  const xAxisBand = 22;
  const laneBand = lanes * LANE_HEIGHT + (lanes > 0 ? 6 : 0);
  const plotHeight = input.height ?? (compact ? 220 : 300);
  const height = flagBand + plotHeight + xAxisBand + laneBand + 4;

  const left = compact ? 38 : 48;
  const right = width - (compact ? 10 : 16);
  const top = flagBand;
  const bottom = top + plotHeight;

  // ---- x: one slot per period
  const step = n > 0 ? (right - left) / n : 0;
  const x = (i: number) => left + step * (i + 0.5);

  // ---- y: a domain that holds every value, the centre line and every limit
  const values = analysis.observations.map((o) => o.value);
  const extent = [
    ...values,
    analysis.limits.centreLine,
    ...(analysis.limits.upper ?? []),
    ...(analysis.limits.lower ?? []),
  ].filter((v) => Number.isFinite(v));
  let lo = extent.length ? Math.min(...extent) : 0;
  let hi = extent.length ? Math.max(...extent) : 1;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  // A proportion cannot leave [0, 100]%, and counts and rates cannot go below zero.
  if (unit === "%") {
    lo = Math.max(0, lo);
    hi = Math.min(100, hi);
  } else if (Math.min(...values, 0) >= 0) {
    lo = Math.max(0, lo);
  }

  const ticks = niceTicks(lo, hi, compact ? 4 : 5);
  const yMin = Math.min(lo, ticks[0] ?? lo);
  const yMax = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const y = (v: number) => bottom - ((v - yMin) / (yMax - yMin || 1)) * (bottom - top);
  const tickStep = ticks.length > 1 ? (ticks[1] ?? 0) - (ticks[0] ?? 0) : 1;

  const points: PlottedPoint[] = analysis.observations.map((o, i) => ({
    index: i,
    x: x(i),
    y: y(o.value),
    value: o.value,
    label: o.label,
    kind: kind.get(i) ?? "normal",
  }));

  // ---- x labels, thinned so they never collide
  const labelWidth = compact ? 50 : 56;
  const every = Math.max(1, Math.ceil(labelWidth / Math.max(step, 1)));
  // Edge labels anchor inward rather than running off the canvas.
  const xLabels = analysis.observations
    .map((o, i) => ({ index: i, x: x(i), label: o.label }))
    .filter((l) => l.index % every === 0)
    .map((l) => ({
      ...l,
      anchor: (l.x - labelWidth / 2 < 2 ? "start" : l.x + labelWidth / 2 > width - 2 ? "end" : "middle") as
        | "start"
        | "middle"
        | "end",
      x: l.x - labelWidth / 2 < 2 ? Math.max(2, l.x - step / 2) : l.x + labelWidth / 2 > width - 2 ? Math.min(width - 2, l.x + step / 2) : l.x,
    }));

  // ---- limits: stepped when subgroup sizes vary
  const limitPath = (limits: number[] | null) => {
    if (!limits || limits.length === 0) return null;
    const stepped = new Set(limits.map((v) => v.toFixed(10))).size > 1;
    const d = stepped
      ? limits.map((v, i) => `${i === 0 ? "M" : "L"}${(x(i) - step / 2).toFixed(1)},${y(v).toFixed(1)}H${(x(i) + step / 2).toFixed(1)}`).join("")
      : `M${left.toFixed(1)},${y(limits[0] ?? 0).toFixed(1)}H${right.toFixed(1)}`;
    return { path: d, stepped };
  };
  const upperPath = limitPath(analysis.limits.upper);
  const lowerPath = limitPath(analysis.limits.lower);
  const limitLabel = (name: string, limits: number[] | null, stepped: boolean) =>
    stepped ? `${name} (varies)` : `${name} ${formatValue(limits?.[0] ?? 0, unit, tickStep)}`;

  const xAxisY = bottom + 16;
  const laneTop = bottom + xAxisBand + 4;

  return {
    width,
    height,
    compact,
    plot: { left, top, right, bottom },
    step,
    points,
    line: points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(""),
    yTicks: ticks.map((v) => ({ value: v, y: y(v), label: formatValue(v, unit, tickStep) })),
    xLabels,
    centre: {
      y: y(analysis.limits.centreLine),
      value: analysis.limits.centreLine,
      name: analysis.kind === "run" ? "Median" : "Mean",
      label: `${analysis.baseline ? "Baseline " : ""}${analysis.kind === "run" ? "median" : "mean"} ${formatValue(analysis.limits.centreLine, unit, unit === "%" ? 0.1 : tickStep / 10)}`.replace(/^m/, "M"),
      frozenUntilX: analysis.baseline ? x(analysis.baseline.length - 1) + step / 2 : null,
    },
    upper: upperPath ? { ...upperPath, label: limitLabel("UCL", analysis.limits.upper, upperPath.stepped) } : null,
    lower: lowerPath ? { ...lowerPath, label: limitLabel("LCL", analysis.limits.lower, lowerPath.stepped) } : null,
    brackets: placed.map((p) => ({
      rule: p.rule,
      label: p.label,
      x1: x(p.first) - step * 0.35,
      x2: x(p.last) + step * 0.35,
      lane: p.lane,
      y: laneTop + p.lane * LANE_HEIGHT,
      pointIndices: p.pointIndices,
    })),
    annotations: input.annotations
      .filter((a) => a.periodIndex !== null && a.periodIndex >= 1 && a.periodIndex <= n)
      .map((a, i) => ({
        number: i + 1,
        x: x((a.periodIndex as number) - 1),
        label: a.label,
        period: analysis.observations[(a.periodIndex as number) - 1]?.label ?? null,
        description: a.description ?? null,
      })),
    xAxisY,
  };
}

/**
 * Round tick values: steps of 1, 2, 2.5 or 5 times a power of ten, chosen so the
 * number of intervals is closest to `target`, extended outward to cover [lo, hi].
 */
export function niceTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  let best = { step: power, start: 0, end: 0, miss: Infinity };
  for (const m of [1, 2, 2.5, 5, 10]) {
    const step = m * power;
    const start = Math.floor(lo / step + 1e-9) * step;
    const end = Math.ceil(hi / step - 1e-9) * step;
    const miss = Math.abs(Math.round((end - start) / step) - target);
    // Ties go to the larger step: fewer, rounder ticks.
    if (miss <= best.miss) best = { step, start, end, miss };
  }
  const ticks: number[] = [];
  const count = Math.round((best.end - best.start) / best.step);
  for (let i = 0; i <= count; i += 1) {
    // Floating-point clean-up: 0.30000000000000004 -> 0.3
    ticks.push(Number((best.start + i * best.step).toPrecision(12)));
  }
  return ticks;
}

/** Formats a value for an axis or label, with decimals matched to the scale. */
export function formatValue(value: number, unit: string, resolution: number): string {
  const decimals = resolution >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(resolution)));
  return `${value.toFixed(decimals)}${unit}`;
}
