import { WE_EIGHT_ON_ONE_SIDE } from "./constants";
import type { Violation } from "./types";

/**
 * Western Electric supplementary rules, evaluated against per-point sigma so
 * that they work correctly on p and u charts with stepped limits.
 *
 * These are OFF by default. Applying all of them alongside the run chart
 * rules inflates false signals on the short series trainee projects actually
 * produce, and a chart that signals constantly teaches people to ignore
 * signals.
 *
 * The basic rule — a point beyond the limits — is not here: it is the control
 * chart's defining signal rather than a supplementary test, and is always
 * evaluated.
 */
export function westernElectricViolations(
  values: readonly number[],
  centreLine: number,
  sigma: readonly number[],
): Violation[] {
  return [
    ...kOfN(values, centreLine, sigma, 2, 3, 2, "we_two_of_three_beyond_2_sigma"),
    ...kOfN(values, centreLine, sigma, 4, 5, 1, "we_four_of_five_beyond_1_sigma"),
    ...eightOnOneSide(values, centreLine),
  ];
}

/**
 * "k of the last n points beyond m sigma on the same side."
 *
 * Windows overlap, so identical contributing point sets are reported once.
 */
function kOfN(
  values: readonly number[],
  centreLine: number,
  sigma: readonly number[],
  k: number,
  windowSize: number,
  sigmaMultiple: number,
  rule: "we_two_of_three_beyond_2_sigma" | "we_four_of_five_beyond_1_sigma",
): Violation[] {
  const seen = new Set<string>();
  const violations: Violation[] = [];

  for (let start = 0; start + windowSize <= values.length; start += 1) {
    for (const side of [1, -1] as const) {
      const contributing: number[] = [];
      for (let i = start; i < start + windowSize; i += 1) {
        const value = values[i];
        const s = sigma[i];
        if (value === undefined || s === undefined || s === 0) continue;
        const distance = (value - centreLine) * side;
        if (distance > sigmaMultiple * s) contributing.push(i);
      }

      if (contributing.length >= k) {
        const key = contributing.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          rule,
          pointIndices: contributing,
          description:
            `Western Electric: ${contributing.length} of ${windowSize} consecutive points more than ${sigmaMultiple} sigma ${side === 1 ? "above" : "below"} the centre line of ${format(centreLine)}. ` +
            `Points clustering near one limit indicate a shift even where none has crossed it.`,
        });
      }
    }
  }

  return violations;
}

/** Eight consecutive points on the same side of the centre line. */
function eightOnOneSide(values: readonly number[], centreLine: number): Violation[] {
  const violations: Violation[] = [];
  let side = 0;
  let group: number[] = [];

  const flush = (): void => {
    if (group.length >= WE_EIGHT_ON_ONE_SIDE) {
      violations.push({
        rule: "we_eight_on_one_side",
        pointIndices: [...group],
        description:
          `Western Electric: ${group.length} consecutive points ${side > 0 ? "above" : "below"} the centre line of ${format(centreLine)}. ` +
          `A sustained run on one side means the process average has moved.`,
      });
    }
    group = [];
  };

  for (const [index, value] of values.entries()) {
    if (value === centreLine) {
      // A point exactly on the centre line neither extends nor breaks the run.
      continue;
    }
    const next = value > centreLine ? 1 : -1;
    if (next !== side) {
      flush();
      side = next;
    }
    group.push(index);
  }
  flush();

  return violations;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
