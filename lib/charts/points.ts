import type { ChartKind } from "@/lib/spc";

/**
 * The value stored with a data point, computed in TypeScript from what the
 * user entered (constraint 1: no number on a chart comes from a model, and no
 * derived number is typed in by hand either).
 *
 *   p    numerator ÷ denominator × 100    (percent; 0 ≤ numerator ≤ denominator)
 *   u    numerator ÷ denominator          (a rate per unit of exposure)
 *   c    the count
 *   run, xmr  the measured value as entered
 *
 * p and u keep the numerator and denominator, because the control chart
 * re-derives the value from them and needs the denominator for its stepped
 * limits.
 */

export interface PointInput {
  numerator?: number | null;
  denominator?: number | null;
  value?: number | null;
}

export interface ComputedPoint {
  value: number;
  numerator: number | null;
  denominator: number | null;
  subgroupSize: number | null;
}

export type PointResult = { ok: true; point: ComputedPoint } | { ok: false; error: string };

/** Which inputs a chart type needs, for forms and column mapping. */
export function requiredInputs(chartType: ChartKind): Array<"numerator" | "denominator" | "value"> {
  switch (chartType) {
    case "p":
    case "u":
      return ["numerator", "denominator"];
    case "c":
      return ["numerator"];
    default:
      return ["value"];
  }
}

export const INPUT_LABELS: Record<ChartKind, Partial<Record<"numerator" | "denominator" | "value", string>>> = {
  p: { numerator: "Numerator (count meeting the definition)", denominator: "Denominator (count eligible)" },
  u: { numerator: "Count of events", denominator: "Exposure (e.g. patient-days)" },
  c: { numerator: "Count of events" },
  run: { value: "Value" },
  xmr: { value: "Value" },
};

const isWhole = (n: number) => Number.isInteger(n) && n >= 0;

export function pointValue(chartType: ChartKind, input: PointInput): PointResult {
  const num = input.numerator ?? null;
  const den = input.denominator ?? null;
  const fail = (error: string): PointResult => ({ ok: false, error });

  switch (chartType) {
    case "p": {
      if (num === null || den === null) return fail("A p chart needs a numerator and a denominator.");
      if (!isWhole(num) || !isWhole(den)) return fail("Numerator and denominator are counts: whole numbers, zero or more.");
      if (den === 0) return fail("The denominator cannot be zero.");
      if (num > den) return fail("The numerator cannot be larger than the denominator in a proportion.");
      return { ok: true, point: { value: (num / den) * 100, numerator: num, denominator: den, subgroupSize: den } };
    }
    case "u": {
      if (num === null || den === null) return fail("A u chart needs a count and an exposure.");
      if (!isWhole(num)) return fail("The count must be a whole number, zero or more.");
      if (!(Number.isFinite(den) && den > 0)) return fail("The exposure must be greater than zero.");
      return { ok: true, point: { value: num / den, numerator: num, denominator: den, subgroupSize: den } };
    }
    case "c": {
      const count = num ?? input.value ?? null;
      if (count === null) return fail("A c chart needs a count.");
      if (!isWhole(count)) return fail("The count must be a whole number, zero or more.");
      return { ok: true, point: { value: count, numerator: count, denominator: null, subgroupSize: null } };
    }
    case "run":
    case "xmr": {
      const value = input.value ?? null;
      if (value === null || !Number.isFinite(value)) return fail("Enter the measured value.");
      return { ok: true, point: { value, numerator: null, denominator: null, subgroupSize: null } };
    }
  }
}

/**
 * Parses a number typed by a person or found in a spreadsheet cell: allows
 * thousands separators and surrounding space, and nothing else. "12%" is
 * rejected rather than guessed at.
 */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim().replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (text === "") return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return Number.NaN;
  return Number(text);
}
