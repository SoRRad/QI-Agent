import { z } from "zod";
import type { SpcAnalysis, RuleName } from "@/lib/spc";
import { numericGuard } from "../guards/numeric";
import type { PromptDefinition } from "./types";

/**
 * Chart interpretation: prose that explains what a chart is showing.
 *
 * The model receives the COMPUTED analysis — rule names, which periods they
 * span, the annotations — never the data series (constraint 1). Every value
 * reaches it as a placeholder key and a display value; it writes prose with
 * placeholders, and the numeric guard rejects any reply containing a number.
 */

export interface InterpretationInput {
  measureName: string;
  /** Unit suffix for display, e.g. "%". */
  unit: string;
  analysis: SpcAnalysis;
  annotations: Array<{ label: string; periodIndex: number | null }>;
}

const RULE_NAMES: Record<RuleName, string> = {
  shift: "shift",
  trend: "trend",
  too_few_runs: "too few runs",
  too_many_runs: "too many runs",
  astronomical_point: "possible astronomical point (a judgement, not a test)",
  point_beyond_limits: "point beyond the control limits",
  we_two_of_three_beyond_2_sigma: "Western Electric: two of three beyond two sigma",
  we_four_of_five_beyond_1_sigma: "Western Electric: four of five beyond one sigma",
  we_eight_on_one_side: "Western Electric: eight on one side",
};

function format(value: number, unit: string): string {
  const digits = unit === "%" ? 1 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${unit}`;
}

/**
 * Builds the placeholder table. Every entry is formatted HERE, in TypeScript,
 * from the analysis — this function is the only source of the numbers that
 * appear in an interpretation.
 */
export function interpretationValues(input: InterpretationInput): Record<string, string> {
  const { analysis, unit } = input;
  const labels = analysis.observations.map((o) => o.label);
  const values: Record<string, string> = {
    measure: input.measureName,
    points: String(analysis.observations.length),
    useful_observations: String(analysis.usefulObservations),
    first_period: labels[0] ?? "",
    last_period: labels[labels.length - 1] ?? "",
    centre_line: format(analysis.limits.centreLine, unit),
  };

  analysis.violations.forEach((violation, i) => {
    const first = violation.pointIndices[0];
    const last = violation.pointIndices[violation.pointIndices.length - 1];
    values[`v${i}_points`] = String(violation.pointIndices.length);
    values[`v${i}_first`] = first !== undefined ? (labels[first] ?? "") : "";
    values[`v${i}_last`] = last !== undefined ? (labels[last] ?? "") : "";
  });

  if (analysis.baseline) {
    values["baseline_points"] = String(analysis.baseline.length);
    values["baseline_first"] = analysis.baseline.firstLabel;
    values["baseline_last"] = analysis.baseline.lastLabel;
  }

  const beyond = analysis.violations.filter((v) => v.rule === "point_beyond_limits").flatMap((v) => v.pointIndices);
  if (beyond.length > 0) {
    values["beyond_limits_points"] = String(new Set(beyond).size);
    values["beyond_limits_first"] = labels[Math.min(...beyond)] ?? "";
    values["beyond_limits_last"] = labels[Math.max(...beyond)] ?? "";
  }

  input.annotations.forEach((annotation, i) => {
    values[`a${i}`] = annotation.label;
    const at = annotation.periodIndex !== null ? labels[annotation.periodIndex - 1] : undefined;
    if (at) values[`a${i}_period`] = at;
  });

  return values;
}

const schema = z.object({
  interpretation: z.string().min(1).max(1200),
});

type Output = z.infer<typeof schema>;

export const chartInterpretationPrompt: PromptDefinition<InterpretationInput, Output> = {
  id: "charts.interpretation",
  purpose:
    "Explains in plain language what a run or control chart is showing, using only the rule results the statistics engine already computed.",
  maxTokens: 2_000,
  system: [
    "You explain statistical process control charts to resident physicians working on quality improvement projects.",
    "",
    "The statistics have already been computed. You are given which rules fired and over which periods. Your job is to say what that means, not to calculate anything.",
    "",
    "Absolute rule: never write a number, in digits or in words. Every value you might mention — a count of points, a period, a centre line, a measure name — has a placeholder in the table you are given. Write the placeholder, exactly as shown, in double braces, and it will be filled in. If there is no placeholder for something, do not mention it.",
    "",
    "Guidance:",
    "- Special cause means the system changed. It does not by itself mean the intervention caused the change; say what the timing of the annotations is consistent with, and no more.",
    "- If no rules fired, say the chart shows only common-cause variation so far, and that on a short series a real improvement often produces no signal yet.",
    "- A possible astronomical point is a prompt to investigate what happened in that period, not a finding.",
    "- Do not use the phrase 'statistically significant'.",
    "- Keep it to three or four sentences. Be brief and concrete; no preamble, no caveats beyond the one about causation.",
  ].join("\n"),

  render(input) {
    const values = interpretationValues(input);
    const rules = input.analysis.violations.map(
      (v, i) => `- ${RULE_NAMES[v.rule]}: {{v${i}_points}} points, from {{v${i}_first}} to {{v${i}_last}}`,
    );
    const annotations = input.annotations.map((a, i) =>
      values[`a${i}_period`] ? `- {{a${i}}} at {{a${i}_period}}` : `- {{a${i}}}`,
    );

    return [
      `Chart type: ${input.analysis.kind === "run" ? "run chart" : `${input.analysis.kind} control chart`}`,
      "",
      "Placeholders you may use (write the key in double braces; the value shown is what will appear):",
      ...Object.entries(values).map(([key, value]) => `- {{${key}}} = ${value}`),
      "",
      "Rules that fired:",
      ...(rules.length > 0 ? rules : ["- none"]),
      "",
      ...(input.analysis.baseline
        ? [
            "Baseline: the centre line (and any limits) were computed from the first {{baseline_points}} points, {{baseline_first}} to {{baseline_last}}, and extended across the later points. Signals after the baseline are changes relative to it.",
            "",
          ]
        : []),
      "Annotations (interventions marked on the chart):",
      ...(annotations.length > 0 ? annotations : ["- none"]),
      "",
      // Engine notes carry digits ("Only 11 points"), so they are summarised
      // rather than passed through.
      ...(input.analysis.notes.length > 0
        ? ["The engine attached a note to this chart (for example, that the series is too short for the rules to apply). Say that the chart's note explains the limitation.", ""]
        : []),
      "Write the interpretation.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const allowed = new Set(Object.keys(interpretationValues(input)));
    const problem = numericGuard(output.interpretation, allowed);
    return problem ? `The interpretation ${problem}` : null;
  },

  mock(input) {
    const { analysis } = input;
    const index = (rule: RuleName) => analysis.violations.findIndex((v) => v.rule === rule);
    const sentences: string[] = [];

    const shift = analysis.violations.map((v, i) => ({ v, i })).filter(({ v }) => v.rule === "shift").at(-1);
    if (shift) {
      sentences.push(
        `{{measure}} shows a shift: {{v${shift.i}_points}} consecutive points on the same side of the centre line, from {{v${shift.i}_first}} to {{v${shift.i}_last}}. That is special cause — the process is behaving differently from before, not varying by chance.`,
      );
    }
    const few = index("too_few_runs");
    if (few >= 0) {
      sentences.push("There are also too few runs, which confirms the points are clustered rather than scattered around the centre line.");
    }
    if (index("point_beyond_limits") >= 0) {
      const frame = analysis.baseline ? " set by the baseline from {{baseline_first}} to {{baseline_last}}" : "";
      sentences.push(
        `{{beyond_limits_points}} points fall outside the control limits${frame}, from {{beyond_limits_first}} to {{beyond_limits_last}}. Each is special cause: the process is no longer behaving as it did.`,
      );
    }
    const we = analysis.violations.findIndex((v) => v.rule.startsWith("we_"));
    if (we >= 0) {
      sentences.push(
        `The Western Electric rules also find a pattern from {{v${we}_first}} to {{v${we}_last}}: points clustered on one side of the centre line without crossing a limit.`,
      );
    }
    if (input.annotations.length > 0 && sentences.length > 0) {
      sentences.push(
        "The change lines up with {{a0}}, which is consistent with that intervention being responsible, though the timing alone does not prove it.",
      );
    }
    if (sentences.length === 0) {
      sentences.push(
        "{{measure}} shows only common-cause variation so far. On a short series a real improvement often produces no signal yet, so keep plotting and annotate each change.",
      );
    }
    return { interpretation: sentences.join(" ") };
  },
};
