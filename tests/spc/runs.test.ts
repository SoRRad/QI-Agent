import { describe, expect, it } from "vitest";
import { RUNS_TAIL_ALPHA, runDistribution, runsCriticalValues } from "@/lib/spc";

/**
 * Critical values for the number of runs.
 *
 * SOURCE, stated precisely because docs/VALIDATION.md is what answers a
 * program director who challenges a chart:
 *
 *   Perla RJ, Provost LP, Murray SK. "The run chart: a simple analytical tool
 *   for learning from variation in healthcare processes." BMJ Quality & Safety
 *   2011;20(1):46-51. Table 1.
 *
 *   which presents critical values of the exact run distribution tabulated in
 *
 *   Swed FS, Eisenhart C. "Tables for testing randomness of grouping in a
 *   sequence of alternatives." Annals of Mathematical Statistics
 *   1943;14(1):66-87.
 *
 * The engine COMPUTES these values from the exact distribution rather than
 * transcribing the printed table. The fixtures below are the published values
 * that were independently corroborated, and they are the real test: a
 * derivation that reproduces eight separate published rows is not
 * coincidentally correct.
 *
 * See docs/VALIDATION.md for the two rows flagged for a spot-check against
 * the committee's printed copy.
 */

/** Published rows corroborated independently of the computation. */
const PUBLISHED: ReadonlyArray<[useful: number, lower: number, upper: number]> = [
  [10, 3, 9],
  [14, 4, 12],
  [16, 5, 13],
  [24, 8, 18],
  [30, 11, 21],
  [40, 15, 27],
  [50, 19, 33],
  [60, 24, 38],
];

describe("runsCriticalValues against published values", () => {
  for (const [useful, lower, upper] of PUBLISHED) {
    it(`n = ${useful} gives lower ${lower} and upper ${upper}`, () => {
      expect(runsCriticalValues(useful)).toEqual({ lower, upper });
    });
  }
});

describe("the exact run distribution", () => {
  it("is a probability distribution", () => {
    for (const [n1, n2] of [
      [5, 5],
      [6, 6],
      [12, 12],
      [7, 9],
    ] as const) {
      const pmf = runDistribution(n1, n2);
      const total = [...pmf.values()].reduce((a, b) => a + b, 0);
      expect(total, `n1=${n1} n2=${n2}`).toBeCloseTo(1, 10);
      for (const p of pmf.values()) expect(p).toBeGreaterThan(0);
    }
  });

  it("matches the hand-computable smallest case", () => {
    // n1 = n2 = 1: the two arrangements AB and BA both have 2 runs, so
    // P(R = 2) = 1.
    const pmf = runDistribution(1, 1);
    expect(pmf.get(2)).toBeCloseTo(1, 12);
    expect(pmf.size).toBe(1);

    // n1 = n2 = 2: C(4,2) = 6 arrangements — AABB, BBAA (2 runs); ABBA, BAAB,
    // AABA... enumerated exactly: P(R=2) = 2/6, P(R=3) = 2/6, P(R=4) = 2/6.
    const pmf2 = runDistribution(2, 2);
    expect(pmf2.get(2)).toBeCloseTo(2 / 6, 12);
    expect(pmf2.get(3)).toBeCloseTo(2 / 6, 12);
    expect(pmf2.get(4)).toBeCloseTo(2 / 6, 12);
  });

  it("puts no more than alpha in each tail, and would exceed it one step further in", () => {
    // This is the definition of a critical value, asserted directly rather
    // than through the table: it is what makes the derivation checkable
    // without a printed page.
    for (const useful of [10, 12, 16, 20, 24, 30, 40, 50]) {
      const critical = runsCriticalValues(useful);
      expect(critical).not.toBeNull();
      const { lower, upper } = critical as { lower: number; upper: number };

      const pmf = runDistribution(Math.floor(useful / 2), Math.ceil(useful / 2));
      const at = (r: number): number => pmf.get(r) ?? 0;
      const sumTo = (r: number): number =>
        [...pmf.keys()].filter((k) => k <= r).reduce((s, k) => s + at(k), 0);
      const sumFrom = (r: number): number =>
        [...pmf.keys()].filter((k) => k >= r).reduce((s, k) => s + at(k), 0);

      // Everything strictly below `lower` is rarer than alpha.
      expect(sumTo(lower - 1), `n=${useful} lower tail`).toBeLessThanOrEqual(RUNS_TAIL_ALPHA);
      // Including `lower` itself would exceed alpha, so it is the boundary.
      expect(sumTo(lower), `n=${useful} lower boundary`).toBeGreaterThan(RUNS_TAIL_ALPHA);

      expect(sumFrom(upper + 1), `n=${useful} upper tail`).toBeLessThanOrEqual(RUNS_TAIL_ALPHA);
      expect(sumFrom(upper), `n=${useful} upper boundary`).toBeGreaterThan(RUNS_TAIL_ALPHA);
    }
  });

  it("widens monotonically as the series lengthens", () => {
    let previousLower = 0;
    let previousUpper = 0;
    for (let n = 10; n <= 60; n += 1) {
      const critical = runsCriticalValues(n);
      expect(critical, `n=${n}`).not.toBeNull();
      const { lower, upper } = critical as { lower: number; upper: number };
      expect(lower, `lower at n=${n}`).toBeGreaterThanOrEqual(previousLower);
      expect(upper, `upper at n=${n}`).toBeGreaterThanOrEqual(previousUpper);
      expect(lower).toBeLessThan(upper);
      previousLower = lower;
      previousUpper = upper;
    }
  });

  it("declines to give critical values for a series too short to test", () => {
    // Below ten useful observations there is no 2.5% tail to speak of, which
    // is part of why the run chart rules need a minimum series length.
    for (const n of [0, 1, 4, 8, 9]) {
      expect(runsCriticalValues(n), `n=${n}`).toBeNull();
    }
  });
});
