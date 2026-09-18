/**
 * Critical values for the number of runs on a run chart.
 *
 * WHERE THESE NUMBERS COME FROM, precisely — this matters, because this table
 * is what the system relies on when it tells a program director that their
 * data is clustered.
 *
 * The published run chart table (Perla, Provost & Murray, *The run chart: a
 * simple analytical tool for learning from variation in healthcare processes*,
 * BMJ Quality & Safety 2011;20:46-51, Table 1) is itself a presentation of the
 * critical values of the exact distribution of the number of runs in a random
 * arrangement, tabulated by Swed & Eisenhart, *Tables for testing randomness
 * of grouping in a sequence of alternatives*, Annals of Mathematical
 * Statistics 1943;14:66-87.
 *
 * Rather than transcribe the printed table, this module COMPUTES those
 * critical values from the exact distribution, in exact integer arithmetic:
 *
 *   P(R = 2k)     = 2·C(n1-1, k-1)·C(n2-1, k-1) / C(n1+n2, n1)
 *   P(R = 2k + 1) = [C(n1-1, k-1)·C(n2-1, k)
 *                    + C(n1-1, k)·C(n2-1, k-1)] / C(n1+n2, n1)
 *
 * The median splits the useful observations evenly, so n1 = floor(n/2) and
 * n2 = ceil(n/2).
 *
 * The derivation reproduces the published values at n = 10, 14, 16, 24, 30,
 * 40, 50 and 60 — see the fixtures in tests/spc/runs.test.ts. Computing rather
 * than transcribing means the table is auditable and cannot contain a typo.
 *
 * OPEN ITEM: docs/VALIDATION.md records that rows n = 12 and n = 20 should be
 * spot-checked against the committee's printed copy of Perla et al. Table 1.
 */

/** Two-sided alpha is about 5%, i.e. 2.5% in each tail. */
export const RUNS_TAIL_ALPHA = 0.025;

/** Exact binomial coefficient. */
function binomial(n: number, k: number): bigint {
  if (k < 0 || n < 0 || k > n) return 0n;
  const kk = Math.min(k, n - k);
  let result = 1n;
  for (let i = 0n; i < BigInt(kk); i += 1n) {
    result = (result * (BigInt(n) - i)) / (i + 1n);
  }
  return result;
}

/**
 * The exact probability mass function of the number of runs, as a map from
 * run count to probability.
 */
export function runDistribution(n1: number, n2: number): Map<number, number> {
  const total = binomial(n1 + n2, n1);
  const pmf = new Map<number, number>();
  if (total === 0n || n1 < 1 || n2 < 1) return pmf;

  for (let r = 2; r <= n1 + n2; r += 1) {
    let numerator: bigint;
    if (r % 2 === 0) {
      const k = r / 2;
      numerator = 2n * binomial(n1 - 1, k - 1) * binomial(n2 - 1, k - 1);
    } else {
      const k = (r - 1) / 2;
      numerator =
        binomial(n1 - 1, k - 1) * binomial(n2 - 1, k) +
        binomial(n1 - 1, k) * binomial(n2 - 1, k - 1);
    }
    if (numerator > 0n) {
      pmf.set(r, Number(numerator) / Number(total));
    }
  }
  return pmf;
}

export interface RunsCriticalValues {
  /** Fewer runs than this signals special cause. */
  lower: number;
  /** More runs than this signals special cause. */
  upper: number;
}

const cache = new Map<number, RunsCriticalValues | null>();

/**
 * Critical values for `useful` observations, or null where the series is too
 * short for the test to mean anything.
 *
 * Read as: `runs < lower` is too few, `runs > upper` is too many.
 */
export function runsCriticalValues(useful: number): RunsCriticalValues | null {
  const cached = cache.get(useful);
  if (cached !== undefined) return cached;

  const computed = compute(useful);
  cache.set(useful, computed);
  return computed;
}

function compute(useful: number): RunsCriticalValues | null {
  // Below ten useful observations the distribution is too coarse for a 2.5%
  // tail to exist at all, which is one of the reasons the run chart rules
  // need a minimum series length.
  if (useful < 10) return null;

  const n1 = Math.floor(useful / 2);
  const n2 = Math.ceil(useful / 2);
  const pmf = runDistribution(n1, n2);
  if (pmf.size === 0) return null;

  const counts = [...pmf.keys()].sort((a, b) => a - b);
  const first = counts[0];
  const last = counts[counts.length - 1];
  if (first === undefined || last === undefined) return null;

  // The smallest run count whose lower tail exceeds alpha: anything below it
  // is rarer than alpha and therefore signals.
  let lower = first;
  let cumulative = 0;
  for (const r of counts) {
    cumulative += pmf.get(r) ?? 0;
    if (cumulative > RUNS_TAIL_ALPHA) {
      lower = r;
      break;
    }
  }

  let upper = last;
  cumulative = 0;
  for (let i = counts.length - 1; i >= 0; i -= 1) {
    const r = counts[i];
    if (r === undefined) continue;
    cumulative += pmf.get(r) ?? 0;
    if (cumulative > RUNS_TAIL_ALPHA) {
      upper = r;
      break;
    }
  }

  return { lower, upper };
}
