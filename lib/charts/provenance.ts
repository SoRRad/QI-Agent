import {
  runsCriticalValues,
  SHIFT_LENGTH,
  TREND_LENGTH,
  type ChartKind,
  type SpcAnalysis,
} from "@/lib/spc";
import { formatValue } from "./layout";

/**
 * The numbers-provenance inspector (addition C5).
 *
 * For each number on the chart: which pure function produced it, from how
 * many points, and by what formula. A committee member who doubts a centre
 * line can find the function and its test without asking anyone — and can
 * see that no language model was involved.
 */

export interface ProvenanceRow {
  quantity: string;
  value: string;
  /** Function call as it appears in the code, e.g. `median(values)`. */
  computedBy: string;
  file: string;
  over: string;
}

const FORMULA: Record<Exclude<ChartKind, "run">, { centre: string; limits: string }> = {
  xmr: { centre: "mean of the values", limits: "mean ± 2.66 × average moving range" },
  p: { centre: "pooled p̄ = Σ numerators ÷ Σ denominators", limits: "p̄ ± 3 × √(p̄(1 − p̄) ÷ nᵢ), per point, clamped to 0–100%" },
  u: { centre: "pooled ū = Σ counts ÷ Σ exposure", limits: "ū ± 3 × √(ū ÷ nᵢ), per point, lower clamped to 0" },
  c: { centre: "mean count c̄", limits: "c̄ ± 3 × √c̄, lower clamped to 0" },
};

export function provenance(
  analysis: SpcAnalysis,
  context: { measureChartType: ChartKind; unit: string; westernElectric: boolean },
): ProvenanceRow[] {
  const n = analysis.observations.length;
  const fmt = (v: number) => formatValue(v, context.unit, context.unit === "%" ? 0.1 : 0.01);
  const b = analysis.baseline;
  const baseOver = b ? `first ${b.length} of ${n} points (${b.firstLabel} – ${b.lastLabel})` : `all ${n} points`;
  const rows: ProvenanceRow[] = [];

  const valueRule: Record<ChartKind, string> = {
    p: "numerator ÷ denominator × 100",
    u: "count ÷ exposure",
    c: "the count as entered",
    run: "as entered",
    xmr: "as entered",
  };
  rows.push({
    quantity: "Plotted values",
    value: `${n} points`,
    computedBy:
      analysis.kind === "p" || analysis.kind === "u"
        ? `analyseControlChart("${analysis.kind}") re-derives each from numerator and denominator`
        : `pointValue("${context.measureChartType}") when each point was entered: ${valueRule[context.measureChartType]}`,
    file: analysis.kind === "p" || analysis.kind === "u" ? "lib/spc/controlChart.ts" : "lib/charts/points.ts",
    over: `${n} points`,
  });

  if (analysis.kind === "run") {
    rows.push({
      quantity: b ? "Baseline median" : "Median",
      value: fmt(analysis.limits.centreLine),
      computedBy: b ? `frozenParameters("run", points, ${b.length}) → median()` : "median(values)",
      file: b ? "lib/spc/baseline.ts, lib/spc/median.ts" : "lib/spc/median.ts",
      over: baseOver,
    });
    rows.push({
      quantity: "Shift and trend",
      value: `${SHIFT_LENGTH}+ on one side; ${TREND_LENGTH}+ rising or falling`,
      computedBy: "analyseRunChart(points)",
      file: "lib/spc/runChart.ts",
      over: `${analysis.usefulObservations} points off the centre line`,
    });
    if (!b) {
      const critical = runsCriticalValues(analysis.usefulObservations);
      rows.push({
        quantity: "Runs expected",
        value: critical ? `${critical.lower} to ${critical.upper}` : "not evaluated (fewer than 10 useful points)",
        computedBy: `runsCriticalValues(${analysis.usefulObservations})`,
        file: "lib/spc/runs.ts",
        over: `${analysis.usefulObservations} useful observations`,
      });
    }
  } else {
    const formula = FORMULA[analysis.kind];
    rows.push({
      quantity: b ? "Baseline centre line" : "Centre line",
      value: fmt(analysis.limits.centreLine),
      computedBy: b ? `frozenParameters("${analysis.kind}", points, ${b.length}): ${formula.centre}` : `analyseControlChart("${analysis.kind}"): ${formula.centre}`,
      file: b ? "lib/spc/baseline.ts" : "lib/spc/controlChart.ts",
      over: baseOver,
    });
    const upper = analysis.limits.upper ?? [];
    const stepped = new Set(upper.map((v) => v.toFixed(10))).size > 1;
    rows.push({
      quantity: "Control limits",
      value: stepped ? "stepped: one pair per point" : `${fmt(analysis.limits.lower?.[0] ?? 0)} to ${fmt(upper[0] ?? 0)}`,
      computedBy: `analyseControlChart("${analysis.kind}"): ${formula.limits}`,
      file: "lib/spc/controlChart.ts",
      over: b ? `sigma from the ${b.length}-point baseline, applied to all ${n}` : `all ${n} points`,
    });
    rows.push({
      quantity: "Western Electric rules",
      value: context.westernElectric ? "on" : "off",
      computedBy: context.westernElectric ? "westernElectricViolations(values, centre, sigma)" : "not run",
      file: "lib/spc/westernElectric.ts",
      over: context.westernElectric ? `all ${n} points` : "—",
    });
  }
  return rows;
}
