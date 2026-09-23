import { z } from "zod";
import { scanWriteData } from "@/lib/phi/guard";
import { sourceNumbersGuard } from "../guards/sourceNumbers";
import type { PromptDefinition } from "./types";

/**
 * The reproducibility check (brief §6.3): the model restates an operational
 * definition as the data query an analyst would run, in plain language, and
 * the person who wrote the definition confirms it matches what they meant.
 *
 * The value is in the mismatch. A definition that reads clearly to its author
 * often admits two queries — "discharges in the month" by admission date or by
 * discharge date — and the restatement makes the model pick one, visibly.
 * Where it cannot pick, it must say so rather than guess.
 */

export interface RestatementInput {
  measureName: string;
  chartType: string;
  cadence: string;
  numerator: string;
  denominator: string;
  inclusions: string;
  exclusions: string;
  dataSource: string;
  puller: string;
}

const schema = z.object({
  query: z.string().min(40).max(1500),
  ambiguities: z.array(z.string().min(5).max(300)).max(4),
});

export type RestatementOutput = z.infer<typeof schema>;

const RESULT: Record<string, string> = {
  p: "Divide the count by the total for that period.",
  u: "Divide the count by the exposure for that period.",
  c: "The result for the period is the count.",
  run: "The result for the period is the value described in the numerator.",
  xmr: "The result for the period is the value described in the numerator.",
};

const PERIOD: Record<string, string> = {
  daily: "day",
  weekly: "week",
  biweekly: "two-week period",
  monthly: "calendar month",
  quarterly: "quarter",
  annual: "year",
};

/** The text the guard checks numbers against: everything the model was given. */
export function restatementSource(input: RestatementInput): string {
  return [input.measureName, input.numerator, input.denominator, input.inclusions, input.exclusions, input.dataSource].join("\n");
}

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const clause = (s: string) => lower(s.trim().replace(/[.;]+$/, ""));

export const definitionRestatementPrompt: PromptDefinition<RestatementInput, RestatementOutput> = {
  id: "charts.definition_restatement",
  purpose:
    "Restates a measure's operational definition as the plain-language data query an analyst would run, so its author can confirm it means what they intended.",
  maxTokens: 1_500,
  system: [
    "You help resident physicians make their quality improvement measures reproducible.",
    "",
    "You are given an operational definition. Restate it as the data query an analyst would actually run, in plain language, as a short paragraph: for each period, which records to start from, which to keep and which to leave out, what to count, and how the period's result is formed.",
    "",
    "Rules:",
    "- Restate; do not improve. If the definition is vague, your restatement must make one specific reading visible, and you must list the ambiguity separately.",
    "- Never introduce a number. You may repeat a number that appears in the definition (a threshold, a time window) exactly as written; you may not add, round or convert one.",
    "- Do not name any person. Refer to the data source by name, but not to who pulls it.",
    "- No dates, no patient details, no examples of individual cases.",
    "- ambiguities: up to four short questions an analyst would have to ask before running the query. An empty list if there are none.",
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
      `Data source: ${input.dataSource}`,
      "",
      "Restate this as the data query an analyst would run.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const all = [output.query, ...output.ambiguities].join("\n");
    const numbers = sourceNumbersGuard(all, restatementSource(input));
    if (numbers) return `The restatement ${numbers}`;
    // The confirmed restatement is stored as evidence. It is machine-written,
    // so it must pass the PHI scanner with NO flags at all: there is no one to
    // acknowledge a warning on the model's behalf.
    const flags = scanWriteData("MeasureDefinition", { reproducibilityRestatement: all });
    if (flags.length > 0) {
      return `The restatement contained text that looks like it could identify someone (${[...new Set(flags.map((f) => f.message))].join("; ")}). Remove names, dates and identifiers.`;
    }
    return null;
  },

  mock(input) {
    const period = PERIOD[input.cadence] ?? "period";
    const exclusions = /^none\b/i.test(input.exclusions.trim()) ? "Nothing is excluded." : `Leave out ${clause(input.exclusions)}.`;
    const query = [
      `For each ${period}, start from ${clause(input.denominator)}, taken from ${input.dataSource.trim().replace(/[.;]+$/, "")}.`,
      `Keep only ${clause(input.inclusions)}.`,
      exclusions,
      `Count ${clause(input.numerator)}.`,
      RESULT[input.chartType] ?? RESULT["run"],
    ].join(" ");
    return { query, ambiguities: [] };
  },
};
