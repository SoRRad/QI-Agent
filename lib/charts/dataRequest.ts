import type { ChartKind } from "@/lib/spc";
import type { Cadence } from "./definitionFields";

/**
 * The deterministic half of the data request generator.
 *
 * The brief calls stalled data requests "the single largest source of stalled
 * trainee projects". The parts of a request that must be exactly right — the
 * date range, how many periods that is, the output columns — are computed
 * here. The model writes only the parts that need language: the clinical
 * question, which systems are likely involved, the fields and filters.
 *
 * The output is always AGGREGATE: one row per period, counts only. An analyst
 * following this request never produces a file with a patient in it, and the
 * upload that follows never has to refuse one.
 */

export interface MonthRange {
  /** "YYYY-MM" */
  from: string;
  to: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseMonth(value: string): { year: number; month: number } | null {
  const m = MONTH.exec(value.trim());
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** The default request: the last 24 complete months before `today`. */
export function defaultRange(today: Date): MonthRange {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 23, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

export interface ResolvedRange {
  /** "1 October 2024" */
  fromText: string;
  /** "30 September 2026" */
  toText: string;
  months: number;
  periods: number;
  periodName: string;
}

const PERIOD_NAMES: Record<Cadence, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  biweekly: ["two-week period", "two-week periods"],
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
  annual: ["year", "years"],
};

export type RangeResult = { ok: true; range: ResolvedRange } | { ok: false; error: string };

/**
 * Validates and describes a month range: first day of the first month to the
 * last day of the last. Refuses a range that ends after the last complete
 * month (the data does not exist yet) or runs longer than ten years.
 */
export function resolveRange(input: MonthRange, cadence: Cadence, today: Date): RangeResult {
  const a = parseMonth(input.from);
  const b = parseMonth(input.to);
  if (!a || !b) return { ok: false, error: "Choose a start and an end month." };
  const months = (b.year - a.year) * 12 + (b.month - a.month) + 1;
  if (months < 1) return { ok: false, error: "The end month is before the start month." };
  if (months > 120) return { ok: false, error: "Ask for ten years or less; an analyst will not run an open-ended pull." };
  const lastComplete = today.getUTCFullYear() * 12 + today.getUTCMonth() - 1;
  if (b.year * 12 + (b.month - 1) > lastComplete) {
    return { ok: false, error: "End the range at the last complete month; later data does not exist yet." };
  }

  const lastDay = new Date(Date.UTC(b.year, b.month, 0)).getUTCDate();
  const firstDate = new Date(Date.UTC(a.year, a.month - 1, 1));
  const lastDate = new Date(Date.UTC(b.year, b.month - 1, lastDay));
  const days = Math.round((lastDate.getTime() - firstDate.getTime()) / 86_400_000) + 1;

  const periods: Record<Cadence, number> = {
    daily: days,
    weekly: Math.ceil(days / 7),
    biweekly: Math.ceil(days / 14),
    monthly: months,
    quarterly: Math.ceil(months / 3),
    annual: Math.ceil(months / 12),
  };
  const [one, many] = PERIOD_NAMES[cadence];
  const count = periods[cadence];

  return {
    ok: true,
    range: {
      fromText: `1 ${NAMES[a.month - 1]} ${a.year}`,
      toText: `${lastDay} ${NAMES[b.month - 1]} ${b.year}`,
      months,
      periods: count,
      periodName: count === 1 ? one : many,
    },
  };
}

export interface OutputColumn {
  name: string;
  description: string;
}

/** The output file an analyst should return, matched by the CSV upload's column mapping. */
export function outputColumns(chartType: ChartKind, cadence: Cadence): OutputColumn[] {
  const [one] = PERIOD_NAMES[cadence];
  const period: OutputColumn[] = [
    { name: "period_start", description: `First day of the ${one} (YYYY-MM-DD)` },
    { name: "period_end", description: `Last day of the ${one} (YYYY-MM-DD)` },
  ];
  switch (chartType) {
    case "p":
      return [
        ...period,
        { name: "numerator", description: "Count of cases meeting the numerator definition" },
        { name: "denominator", description: "Count of all eligible cases (the denominator)" },
      ];
    case "u":
      return [
        ...period,
        { name: "events", description: "Count of events" },
        { name: "exposure", description: "The area of opportunity, e.g. patient-days" },
      ];
    case "c":
      return [...period, { name: "events", description: "Count of events" }];
    default:
      return [
        ...period,
        { name: "value", description: "The measured value for the period, as the numerator describes it" },
        { name: "cases", description: "How many cases contributed to the value" },
      ];
  }
}

export interface DataRequestDocument {
  measureName: string;
  requestedBy: string;
  clinicalQuestion: string;
  range: ResolvedRange;
  cadence: Cadence;
  columns: OutputColumn[];
  definition: { numerator: string; denominator: string; inclusions: string; exclusions: string; dataSource: string; puller: string };
  systems: string[];
  fields: Array<{ name: string; purpose: string }>;
  filters: string[];
  questions: string[];
}

/** The request as Markdown, for copying into an email or a ticket. */
export function requestMarkdown(doc: DataRequestDocument): string {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  return [
    `# Data request: ${doc.measureName}`,
    "",
    `**Clinical question.** ${doc.clinicalQuestion}`,
    "",
    `**Requested by.** ${doc.requestedBy}`,
    "",
    `**Date range.** ${doc.range.fromText} to ${doc.range.toText}: ${doc.range.periods} ${doc.range.periodName}.`,
    "",
    "## What to return",
    "",
    `One row per ${PERIOD_NAMES[doc.cadence][0]}, as a CSV file with these columns:`,
    "",
    list(doc.columns.map((c) => `\`${c.name}\` — ${c.description}`)),
    "",
    "Aggregate counts only. Please do not include patient-level rows, names, record numbers or encounter dates: the file is uploaded to a system that refuses identifiers.",
    "",
    "## The measure, as defined",
    "",
    list([
      `Numerator: ${doc.definition.numerator}`,
      `Denominator: ${doc.definition.denominator}`,
      `Inclusions: ${doc.definition.inclusions}`,
      `Exclusions: ${doc.definition.exclusions}`,
    ]),
    "",
    "## Where the data probably lives",
    "",
    `Named source: ${doc.definition.dataSource}. Usually pulled by: ${doc.definition.puller}.`,
    "",
    list(doc.systems),
    "",
    "## Fields needed",
    "",
    list(doc.fields.map((f) => `${f.name} — ${f.purpose}`)),
    "",
    "## Filters",
    "",
    list(doc.filters),
    ...(doc.questions.length > 0 ? ["", "## Please confirm before running", "", list(doc.questions)] : []),
    "",
  ].join("\n");
}
