import type { ChartKind, RuleName, SpcAnalysis } from "@/lib/spc";
import { formatValue } from "./layout";

/**
 * Words for a chart: its accessible description, the readout for one point,
 * and short rule names. Pure, so the SVG title, the tooltip, the screen-reader
 * announcement and the data table all say the same thing.
 */

export const RULE_LABELS: Record<RuleName, string> = {
  shift: "Shift",
  trend: "Trend",
  too_few_runs: "Too few runs",
  too_many_runs: "Too many runs",
  astronomical_point: "Possible astronomical point",
  point_beyond_limits: "Beyond a control limit",
  we_two_of_three_beyond_2_sigma: "2 of 3 beyond 2σ",
  we_four_of_five_beyond_1_sigma: "4 of 5 beyond 1σ",
  we_eight_on_one_side: "8 on one side",
};

export const CHART_NAMES: Record<ChartKind, string> = {
  run: "Run chart",
  xmr: "XmR chart",
  p: "p chart",
  u: "u chart",
  c: "c chart",
};

/** The unit suffix a chart kind displays with. p charts are shown in percent. */
export function unitFor(kind: ChartKind, measureChartType: ChartKind): string {
  // A run chart of a p-chart measure is still a percentage.
  return (kind === "p" || (kind === "run" && measureChartType === "p")) ? "%" : "";
}

/**
 * Decimals for a point's own value: one for percentages, whole numbers for
 * counts, otherwise enough to distinguish typical values.
 */
export function readoutResolution(kind: ChartKind, unit: string, values: readonly number[]): number {
  if (unit === "%") return 0.1;
  if (kind === "c" || values.every((v) => Number.isInteger(v))) return 1;
  const span = Math.max(...values) - Math.min(...values);
  return span >= 10 ? 0.1 : 0.01;
}

export function centreName(analysis: SpcAnalysis): string {
  const name = analysis.kind === "run" ? "median" : "mean";
  return analysis.baseline ? `Baseline ${name}` : name[0]!.toUpperCase() + name.slice(1);
}

/** Rules that involve point `index`, as short labels. The runs rules are about the whole series and are excluded. */
export function rulesAt(analysis: SpcAnalysis, index: number): string[] {
  return [
    ...new Set(
      analysis.violations
        .filter((v) => v.rule !== "too_few_runs" && v.rule !== "too_many_runs" && v.pointIndices.includes(index))
        .map((v) => RULE_LABELS[v.rule]),
    ),
  ];
}

export interface PointReadout {
  period: string;
  value: string;
  counts: string | null;
  centre: string;
  centreValue: string;
  limits: string | null;
  rules: string[];
}

export function pointReadout(analysis: SpcAnalysis, unit: string, index: number): PointReadout | null {
  const o = analysis.observations[index];
  if (!o) return null;
  const resolution = readoutResolution(analysis.kind, unit, analysis.observations.map((p) => p.value));
  const fmt = (v: number) => formatValue(v, unit, resolution);
  const upper = analysis.limits.upper?.[index];
  const lower = analysis.limits.lower?.[index];

  return {
    period: o.label,
    value: fmt(o.value),
    counts:
      typeof o.numerator === "number" && typeof o.denominator === "number"
        ? `${o.numerator.toLocaleString("en-US")} of ${o.denominator.toLocaleString("en-US")}`
        : null,
    centre: `${centreName(analysis)} ${fmt(analysis.limits.centreLine)}`,
    centreValue: fmt(analysis.limits.centreLine),
    limits: upper !== undefined && lower !== undefined ? `${fmt(lower)} to ${fmt(upper)}` : null,
    rules: rulesAt(analysis, index),
  };
}

/** One line for a screen reader when the keyboard moves to a point. */
export function readoutSentence(readout: PointReadout, position: { index: number; total: number }): string {
  return [
    `${readout.period}: ${readout.value}`,
    readout.counts ? ` (${readout.counts})` : "",
    `. ${readout.centre}.`,
    readout.limits ? ` Limits ${readout.limits}.` : "",
    readout.rules.length ? ` Special cause: ${readout.rules.join(", ")}.` : "",
    ` Point ${position.index + 1} of ${position.total}.`,
  ].join("");
}

/** The SVG <desc>: what a sighted reader takes in at a glance. */
export function describeChart(analysis: SpcAnalysis, unit: string): string {
  const n = analysis.observations.length;
  if (n === 0) return "No data points yet.";
  const first = analysis.observations[0]?.label;
  const last = analysis.observations[n - 1]?.label;
  const resolution = readoutResolution(analysis.kind, unit, analysis.observations.map((p) => p.value));
  const parts = [
    `${CHART_NAMES[analysis.kind]} of ${n} points from ${first} to ${last}.`,
    `${centreName(analysis)} ${formatValue(analysis.limits.centreLine, unit, resolution)}${
      analysis.baseline ? `, frozen from ${analysis.baseline.firstLabel} to ${analysis.baseline.lastLabel}` : ""
    }.`,
  ];
  const signals = findings(analysis).map((f) => (f.periods ? `${f.title} ${f.periods}` : f.title));
  parts.push(signals.length ? `Signals: ${signals.join("; ")}.` : "No special-cause signals.");
  return parts.join(" ");
}

export interface Finding {
  rule: RuleName;
  title: string;
  /** "from Oct 2024 to Sep 2025", "at Nov 2025", or null for whole-series rules. */
  periods: string | null;
  /** The engine's plain-language descriptions, one per violation. */
  details: string[];
  /** True for the astronomical point rule, which asks for judgement. */
  judgement: boolean;
}

/**
 * Violations grouped for reading: every point beyond a limit becomes ONE
 * finding listing its periods, rather than eleven near-identical sentences.
 * Pattern rules stay one finding each, since each is its own event.
 */
export function findings(analysis: SpcAnalysis): Finding[] {
  const label = (i: number) => analysis.observations[i]?.label ?? "";
  const span = (indices: number[]) => {
    const a = label(Math.min(...indices));
    const b = label(Math.max(...indices));
    return a === b ? `at ${a}` : `from ${a} to ${b}`;
  };
  const out: Finding[] = [];
  const grouped = new Map<RuleName, Finding>();

  for (const v of analysis.violations) {
    const wholeSeries = v.rule === "too_few_runs" || v.rule === "too_many_runs";
    if (v.rule === "point_beyond_limits" || v.rule === "astronomical_point") {
      const existing = grouped.get(v.rule);
      if (existing) {
        existing.details.push(v.description);
        continue;
      }
      const finding: Finding = { rule: v.rule, title: RULE_LABELS[v.rule], periods: null, details: [v.description], judgement: v.rule === "astronomical_point" };
      grouped.set(v.rule, finding);
      out.push(finding);
      continue;
    }
    out.push({
      rule: v.rule,
      title: RULE_LABELS[v.rule],
      periods: wholeSeries ? null : span(v.pointIndices),
      details: [v.description],
      judgement: false,
    });
  }

  for (const [rule, finding] of grouped) {
    const indices = analysis.violations.filter((v) => v.rule === rule).flatMap((v) => v.pointIndices);
    const labels = [...new Set(indices)].sort((a, b) => a - b).map(label);
    finding.periods = labels.length === 1 ? `at ${labels[0]}` : `at ${labels.length} periods: ${labels.join(", ")}`;
  }
  return out;
}
