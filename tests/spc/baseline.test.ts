import { describe, expect, it } from "vitest";
import { analyse, analyseAgainstBaseline, frozenParameters, median, mean } from "@/lib/spc";
import type { Observation } from "@/lib/spc";
import { DISCHARGE_SERIES } from "@/prisma/demo-data";

/**
 * Frozen baselines. The expected values are computed by hand from the demo
 * series below, not from the engine: the pooled proportion of the first
 * twelve months is 458 / 1337.
 */

const discharge: Observation[] = DISCHARGE_SERIES.map((p) => ({
  label: p.label,
  value: (p.num / p.den) * 100,
  numerator: p.num,
  denominator: p.den,
}));

describe("frozenParameters", () => {
  it("pools a p chart baseline rather than averaging the proportions", () => {
    const sumNum = DISCHARGE_SERIES.slice(0, 12).reduce((s, p) => s + p.num, 0);
    const sumDen = DISCHARGE_SERIES.slice(0, 12).reduce((s, p) => s + p.den, 0);
    expect([sumNum, sumDen]).toEqual([458, 1337]);
    expect(frozenParameters("p", discharge, 12).centreLine).toBeCloseTo(458 / 1337, 12);
  });

  it("takes the median of the baseline for a run chart", () => {
    const expected = median(discharge.slice(0, 12).map((o) => o.value));
    expect(frozenParameters("run", discharge, 12).centreLine).toBe(expected);
  });

  it("freezes the XmR moving range from ranges inside the baseline only", () => {
    const series: Observation[] = [10, 12, 11, 13, 12, 30, 31, 29].map((value, i) => ({ label: `m${i + 1}`, value }));
    // Baseline 10, 12, 11, 13, 12: ranges 2, 1, 2, 1 -> 1.5. The 12 -> 30 jump is outside.
    const frozen = frozenParameters("xmr", series, 5);
    expect(frozen.centreLine).toBeCloseTo(11.6, 12);
    expect(frozen.movingRangeBar).toBeCloseTo(1.5, 12);

    const analysis = analyseAgainstBaseline("xmr", series, 5);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(11.6 + 2.66 * 1.5, 12);
    // Every post-baseline point is far above a limit built from the quiet baseline.
    expect(analysis.violations.filter((v) => v.rule === "point_beyond_limits").map((v) => v.pointIndices[0])).toEqual([5, 6, 7]);
  });

  it("uses the mean count for a c chart", () => {
    const counts: Observation[] = [4, 6, 5, 5, 9].map((value, i) => ({ label: `m${i + 1}`, value, numerator: value }));
    expect(frozenParameters("c", counts, 4).centreLine).toBe(mean([4, 6, 5, 5]));
  });

  it("refuses a baseline that is too short or longer than the series", () => {
    expect(() => frozenParameters("run", discharge, 1)).toThrow(RangeError);
    expect(() => frozenParameters("run", discharge, 25)).toThrow(RangeError);
    expect(() => frozenParameters("run", discharge, 3.5)).toThrow(RangeError);
  });
});

describe("analyseAgainstBaseline on the discharge series", () => {
  it("freezes the p chart centre line and its limits at the pre-intervention baseline", () => {
    const whole = analyse("p", discharge, { multiplier: 100 });
    const frozen = analyseAgainstBaseline("p", discharge, 12, { multiplier: 100 });

    expect(frozen.limits.centreLine).toBeCloseTo((458 / 1337) * 100, 10);
    expect(frozen.limits.centreLine).toBeGreaterThan(whole.limits.centreLine);
    // Identical to supplying the pooled baseline by hand.
    expect(frozen.limits.upper).toEqual(analyse("p", discharge, { multiplier: 100, centreLine: 458 / 1337 }).limits.upper);
    expect(frozen.baseline).toEqual({ length: 12, firstLabel: "Oct 2024", lastLabel: "Sep 2025" });
  });

  it("turns the step change into points below the lower limit", () => {
    const whole = analyse("p", discharge, { multiplier: 100 });
    const frozen = analyseAgainstBaseline("p", discharge, 12, { multiplier: 100 });
    expect(whole.violations.filter((v) => v.rule === "point_beyond_limits")).toHaveLength(0);
    const below = frozen.violations.filter((v) => v.rule === "point_beyond_limits").map((v) => v.pointIndices[0]);
    expect(below.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...(below as number[]))).toBeGreaterThanOrEqual(12);
  });

  it("keeps the shift on a run chart but drops the runs rules, and says why", () => {
    const frozen = analyseAgainstBaseline("run", discharge, 12);
    const rules = frozen.violations.map((v) => v.rule);
    expect(rules).toContain("shift");
    expect(rules).not.toContain("too_few_runs");
    expect(rules).not.toContain("too_many_runs");
    expect(frozen.notes.join(" ")).toMatch(/runs rules are not applied/);
    // All twelve post-intervention months sit below the baseline median.
    const lastShift = frozen.violations.filter((v) => v.rule === "shift").at(-1);
    expect(lastShift?.pointIndices).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });

  it("flags a short baseline as provisional", () => {
    expect(analyseAgainstBaseline("p", discharge, 6, { multiplier: 100 }).notes.join(" ")).toMatch(/only 6 points/);
    expect(analyseAgainstBaseline("p", discharge, 12, { multiplier: 100 }).notes.join(" ")).not.toMatch(/provisional/);
  });
});
