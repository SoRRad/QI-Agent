/**
 * The median, computed exactly.
 *
 * The run chart's centre line is the median rather than the mean because a
 * single extreme point must not move it — the whole question a run chart
 * answers is whether a point is extreme.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median of an empty series is undefined");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  const lower = sorted[mid - 1] as number;
  const upper = sorted[mid] as number;
  return (lower + upper) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("mean of an empty series is undefined");
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Median absolute deviation from the median. Used only to surface
 * astronomical point CANDIDATES for human judgement; it is not a published
 * run chart statistic.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  const centre = median(values);
  return median(values.map((v) => Math.abs(v - centre)));
}
