import { describe, expect, it } from "vitest";
import { analyse, median } from "@/lib/spc";
import type { Observation } from "@/lib/spc";
import { DISCHARGE_SERIES, LAB_SERIES } from "@/prisma/demo-data";

/**
 * The seeded demo data must visibly fire the engine, because a committee
 * demonstration that shows a flat chart proves nothing. These tests pin that
 * behaviour to the actual seeded numbers, so the seed and the demo script
 * cannot drift apart silently.
 *
 * See docs/DEMO.md.
 */

const dischargeObservations: Observation[] = DISCHARGE_SERIES.map((p) => ({
  label: p.label,
  value: (p.num / p.den) * 100,
  numerator: p.num,
  denominator: p.den,
}));

describe("the discharge summary series", () => {
  it("has a median of 26.75% across 24 points", () => {
    const values = dischargeObservations.map((o) => o.value);
    expect(values).toHaveLength(24);
    expect(median(values)).toBeCloseTo(26.749, 3);
  });

  it("fires a shift of twelve above and twelve below the median", () => {
    const analysis = analyse("run", dischargeObservations);
    const shifts = analysis.violations.filter((v) => v.rule === "shift");

    expect(shifts).toHaveLength(2);
    expect(shifts[0]?.pointIndices).toHaveLength(12);
    expect(shifts[1]?.pointIndices).toHaveLength(12);
    // The step change lands at the October 2025 intervention, which is index 12.
    expect(shifts[1]?.pointIndices[0]).toBe(12);
  });

  it("fires too few runs: two runs across twenty-four useful observations", () => {
    const analysis = analyse("run", dischargeObservations);
    expect(analysis.usefulObservations).toBe(24);

    const few = analysis.violations.filter((v) => v.rule === "too_few_runs");
    expect(few).toHaveLength(1);
    expect(few[0]?.description).toMatch(
      /2 runs across 24 useful observations, where 8 is the fewest/,
    );
  });

  it("fires a trend across the step change", () => {
    // Five consecutive decreasing points as the series drops through the
    // intervention. Incidental rather than designed, and genuinely present.
    const analysis = analyse("run", dischargeObservations);
    const trends = analysis.violations.filter((v) => v.rule === "trend");
    expect(trends).toHaveLength(1);
    expect(trends[0]?.pointIndices).toHaveLength(5);
  });

  it("produces stepped p-chart limits, because the denominators vary", () => {
    const analysis = analyse("p", dischargeObservations, { multiplier: 100 });

    // July 2025 has the smallest denominator (95) and April 2025 the largest
    // (127), so July must carry the widest limits.
    const july = DISCHARGE_SERIES.findIndex((p) => p.label === "Jul 2025");
    const april = DISCHARGE_SERIES.findIndex((p) => p.label === "Apr 2025");
    expect(DISCHARGE_SERIES[july]?.den).toBe(95);
    expect(DISCHARGE_SERIES[april]?.den).toBe(127);

    const width = (i: number): number =>
      (analysis.limits.upper?.[i] ?? 0) - (analysis.limits.lower?.[i] ?? 0);
    expect(width(july)).toBeGreaterThan(width(april));

    // Flat limits would be a bug, not a simplification.
    expect(new Set(analysis.limits.upper).size).toBeGreaterThan(1);
  });

  /**
   * A teaching case, and the reason the run chart is not redundant.
   *
   * Limits computed across the WHOLE series absorb the step change into the
   * estimate of variation: pbar comes out at 26.2% with limits of roughly
   * 13.6% to 38.8%, and every one of the 24 points sits inside them. The
   * control chart shows nothing.
   *
   * Freeze the limits on the 12-month baseline instead — pbar 34.3% — and 11
   * of the 12 post-intervention points fall below the lower limit.
   *
   * The improvement did not change; the analyst's choice did. This is why
   * limits are frozen at an intervention rather than recomputed over it.
   */
  it("shows nothing beyond the limits when they span the step change", () => {
    const analysis = analyse("p", dischargeObservations, { multiplier: 100 });
    expect(analysis.limits.centreLine).toBeCloseTo(26.213, 2);
    expect(analysis.violations.filter((v) => v.rule === "point_beyond_limits")).toHaveLength(0);
  });

  it("signals 11 of 12 post-intervention points once limits are frozen on the baseline", () => {
    // Baseline: 458 late summaries over 1,337 discharges = 0.342558...
    const baseline = 458 / 1337;
    const analysis = analyse("p", dischargeObservations, {
      multiplier: 100,
      centreLine: baseline,
    });

    expect(analysis.limits.centreLine).toBeCloseTo(34.256, 2);

    const beyond = analysis.violations.filter((v) => v.rule === "point_beyond_limits");
    expect(beyond).toHaveLength(11);
    // October 2025 (index 12, 22.4%) is the only post-intervention point still
    // inside the baseline limits; the change had not fully taken hold yet.
    expect(beyond.map((v) => v.pointIndices[0])).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });
});

describe("the laboratory draws series", () => {
  const labObservations: Observation[] = LAB_SERIES.map((r) => ({
    label: r.label,
    value: r.count / r.days,
    numerator: r.count,
    denominator: r.days,
  }));

  it("is a u chart with varying exposure and therefore stepped limits", () => {
    const analysis = analyse("u", labObservations);
    expect(analysis.limits.centreLine).toBeGreaterThan(0);
    expect(new Set(analysis.limits.upper).size).toBeGreaterThan(1);
  });

  it("shows the drop after standing orders were retired", () => {
    const analysis = analyse("run", labObservations);
    const shifts = analysis.violations.filter((v) => v.rule === "shift");
    expect(shifts.length).toBeGreaterThan(0);
  });
});
