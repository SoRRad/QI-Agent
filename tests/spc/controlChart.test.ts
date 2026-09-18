import { describe, expect, it } from "vitest";
import { analyseControlChart, movingRangeChart } from "@/lib/spc";
import type { Observation } from "@/lib/spc";

/**
 * Control chart limits.
 *
 * FORMULAS AND THEIR SOURCES:
 *   XmR      Wheeler, *Understanding Variation*; Montgomery, *Introduction to
 *            Statistical Quality Control*. CL = mean; limits = CL +/- 2.660 *
 *            mRbar, where 2.660 = 3 / d2 and d2 = 1.128 for n = 2. Moving
 *            range chart UCL = D4 * mRbar, D4 = 3.267 for n = 2.
 *   p        Montgomery. pbar = sum(numerators)/sum(denominators);
 *            sigma_i = sqrt(pbar(1-pbar)/n_i); limits = pbar +/- 3 sigma_i.
 *   u        Montgomery. ubar = sum(counts)/sum(exposure);
 *            sigma_i = sqrt(ubar/n_i); limits = ubar +/- 3 sigma_i.
 *   c        Montgomery. cbar = mean count; limits = cbar +/- 3 sqrt(cbar).
 *
 * EXPECTED VALUES: every case below is constructed so that the arithmetic is
 * EXACT and can be checked with a calculator from the numbers in the test
 * itself — pbar = 0.2 with n = 100 gives sigma = sqrt(0.0016) = 0.04 exactly,
 * and so on. The expected values were derived by hand from the formulas
 * above, not produced by running this code and pasting the output.
 *
 * docs/VALIDATION.md lists each case with its arithmetic worked through.
 */

const p = (rows: Array<[num: number, den: number]>): Observation[] =>
  rows.map(([numerator, denominator], i) => ({
    label: `p${i + 1}`,
    value: numerator / denominator,
    numerator,
    denominator,
  }));

const plain = (values: number[]): Observation[] =>
  values.map((value, i) => ({ label: `p${i + 1}`, value }));

describe("c chart — counts over constant exposure", () => {
  // cbar = 192 / 12 = 16 exactly; sqrt(16) = 4; limits = 16 +/- 12.
  const counts = [14, 18, 16, 16, 15, 17, 16, 16, 13, 19, 16, 16];

  it("centres on the mean count with limits at three root-cbar", () => {
    expect(counts.reduce((a, b) => a + b, 0)).toBe(192); // the arithmetic, stated

    const analysis = analyseControlChart("c", plain(counts));
    expect(analysis.limits.centreLine).toBe(16);
    expect(analysis.limits.upper?.[0]).toBe(28);
    expect(analysis.limits.lower?.[0]).toBe(4);
    expect(analysis.limits.sigma?.[0]).toBe(4);
  });

  it("uses flat limits, because the exposure is constant", () => {
    const analysis = analyseControlChart("c", plain(counts));
    expect(new Set(analysis.limits.upper)).toEqual(new Set([28]));
  });

  it("signals a point beyond the limits", () => {
    // Frozen baseline of 16, so the outlier cannot drag the centre line with it.
    const analysis = analyseControlChart("c", plain([...counts.slice(0, 11), 29]), {
      centreLine: 16,
    });
    const beyond = analysis.violations.filter((v) => v.rule === "point_beyond_limits");
    expect(beyond).toHaveLength(1);
    expect(beyond[0]?.pointIndices).toEqual([11]);
    expect(beyond[0]?.description).toMatch(/29 against an upper limit of 28/);
  });

  it("clamps the lower limit at zero rather than reporting a negative count", () => {
    // cbar = 2, 3*sqrt(2) = 4.243 > 2, so the lower limit would go negative.
    const analysis = analyseControlChart("c", plain(Array.from({ length: 12 }, () => 2)));
    expect(analysis.limits.centreLine).toBe(2);
    expect(analysis.limits.lower?.[0]).toBe(0);
  });
});

describe("p chart — proportion with a constant denominator", () => {
  // 240 / 1200 = 0.2. sigma = sqrt(0.2 * 0.8 / 100) = sqrt(0.0016) = 0.04.
  // Limits = 0.2 +/- 0.12 = 0.08 and 0.32.
  const rows: Array<[number, number]> = [
    [18, 100], [22, 100], [20, 100], [20, 100], [17, 100], [23, 100],
    [20, 100], [20, 100], [15, 100], [25, 100], [20, 100], [20, 100],
  ];

  it("computes pooled pbar and three-sigma limits", () => {
    expect(rows.reduce((s, [n]) => s + n, 0)).toBe(240); // the arithmetic, stated

    const analysis = analyseControlChart("p", p(rows));
    expect(analysis.limits.centreLine).toBeCloseTo(0.2, 12);
    expect(analysis.limits.sigma?.[0]).toBeCloseTo(0.04, 12);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.32, 12);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(0.08, 12);
  });

  it("scales to percent with the multiplier, limits included", () => {
    const analysis = analyseControlChart("p", p(rows), { multiplier: 100 });
    expect(analysis.limits.centreLine).toBeCloseTo(20, 10);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(32, 10);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(8, 10);
    expect(analysis.observations[0]?.value).toBeCloseTo(18, 10);
  });

  it("derives the plotted value from numerator and denominator", () => {
    // The chart and the stored value cannot disagree, because the chart does
    // not read the stored value.
    const lying = p(rows).map((o) => ({ ...o, value: 999 }));
    const analysis = analyseControlChart("p", lying);
    expect(analysis.observations[0]?.value).toBeCloseTo(0.18, 12);
  });
});

describe("p chart — variable denominator produces stepped limits", () => {
  // pbar = 1500 / 3000 = 0.5.
  //   n = 100: sigma = sqrt(0.25/100) = 0.05  -> limits 0.35 and 0.65
  //   n = 400: sigma = sqrt(0.25/400) = 0.025 -> limits 0.425 and 0.575
  const rows: Array<[number, number]> = [
    [50, 100], [50, 100], [50, 100], [50, 100], [50, 100], [50, 100],
    [200, 400], [200, 400], [200, 400], [200, 400], [200, 400], [200, 400],
  ];

  it("gives each point its own limit", () => {
    const analysis = analyseControlChart("p", p(rows));
    expect(analysis.limits.centreLine).toBeCloseTo(0.5, 12);

    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.65, 12);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(0.35, 12);

    expect(analysis.limits.upper?.[6]).toBeCloseTo(0.575, 12);
    expect(analysis.limits.lower?.[6]).toBeCloseTo(0.425, 12);
  });

  it("narrows the limits as the subgroup grows", () => {
    // The point of stepped limits: a month of 400 has less natural variation
    // than a month of 100, and a flat limit across both is simply wrong.
    const analysis = analyseControlChart("p", p(rows));
    const width = (i: number): number =>
      (analysis.limits.upper?.[i] ?? 0) - (analysis.limits.lower?.[i] ?? 0);
    expect(width(6)).toBeLessThan(width(0));
    expect(width(0) / width(6)).toBeCloseTo(2, 10); // sqrt(400/100) = 2
  });
});

describe("p chart — pooled, not averaged", () => {
  it("weights by denominator rather than averaging the proportions", () => {
    // Proportions 0.01 and 0.9 average to 0.455, but the pooled proportion is
    // 10/110 = 0.0909...  Averaging would let a subgroup of 10 outvote one of
    // 100, which is the classic p chart error.
    const analysis = analyseControlChart("p", p([[1, 100], [9, 10]]));
    expect(analysis.limits.centreLine).toBeCloseTo(10 / 110, 12);
    expect(analysis.limits.centreLine).not.toBeCloseTo(0.455, 2);
  });
});

describe("p chart — limits clamped to the interval a proportion can occupy", () => {
  it("clamps a negative lower limit to zero", () => {
    // pbar = 24/1200 = 0.02; sigma = sqrt(0.02*0.98/100) = sqrt(0.000196)
    // = 0.014; 3 sigma = 0.042, so the lower limit would be -0.022.
    const analysis = analyseControlChart("p", p(Array.from({ length: 12 }, () => [2, 100] as [number, number])));
    expect(analysis.limits.centreLine).toBeCloseTo(0.02, 12);
    expect(analysis.limits.sigma?.[0]).toBeCloseTo(0.014, 12);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.062, 12);
    expect(analysis.limits.lower?.[0]).toBe(0);
  });

  it("clamps an upper limit above one", () => {
    // pbar = 0.98 mirrored: the upper limit would exceed 1.
    const analysis = analyseControlChart("p", p(Array.from({ length: 12 }, () => [98, 100] as [number, number])));
    expect(analysis.limits.upper?.[0]).toBe(1);
  });
});

describe("u chart — counts per unit of exposure", () => {
  it("computes ubar and three-sigma limits for constant exposure", () => {
    // ubar = 300/1200 = 0.25; sigma = sqrt(0.25/100) = 0.05;
    // limits = 0.25 +/- 0.15 = 0.10 and 0.40.
    const analysis = analyseControlChart(
      "u",
      p(Array.from({ length: 12 }, () => [25, 100] as [number, number])),
    );
    expect(analysis.limits.centreLine).toBeCloseTo(0.25, 12);
    expect(analysis.limits.sigma?.[0]).toBeCloseTo(0.05, 12);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.4, 12);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(0.1, 12);
  });

  it("steps the limits when exposure varies", () => {
    // ubar = 750/3000 = 0.25.
    //   n = 100: sigma = 0.05  -> 0.10 and 0.40
    //   n = 400: sigma = 0.025 -> 0.175 and 0.325
    const rows: Array<[number, number]> = [
      [25, 100], [25, 100], [25, 100], [25, 100], [25, 100], [25, 100],
      [100, 400], [100, 400], [100, 400], [100, 400], [100, 400], [100, 400],
    ];
    const analysis = analyseControlChart("u", p(rows));
    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.4, 12);
    expect(analysis.limits.upper?.[6]).toBeCloseTo(0.325, 12);
    expect(analysis.limits.lower?.[6]).toBeCloseTo(0.175, 12);
  });

  it("clamps the lower limit at zero", () => {
    // ubar = 0.01, sigma = sqrt(0.01/100) = 0.01, 3 sigma = 0.03 > ubar.
    const analysis = analyseControlChart(
      "u",
      p(Array.from({ length: 12 }, () => [1, 100] as [number, number])),
    );
    expect(analysis.limits.lower?.[0]).toBe(0);
  });
});

describe("XmR — individuals and moving range", () => {
  // Alternating 10 and 12: mean = 11, every moving range = 2, so mRbar = 2.
  // Limits = 11 +/- 2.660 * 2 = 11 +/- 5.32 = 5.68 and 16.32.
  const values = [10, 12, 10, 12, 10, 12, 10, 12, 10, 12, 10, 12];

  it("centres on the mean with limits at 2.660 times the average moving range", () => {
    const analysis = analyseControlChart("xmr", plain(values));
    expect(analysis.limits.centreLine).toBe(11);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(16.32, 12);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(5.68, 12);
  });

  it("reports sigma consistent with its own limits", () => {
    // Sigma is one third of the limit distance, so Western Electric zones
    // agree exactly with the limits rather than differing in the fourth
    // significant figure because of the published rounding of 2.660.
    const analysis = analyseControlChart("xmr", plain(values));
    const sigma = analysis.limits.sigma?.[0] ?? 0;
    expect(analysis.limits.centreLine + 3 * sigma).toBeCloseTo(
      analysis.limits.upper?.[0] ?? 0,
      12,
    );
  });

  it("computes the accompanying moving range chart", () => {
    // mRbar = 2; UCL = D4 * mRbar = 3.267 * 2 = 6.534; LCL = 0 by convention.
    const mr = movingRangeChart(plain(values));
    expect(mr.ranges).toHaveLength(values.length - 1);
    expect(mr.centreLine).toBe(2);
    expect(mr.upper).toBeCloseTo(6.534, 12);
    expect(mr.lower).toBe(0);
  });

  it("handles a flat series without producing meaningless limits", () => {
    const analysis = analyseControlChart("xmr", plain(Array.from({ length: 12 }, () => 7)));
    expect(analysis.limits.centreLine).toBe(7);
    expect(analysis.limits.upper?.[0]).toBe(7);
    expect(analysis.violations).toHaveLength(0);
  });
});

describe("a frozen baseline centre line drives the limits too", () => {
  /**
   * Regression test. Freezing the centre line while computing sigma from the
   * whole series produces a chart whose line and limits describe different
   * periods — worse than not offering the option, because it looks right.
   */
  it("computes p chart sigma from the frozen value, not the pooled one", () => {
    // Pooled pbar would be 0.5. Frozen at 0.2 with n = 100, sigma must be
    // sqrt(0.2 * 0.8 / 100) = 0.04, giving limits of 0.08 and 0.32 — the same
    // arithmetic as the constant-denominator case above.
    const rows = Array.from({ length: 12 }, () => [50, 100] as [number, number]);
    const analysis = analyseControlChart("p", p(rows), { centreLine: 0.2 });

    expect(analysis.limits.centreLine).toBeCloseTo(0.2, 12);
    expect(analysis.limits.sigma?.[0]).toBeCloseTo(0.04, 12);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.32, 12);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(0.08, 12);
  });

  it("computes u chart sigma from the frozen value, not the pooled one", () => {
    // Pooled ubar would be 1.0. Frozen at 0.25 with n = 100, sigma must be
    // sqrt(0.25 / 100) = 0.05, giving limits of 0.10 and 0.40.
    const rows = Array.from({ length: 12 }, () => [100, 100] as [number, number]);
    const analysis = analyseControlChart("u", p(rows), { centreLine: 0.25 });

    expect(analysis.limits.centreLine).toBeCloseTo(0.25, 12);
    expect(analysis.limits.sigma?.[0]).toBeCloseTo(0.05, 12);
    expect(analysis.limits.upper?.[0]).toBeCloseTo(0.4, 12);
    expect(analysis.limits.lower?.[0]).toBeCloseTo(0.1, 12);
  });
});

describe("guard rails", () => {
  it("refuses a p chart without a denominator, and says what to use instead", () => {
    expect(() => analyseControlChart("p", plain([1, 2, 3]))).toThrow(
      /needs a numerator and a denominator.*Use an XmR chart/s,
    );
  });

  it("refuses a u chart without a denominator", () => {
    expect(() => analyseControlChart("u", plain([1, 2, 3]))).toThrow(/needs a numerator/);
  });

  it("warns that limits from a short series are provisional", () => {
    const analysis = analyseControlChart("c", plain([16, 14, 18, 16]));
    expect(analysis.notes.join(" ")).toMatch(/fewer than about 12 subgroups are unstable/);
  });

  it("handles an empty series", () => {
    const analysis = analyseControlChart("c", []);
    expect(analysis.notes).toContain("No data points.");
    expect(analysis.violations).toHaveLength(0);
  });
});
