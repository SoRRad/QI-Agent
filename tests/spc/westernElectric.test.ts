import { describe, expect, it } from "vitest";
import { analyseControlChart, westernElectricViolations } from "@/lib/spc";
import type { Observation, RuleName, SpcAnalysis } from "@/lib/spc";

/**
 * Western Electric supplementary rules.
 *
 * Source: the Western Electric *Statistical Quality Control Handbook* rules,
 * as presented in Montgomery, *Introduction to Statistical Quality Control*.
 *
 * Every case below freezes the centre line at 16 on a c chart, which fixes
 * sigma at sqrt(16) = 4 exactly. The zones are therefore:
 *   1 sigma above = 20, 2 sigma = 24, 3 sigma (the limit) = 28.
 * That makes each expected value checkable by inspection.
 */

const plain = (values: number[]): Observation[] =>
  values.map((value, i) => ({ label: `p${i + 1}`, value }));

const rules = (analysis: SpcAnalysis, rule: RuleName) =>
  analysis.violations.filter((v) => v.rule === rule);

const FROZEN = { centreLine: 16 } as const;

describe("the rules are off by default", () => {
  const values = [16, 16, 25, 26, 16, 16, 16, 16, 16, 16, 16, 16];

  it("evaluates nothing supplementary unless asked", () => {
    const analysis = analyseControlChart("c", plain(values), FROZEN);
    expect(analysis.violations.filter((v) => v.rule.startsWith("we_"))).toHaveLength(0);
  });

  it("still evaluates the basic rule, which is not supplementary", () => {
    // A point beyond the limits is the control chart's defining signal, so it
    // is never behind a flag.
    const analysis = analyseControlChart("c", plain([...values.slice(0, 11), 40]), FROZEN);
    expect(rules(analysis, "point_beyond_limits")).toHaveLength(1);
  });
});

describe("two of three consecutive points beyond two sigma", () => {
  it("fires on two of three above 24", () => {
    const analysis = analyseControlChart(
      "c",
      plain([16, 16, 25, 26, 16, 16, 16, 16, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    const found = rules(analysis, "we_two_of_three_beyond_2_sigma");
    expect(found).toHaveLength(1);
    expect(found[0]?.pointIndices).toEqual([2, 3]);
    expect(found[0]?.description).toMatch(/2 of 3 consecutive points more than 2 sigma above/);
  });

  it("does not fire on one of three", () => {
    const analysis = analyseControlChart(
      "c",
      plain([16, 16, 25, 16, 16, 16, 16, 16, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    expect(rules(analysis, "we_two_of_three_beyond_2_sigma")).toHaveLength(0);
  });

  it("does not combine points on opposite sides of the centre line", () => {
    // 25 is beyond 2 sigma above, 7 is beyond 2 sigma below. Two points
    // beyond 2 sigma, but not on the same side, so no signal.
    const analysis = analyseControlChart(
      "c",
      plain([16, 25, 7, 16, 16, 16, 16, 16, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    expect(rules(analysis, "we_two_of_three_beyond_2_sigma")).toHaveLength(0);
  });
});

describe("four of five consecutive points beyond one sigma", () => {
  it("fires on four of five above 20", () => {
    const analysis = analyseControlChart(
      "c",
      plain([16, 21, 22, 21, 22, 16, 16, 16, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    const found = rules(analysis, "we_four_of_five_beyond_1_sigma");
    expect(found).toHaveLength(1);
    expect(found[0]?.pointIndices).toEqual([1, 2, 3, 4]);
  });

  it("does not fire on three of five", () => {
    const analysis = analyseControlChart(
      "c",
      plain([16, 21, 22, 21, 16, 16, 16, 16, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    expect(rules(analysis, "we_four_of_five_beyond_1_sigma")).toHaveLength(0);
  });
});

describe("eight consecutive points on one side", () => {
  it("fires on eight above the centre line", () => {
    const analysis = analyseControlChart(
      "c",
      plain([17, 18, 17, 18, 17, 18, 17, 18, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    const found = rules(analysis, "we_eight_on_one_side");
    expect(found).toHaveLength(1);
    expect(found[0]?.pointIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("does not fire on seven", () => {
    const analysis = analyseControlChart(
      "c",
      plain([17, 18, 17, 18, 17, 18, 17, 15, 16, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    expect(rules(analysis, "we_eight_on_one_side")).toHaveLength(0);
  });

  it("treats a point exactly on the centre line as neither extending nor breaking the run", () => {
    // Four above, one exactly on the line, four above: eight on one side.
    const analysis = analyseControlChart(
      "c",
      plain([17, 18, 17, 18, 16, 17, 18, 17, 18, 16, 16, 16]),
      { ...FROZEN, westernElectric: true },
    );
    const found = rules(analysis, "we_eight_on_one_side");
    expect(found).toHaveLength(1);
    expect(found[0]?.pointIndices).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });
});

describe("zones are evaluated against each point's own sigma", () => {
  /**
   * This is what makes the rules correct on a p or u chart with stepped
   * limits. The same plotted value can be inside the zone for a large
   * subgroup and outside it for a small one, because sigma differs per point.
   */
  const values = [0.54, 0.54, 0.54, 0.54, 0.5, 0.5, 0.5, 0.5];

  it("fires where the point's sigma is small", () => {
    // sigma = 0.025, so one sigma above the centre line is 0.525 and 0.54 is
    // beyond it. Four of the first five qualify.
    const sigma = values.map(() => 0.025);
    const found = westernElectricViolations(values, 0.5, sigma).filter(
      (v) => v.rule === "we_four_of_five_beyond_1_sigma",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.pointIndices).toEqual([0, 1, 2, 3]);
  });

  it("does not fire on the same values where sigma is larger", () => {
    // sigma = 0.05, so one sigma above is 0.55 and 0.54 is inside the zone.
    const sigma = values.map(() => 0.05);
    const found = westernElectricViolations(values, 0.5, sigma).filter(
      (v) => v.rule === "we_four_of_five_beyond_1_sigma",
    );
    expect(found).toHaveLength(0);
  });

  it("ignores points whose sigma is zero rather than dividing by it", () => {
    expect(() => westernElectricViolations(values, 0.5, values.map(() => 0))).not.toThrow();
    expect(westernElectricViolations(values, 0.5, values.map(() => 0))).toEqual(
      expect.arrayContaining([]),
    );
  });
});
