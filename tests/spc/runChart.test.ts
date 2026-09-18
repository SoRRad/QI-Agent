import { describe, expect, it } from "vitest";
import { analyseRunChart, median } from "@/lib/spc";
import type { Observation, RuleName, SpcAnalysis } from "@/lib/spc";

/**
 * Run chart rules, per Perla, Provost & Murray (2011).
 *
 * Each test asserts on the SPECIFIC rule under test rather than on the total
 * violation count, because a real series frequently trips more than one rule
 * at once — a step change produces a shift and too few runs together — and a
 * test that demanded exactly one violation would be testing an artificial
 * series rather than the rule.
 */

const series = (values: number[]): Observation[] =>
  values.map((value, i) => ({ label: `p${i + 1}`, value }));

const rules = (analysis: SpcAnalysis, rule: RuleName) =>
  analysis.violations.filter((v) => v.rule === rule);

describe("the median centre line", () => {
  it("is the middle value for an odd series and the mean of the middle two for an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    // A single extreme point must not move it: that is why the run chart uses
    // the median rather than the mean.
    expect(median([1, 2, 3, 4, 1000])).toBe(3);
  });

  it("throws rather than inventing a value for an empty series", () => {
    expect(() => median([])).toThrow(/empty series/i);
  });
});

describe("rule 1 — shift of six or more", () => {
  it("fires on exactly six consecutive points on one side", () => {
    // Median = 4.5. Six points above, then six below, neither monotonic.
    const analysis = analyseRunChart(series([7, 8, 7, 8, 7, 8, 1, 2, 1, 2, 1, 2]));
    expect(median([7, 8, 7, 8, 7, 8, 1, 2, 1, 2, 1, 2])).toBe(4.5);

    const shifts = rules(analysis, "shift");
    expect(shifts).toHaveLength(2);
    expect(shifts[0]?.pointIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(shifts[1]?.pointIndices).toEqual([6, 7, 8, 9, 10, 11]);
    expect(shifts[0]?.description).toMatch(/6 consecutive points above the median of 4\.50/);
  });

  it("does not fire on five", () => {
    // Median = 4.5 again, but the longest same-side run is five.
    const values = [7, 8, 7, 8, 7, 1, 2, 1, 2, 1, 7, 8, 1, 2, 7, 8, 1, 2];
    const analysis = analyseRunChart(series(values));
    expect(rules(analysis, "shift")).toHaveLength(0);
  });

  /**
   * THE SUBTLE ONE. A point lying exactly on the median is skipped: it is not
   * counted, and it does not break a shift.
   *
   * Here three points above, then one exactly on the median, then three more
   * above, must count as a shift of six. If the median point broke the shift
   * there would be two runs of three and no violation at all.
   */
  it("skips a point lying on the median without breaking a shift", () => {
    const values = [6, 7, 8, 5, 9, 10, 11, 1, 2, 3, 4, 1, 2];
    expect(median(values)).toBe(5); // the fourth point sits exactly on it

    const analysis = analyseRunChart(series(values));
    const shifts = rules(analysis, "shift");

    expect(shifts).toHaveLength(2);
    // Index 3 is the on-median point: absent from the shift, and not breaking it.
    expect(shifts[0]?.pointIndices).toEqual([0, 1, 2, 4, 5, 6]);
    expect(shifts[0]?.description).toMatch(/ignoring 1 point lying on the median/);
  });

  it("excludes points on the median from the useful observation count", () => {
    const values = [6, 7, 8, 5, 9, 10, 11, 1, 2, 3, 4, 1, 2];
    const analysis = analyseRunChart(series(values));
    // Thirteen plotted points, twelve useful: the runs table is indexed by
    // the useful count, not the series length.
    expect(analysis.observations).toHaveLength(13);
    expect(analysis.usefulObservations).toBe(12);
  });
});

describe("rule 2 — trend of five or more", () => {
  it("fires on five consecutive increasing points", () => {
    const analysis = analyseRunChart(series([5, 4, 5, 4, 1, 2, 3, 4, 5, 4, 5, 4]));
    const trends = rules(analysis, "trend");
    expect(trends).toHaveLength(1);
    expect(trends[0]?.pointIndices).toEqual([4, 5, 6, 7, 8]);
    expect(trends[0]?.description).toMatch(/5 consecutive points increasing/);
  });

  it("does not fire on four", () => {
    const analysis = analyseRunChart(series([5, 4, 5, 1, 2, 3, 4, 3, 4, 3, 4, 3]));
    expect(rules(analysis, "trend")).toHaveLength(0);
  });

  it("fires on a decreasing trend too", () => {
    const analysis = analyseRunChart(series([4, 5, 4, 5, 9, 8, 7, 6, 5, 6, 5, 6]));
    const trends = rules(analysis, "trend");
    expect(trends).toHaveLength(1);
    expect(trends[0]?.description).toMatch(/5 consecutive points decreasing/);
  });

  /**
   * Where two consecutive points are EQUAL, one is ignored: a repeated value
   * is neither an increase nor a decrease.
   *
   * 1, 2, 3, 3, 4, 5 is a trend of five. Treating the repeat as breaking the
   * sequence would give two runs of three and no violation, which is the bug
   * this test exists to catch.
   */
  it("ignores one of two equal consecutive points when counting a trend", () => {
    const analysis = analyseRunChart(series([1, 2, 3, 3, 4, 5, 2, 8, 2, 8, 2, 8]));
    const trends = rules(analysis, "trend");
    expect(trends).toHaveLength(1);
    // Index 3 is the repeated value: ignored, and the trend spans it.
    expect(trends[0]?.pointIndices).toEqual([0, 1, 2, 4, 5]);
  });

  it("does not manufacture a trend from a run of identical values", () => {
    const analysis = analyseRunChart(series([5, 5, 5, 5, 5, 5, 5, 5, 1, 9, 1, 9]));
    expect(rules(analysis, "trend")).toHaveLength(0);
  });
});

describe("rule 3 — too few or too many runs", () => {
  it("fires on too few runs", () => {
    // Twelve useful observations in two runs; the table's lower limit is 4.
    const analysis = analyseRunChart(series([1, 2, 3, 4, 3, 2, 9, 8, 7, 8, 9, 8]));
    const few = rules(analysis, "too_few_runs");
    expect(few).toHaveLength(1);
    expect(few[0]?.description).toMatch(/2 runs across 12 useful observations, where 4 is the fewest/);
  });

  it("fires on too many runs", () => {
    // Perfect alternation: twelve runs across twelve useful observations,
    // against an upper limit of 10.
    const analysis = analyseRunChart(series([1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9]));
    const many = rules(analysis, "too_many_runs");
    expect(many).toHaveLength(1);
    expect(many[0]?.description).toMatch(/12 runs across 12 useful observations, where 10 is the most/);
  });

  it("stays silent when the run count sits inside the limits", () => {
    // Median = 4.5, six runs: inside the 4-to-10 band for twelve observations.
    const analysis = analyseRunChart(series([7, 8, 1, 2, 7, 8, 1, 2, 7, 8, 1, 2]));
    expect(rules(analysis, "too_few_runs")).toHaveLength(0);
    expect(rules(analysis, "too_many_runs")).toHaveLength(0);
  });
});

describe("rule 4 — astronomical point", () => {
  const wild = [10, 11, 10, 12, 11, 10, 11, 12, 10, 11, 10, 90];

  it("is off unless explicitly requested, because it is a judgement", () => {
    const analysis = analyseRunChart(series(wild));
    expect(rules(analysis, "astronomical_point")).toHaveLength(0);
  });

  it("surfaces one candidate and marks it as requiring human judgement", () => {
    const analysis = analyseRunChart(series(wild), { detectAstronomicalPoints: true });
    const candidates = rules(analysis, "astronomical_point");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.pointIndices).toEqual([11]);
    expect(candidates[0]?.requiresJudgement).toBe(true);
    expect(candidates[0]?.description).toMatch(/judgement, not a test/);
  });

  it("surfaces nothing on a series with no standout point", () => {
    const analysis = analyseRunChart(series([10, 11, 10, 12, 11, 10, 11, 12, 10, 11, 10, 12]), {
      detectAstronomicalPoints: true,
    });
    expect(rules(analysis, "astronomical_point")).toHaveLength(0);
  });
});

describe("series too short for the rules", () => {
  it("plots but does not evaluate below twelve points", () => {
    const analysis = analyseRunChart(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(analysis.violations).toHaveLength(0);
    expect(analysis.limits.centreLine).toBe(6);
    expect(analysis.notes.join(" ")).toMatch(/Only 11 points.*at least 12/);
  });

  it("handles an empty series without throwing", () => {
    const analysis = analyseRunChart([]);
    expect(analysis.violations).toHaveLength(0);
    expect(analysis.notes).toContain("No data points.");
  });

  it("notes when every point lies on the median", () => {
    const analysis = analyseRunChart(series(Array.from({ length: 12 }, () => 5)));
    expect(analysis.usefulObservations).toBe(0);
    expect(analysis.notes.join(" ")).toMatch(/Every point lies on the median/);
  });
});

describe("a frozen baseline centre line", () => {
  it("tests later points against the baseline rather than the whole series", () => {
    // Baseline median 10, then a sustained drop. Against the whole series the
    // median would move down with the data and hide the shift.
    const values = [10, 11, 9, 10, 11, 12, 2, 3, 2, 3, 2, 3];
    const analysis = analyseRunChart(series(values), { centreLine: 10 });
    expect(analysis.limits.centreLine).toBe(10);

    const shifts = rules(analysis, "shift");
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.pointIndices).toEqual([6, 7, 8, 9, 10, 11]);
  });
});
