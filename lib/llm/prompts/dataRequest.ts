import { z } from "zod";
import { sourceNumbersGuard } from "../guards/sourceNumbers";
import type { PromptDefinition } from "./types";

/**
 * The data request generator's language half. The date range, period count
 * and output columns are computed in lib/charts/dataRequest.ts and shown to
 * the model only so it can refer to them; any number it writes must already
 * appear in what it was given.
 */

export interface DataRequestInput {
  measureName: string;
  chartType: string;
  cadence: string;
  numerator: string;
  denominator: string;
  inclusions: string;
  exclusions: string;
  dataSource: string;
  problemStatement: string | null;
  aimText: string | null;
  rangeText: string;
}

const schema = z.object({
  clinicalQuestion: z.string().min(20).max(300),
  systems: z.array(z.string().min(3).max(200)).min(1).max(5),
  fields: z
    .array(z.object({ name: z.string().min(2).max(80), purpose: z.string().min(3).max(200) }))
    .min(2)
    .max(10),
  filters: z.array(z.string().min(3).max(250)).min(1).max(8),
  questions: z.array(z.string().min(5).max(250)).max(4),
});

export type DataRequestOutput = z.infer<typeof schema>;

export function dataRequestSource(input: DataRequestInput): string {
  return [
    input.measureName,
    input.numerator,
    input.denominator,
    input.inclusions,
    input.exclusions,
    input.dataSource,
    input.problemStatement ?? "",
    input.aimText ?? "",
    input.rangeText,
  ].join("\n");
}

const clause = (s: string) => {
  const t = s.trim().replace(/[.;]+$/, "");
  return t ? t[0]!.toLowerCase() + t.slice(1) : t;
};

export const dataRequestPrompt: PromptDefinition<DataRequestInput, DataRequestOutput> = {
  id: "charts.data_request",
  purpose:
    "Drafts the language parts of a data request an analyst can act on — the clinical question, likely systems, fields and filters — around a date range and output format computed in code.",
  maxTokens: 2_500,
  system: [
    "You write data requests that a hospital data analyst can act on without a meeting. The requester is a resident physician running a quality improvement project.",
    "",
    "You are given the measure's operational definition, the project's problem and aim where there is one, and the date range, which has already been computed.",
    "",
    "Write:",
    "- clinicalQuestion: the clinical question in ONE sentence, in plain language.",
    "- systems: the tables, reports or systems likely to hold the data. Start from the named data source. You do not know this hospital's schema: describe what kind of source is needed (for example, 'the inpatient encounter table with discharge date and service'), and never invent a table name.",
    "- fields: each field the analyst must pull or derive, with why it is needed.",
    "- filters: the inclusions and exclusions translated into filter logic, one per line.",
    "- questions: up to four things the analyst must confirm before running the query — typically which date assigns a case to a period, and how edge cases are handled. An empty list if none.",
    "",
    "Rules:",
    "- Never introduce a number. You may repeat a number that appears in what you were given, exactly as written.",
    "- The output is aggregate counts per period only. Never ask for patient names, record numbers or other identifiers.",
    "- Do not restate the date range or the output columns; the system adds them.",
  ].join("\n"),

  render(input) {
    return [
      `Measure: ${input.measureName}`,
      `Chart type: ${input.chartType}`,
      `Cadence: ${input.cadence}`,
      `Numerator: ${input.numerator}`,
      `Denominator: ${input.denominator}`,
      `Inclusions: ${input.inclusions}`,
      `Exclusions: ${input.exclusions}`,
      `Named data source: ${input.dataSource}`,
      input.problemStatement ? `Problem statement: ${input.problemStatement}` : "Problem statement: none recorded",
      input.aimText ? `Aim: ${input.aimText}` : "Aim: none recorded",
      `Date range (already computed): ${input.rangeText}`,
      "",
      "Write the data request.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const all = [
      output.clinicalQuestion,
      ...output.systems,
      ...output.fields.flatMap((f) => [f.name, f.purpose]),
      ...output.filters,
      ...output.questions,
    ].join("\n");
    const numbers = sourceNumbersGuard(all, dataRequestSource(input));
    if (numbers) return `The request ${numbers}`;
    const sentences = output.clinicalQuestion.trim().split(/(?<=[.?!])\s+/).filter(Boolean);
    if (sentences.length > 1) return "The clinical question must be one sentence.";
    if (/\b(mrn|medical record number|patient name|date of birth|dob)\b/i.test(all)) {
      return "The request asked for a patient identifier. The output is aggregate counts only; remove it.";
    }
    return null;
  },

  mock(input) {
    const numeratorClause = clause(input.numerator);
    const denominatorClause = clause(input.denominator);
    const period = { monthly: "month", weekly: "week", quarterly: "quarter", daily: "day", biweekly: "two-week period", annual: "year" }[input.cadence] ?? "period";
    const counts = input.chartType === "p" || input.chartType === "u";
    return {
      clinicalQuestion: `How has the measure "${input.measureName}" changed over time, period by period, since the team began testing changes?`,
      systems: [
        `${input.dataSource.trim().replace(/[.;]+$/, "")} (the named source)`,
        "Whichever encounter or census table records the population in the denominator and the date each case falls in",
      ],
      fields: [
        { name: "Period", purpose: `The ${period} each case is assigned to` },
        { name: counts ? "Numerator flag" : "Measured value", purpose: `Whether a case meets the numerator: ${numeratorClause}` },
        ...(counts ? [{ name: "Denominator population", purpose: `Identifies ${denominatorClause}` }] : []),
        { name: "Inclusion and exclusion attributes", purpose: "The fields the filters below need" },
      ],
      filters: [`Include: ${clause(input.inclusions)}`, /^none\b/i.test(input.exclusions.trim()) ? "No exclusions" : `Exclude: ${clause(input.exclusions)}`],
      questions: [`Which date assigns a case to a ${period} — for example, admission or discharge?`],
    };
  },
};
