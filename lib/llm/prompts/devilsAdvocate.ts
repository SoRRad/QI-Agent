import { z } from "zod";
import type { ProjectFacts } from "@/lib/projects/facts";
import { factValues } from "@/lib/projects/facts";
import { numericGuard } from "../guards/numeric";
import type { PromptDefinition } from "./types";

/**
 * Devil's advocate: argues, specifically, why a project will fail, and how to
 * prevent each failure. Ranked most serious first.
 *
 * It argues from facts computed in lib/projects/facts.ts. Any number it
 * mentions — points so far, months left, points expected by the deadline —
 * is a placeholder, under the numeric guard, because "the effect is too small
 * to detect in time" is exactly the kind of calculation a model must not do.
 */

export interface DevilsAdvocateInput {
  facts: ProjectFacts;
  problemStatement: string;
  aimText: string | null;
}

export const RISK_CATEGORIES = [
  "no_clinical_owner",
  "data_unavailable",
  "effect_too_small",
  "no_balancing_measure",
  "aim_incomplete",
  "untestable_at_trainee_scale",
  "no_prediction",
  "sustainability",
  "other",
] as const;

const schema = z.object({
  risks: z
    .array(
      z.object({
        category: z.enum(RISK_CATEGORIES),
        title: z.string().min(1).max(120),
        argument: z.string().min(1).max(700),
        mitigation: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(7),
});

export type DevilsAdvocateOutput = z.infer<typeof schema>;

const yesNo = (value: boolean) => (value ? "yes" : "NO");

export const devilsAdvocatePrompt: PromptDefinition<DevilsAdvocateInput, DevilsAdvocateOutput> = {
  id: "ask.devils_advocate",
  purpose:
    "Argues, specifically and from the project's own record, why a QI project is likely to fail, with a mitigation for each risk, most serious first.",
  maxTokens: 4_000,
  system: [
    "You are the devil's advocate on a graduate medical education quality improvement committee. Your job is to argue, specifically, why a trainee's project will fail — so that it doesn't.",
    "",
    "Argue from the project record you are given, not from generalities. The failure modes that actually end trainee projects are: the data never arrives; nobody with authority owns the change; the intervention cannot be tested at the scale a trainee controls; the effect is too small to detect with the data points available before the deadline; there is no balancing measure; the aim is not specific enough to succeed or fail against; cycles run without a prediction; the change evaporates when the trainee rotates off.",
    "",
    "For each risk: a short title, the argument in two or three sentences grounded in this project's record, and one concrete mitigation the trainee can act on this month. Rank them most serious first. Include only risks the record supports; do not pad the list.",
    "",
    "Absolute rule: never write a number, in digits or in words. Where you need one — points collected, months left, points expected by the deadline — use the placeholder from the table, in double braces, exactly as shown. It will be filled in with the computed value.",
  ].join("\n"),

  render({ facts, problemStatement, aimText }) {
    const values = factValues(facts);
    return [
      "Placeholders you may use:",
      ...Object.entries(values).map(([key, value]) => `- {{${key}}} = ${value}`),
      "",
      "Project record:",
      `- Problem statement: ${problemStatement}`,
      `- Aim statement: ${aimText ?? "(none written)"}`,
      `- Aim elements missing: ${facts.aim.missing.length > 0 ? facts.aim.missing.join(", ") : "none"}`,
      `- Named clinical owner: ${yesNo(facts.hasClinicalOwner)}`,
      `- Assigned faculty coach: ${yesNo(facts.hasCoach)}`,
      `- Outcome measure defined: ${yesNo(facts.hasOutcomeMeasure)}`,
      `- Process measure defined: ${yesNo(facts.hasProcessMeasure)}`,
      `- Balancing measure defined: ${yesNo(facts.hasBalancingMeasure)}`,
      `- Data source identified for the outcome measure: ${yesNo(facts.dataSourceIdentified)}`,
      `- Outcome data points collected: {{points_so_far}}`,
      `- Months to the aim deadline: ${facts.monthsToDeadline !== null ? "{{months_to_deadline}}" : "no deadline set"}`,
      `- Outcome points expected by the deadline at the measure's cadence: ${facts.pointsByDeadline !== null ? "{{points_by_deadline}}" : "cannot be estimated"}`,
      `- Points the run chart rules need: {{minimum_points}}`,
      `- PDSA cycles logged: {{cycles}}, of which without a written prediction: {{cycles_missing_prediction}}`,
      "",
      "Argue why this project will fail.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const allowed = new Set(Object.keys(factValues(input.facts)));
    for (const risk of output.risks) {
      for (const text of [risk.title, risk.argument, risk.mitigation]) {
        const problem = numericGuard(text, allowed);
        if (problem) return `A risk ${problem}`;
      }
    }
    return null;
  },

  mock({ facts }) {
    const risks: DevilsAdvocateOutput["risks"] = [];

    if (!facts.hasClinicalOwner) {
      risks.push({
        category: "no_clinical_owner",
        title: "Nobody with authority owns the change",
        argument:
          "The record names no clinical owner. Trainee projects without one stall at the first change that needs someone else's permission — an order set, a workflow, a staffing pattern — and end when the trainee rotates off.",
        mitigation:
          "Before anything else, ask the unit's medical director or nurse manager to be named as clinical owner, and put their name in the project record.",
      });
    }
    if (!facts.dataSourceIdentified || facts.outcomePoints === 0) {
      risks.push({
        category: "data_unavailable",
        title: "The data may never arrive",
        argument:
          "There are {{points_so_far}} outcome data points, and no confirmed source for the outcome measure. Waiting on a report is the single most common reason trainee projects stall; without data there is no baseline and nothing to plot.",
        mitigation:
          "Use the data request generator to write a specification an analyst can act on, send it this week, and meanwhile collect a small manual sample so the baseline is not hostage to the report.",
      });
    }
    if (facts.pointsByDeadline !== null && facts.pointsByDeadline < facts.minimumPoints) {
      risks.push({
        category: "effect_too_small",
        title: "Not enough data points before the deadline",
        argument:
          "At the measure's cadence, the project will have about {{points_by_deadline}} outcome points by the deadline, fewer than the {{minimum_points}} the run chart rules need. A real improvement could produce no detectable signal in time.",
        mitigation:
          "Measure more often — weekly instead of monthly — or move the deadline, and add a process measure that responds within days so each cycle can be judged quickly.",
      });
    } else if (facts.monthsToDeadline === null) {
      risks.push({
        category: "effect_too_small",
        title: "No deadline, so no way to know if there is time",
        argument:
          "Without a deadline it cannot be judged whether enough data points will exist to detect a change. Projects without one drift until the trainee rotates off.",
        mitigation: "Set a calendar deadline in the aim, then check the chart will have enough points by then.",
      });
    }
    if (!facts.hasBalancingMeasure) {
      risks.push({
        category: "no_balancing_measure",
        title: "No balancing measure, so it can only report good news",
        argument:
          "The project has no balancing measure. Reviewers distrust a project that could not have detected harm, and intake will not accept it.",
        mitigation:
          "Name the most plausible harm this change could cause — extra documentation time, delayed discharges, a missed abnormal result — and define it as a balancing measure.",
      });
    }
    if (facts.aim.missing.length > 0) {
      risks.push({
        category: "aim_incomplete",
        title: "The aim cannot be succeeded or failed against",
        argument:
          "The aim is missing {{aim_elements_missing}} of the required elements. An aim without a number, a baseline, a population and a date lets any outcome be read as success.",
        mitigation: "Work through the missing elements with the tutor, then rewrite the aim as a new version.",
      });
    }
    if (facts.pdsaCycles === 0) {
      risks.push({
        category: "untestable_at_trainee_scale",
        title: "No small test has been defined",
        argument:
          "No PDSA cycle has been logged. Projects that begin with a full-scale change cannot be diagnosed when it fails, because too many things differed at once.",
        mitigation: "Design the smallest test that could change your mind — one team, one week — and write the prediction first.",
      });
    }
    if (facts.cyclesMissingPrediction > 0) {
      risks.push({
        category: "no_prediction",
        title: "Cycles without a prediction teach nothing",
        argument:
          "{{cycles_missing_prediction}} cycles have no written prediction. Without one, whatever happens will seem consistent with the theory, and the cycle cannot be marked done.",
        mitigation: "Write each prediction as a number before the cycle starts.",
      });
    }
    if (risks.length === 0) {
      risks.push({
        category: "sustainability",
        title: "The change may evaporate when the trainee rotates off",
        argument:
          "The record is strong, which makes sustainability the main risk: improvements that depend on the enthusiasm of one resident tend to fade within months of that resident leaving.",
        mitigation:
          "Write the sustainability plan now — who owns the change afterwards, which measure continues, at what cadence, and who reviews it.",
      });
    }

    return { risks: risks.slice(0, 7) };
  },
};
