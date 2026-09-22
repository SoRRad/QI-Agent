import type { ChartKind } from "@/lib/spc";
import type { Cadence } from "./definitionFields";
import { parseNumber, pointValue, requiredInputs, type ComputedPoint } from "./points";

/**
 * Turning mapped CSV cells (or one manual entry) into data points.
 *
 * The browser runs this for the preview and the server runs it again on
 * submit, from the raw cells, so nothing the browser computed is trusted.
 * Every value is computed by pointValue(); duplicate periods are refused
 * rather than silently overwriting a point already on a chart.
 */

export type InputField = "period" | "numerator" | "denominator" | "value";

export type ColumnMapping = Partial<Record<InputField, number>>;

export interface Cells {
  period: string;
  numerator?: string | undefined;
  denominator?: string | undefined;
  value?: string | undefined;
}

export interface ImportRow {
  /** 1-based row in the source (row 1 is the header). */
  row: number;
  label: string;
  point: ComputedPoint | null;
  error: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NAME_HINTS: Record<InputField, RegExp> = {
  period: /^(period(_start)?|month|period start|start|date|week|quarter|year)$/i,
  numerator: /^(numerator|num|events?|count|cases met|n_met)$/i,
  denominator: /^(denominator|den|exposure|patient[-_ ]?days|eligible|total|n)$/i,
  value: /^(value|measure|result|median|mean)$/i,
};

/** A first guess at the mapping from header names, for the user to confirm. */
export function guessMapping(headers: readonly string[], chartType: ChartKind): ColumnMapping {
  const needed: InputField[] = ["period", ...requiredInputs(chartType)];
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of needed) {
    const index = headers.findIndex((h, i) => !used.has(i) && NAME_HINTS[field].test(h.trim()));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function requiredFields(chartType: ChartKind): InputField[] {
  return ["period", ...requiredInputs(chartType)];
}

/**
 * The label a period is shown with. An ISO date or month from an analyst's
 * extract ("2024-10-01", "2024-10") becomes "Oct 2024" for monthly data,
 * "Q4 2024" for quarterly, "2024" for annual — the form the seeded charts use,
 * and one that is not a calendar date. Anything else is kept as written.
 */
export function periodLabel(raw: string, cadence: Cadence | null): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) {
      if (cadence === "monthly") return `${MONTHS[month - 1]} ${year}`;
      if (cadence === "quarterly") return `Q${Math.ceil(month / 3)} ${year}`;
      if (cadence === "annual") return String(year);
    }
  }
  return text;
}

/** The next period after `label`, for pre-filling manual entry. Null when it cannot tell. */
export function nextPeriodLabel(label: string | undefined, cadence: Cadence | null): string | null {
  if (!label) return null;
  const monthly = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label);
  if (monthly && cadence === "monthly") {
    const m = MONTHS.indexOf(monthly[1] as string);
    if (m < 0) return null;
    const year = Number(monthly[2]) + (m === 11 ? 1 : 0);
    return `${MONTHS[(m + 1) % 12]} ${year}`;
  }
  const quarterly = /^Q([1-4]) (\d{4})$/.exec(label);
  if (quarterly && cadence === "quarterly") {
    const q = Number(quarterly[1]);
    return q === 4 ? `Q1 ${Number(quarterly[2]) + 1}` : `Q${q + 1} ${quarterly[2]}`;
  }
  return null;
}

export function cellsFromRows(rows: readonly string[][], mapping: ColumnMapping): Cells[] {
  const cell = (row: readonly string[], field: InputField) => {
    const index = mapping[field];
    return index === undefined ? undefined : row[index];
  };
  return rows.map((row) => ({
    period: cell(row, "period") ?? "",
    numerator: cell(row, "numerator"),
    denominator: cell(row, "denominator"),
    value: cell(row, "value"),
  }));
}

export const MAX_LABEL_LENGTH = 40;

/**
 * Validates and computes every row. `existingLabels` are the periods already
 * on the chart; a row repeating one, or repeating another row, is an error.
 */
export function importRows(
  cells: readonly Cells[],
  chartType: ChartKind,
  cadence: Cadence | null,
  existingLabels: ReadonlySet<string>,
): ImportRow[] {
  const seen = new Map<string, number>();
  return cells.map((c, i) => {
    const row = i + 2;
    const label = periodLabel(c.period ?? "", cadence);
    const fail = (error: string): ImportRow => ({ row, label, point: null, error });

    if (!label) return fail("No period.");
    if (label.length > MAX_LABEL_LENGTH) return fail(`The period label is longer than ${MAX_LABEL_LENGTH} characters.`);
    const key = label.toLowerCase();
    if ([...existingLabels].some((l) => l.toLowerCase() === key)) return fail(`${label} is already on the chart.`);
    const earlier = seen.get(key);
    if (earlier !== undefined) return fail(`${label} appears twice (also row ${earlier}).`);
    seen.set(key, row);

    const numerator = parseNumber(c.numerator);
    const denominator = parseNumber(c.denominator);
    const value = parseNumber(c.value);
    for (const [name, parsed] of [["numerator", numerator], ["denominator", denominator], ["value", value]] as const) {
      if (Number.isNaN(parsed)) return fail(`The ${name} is not a number.`);
    }

    const result = pointValue(chartType, { numerator, denominator, value });
    return result.ok ? { row, label, point: result.point, error: null } : fail(result.error);
  });
}
