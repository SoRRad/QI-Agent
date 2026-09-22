import type { ChartKind } from "@/lib/spc";

/**
 * The chart-type advisor: a decision tree, not a model.
 *
 * Which chart fits is a question with a correct answer that depends on four
 * facts about the data — what is being counted, whether it is counts or
 * measurements, whether the denominator (area of opportunity) is constant,
 * and the subgroup size. Those facts are asked for directly and the answer
 * follows from them. A language model may explain the answer afterwards; it
 * never chooses it (brief §6.3). Nothing in this file imports one, and
 * tests/charts/advisor.test.ts asserts that.
 *
 * Source for the branches: Provost & Murray, *The Health Care Data Guide*
 * (2011) — the chart-selection flow and the g and t charts for rare events;
 * Montgomery, *Introduction to Statistical Quality Control* — attribute
 * charts (p, c, u).
 */

export type DataKind = "classification" | "events" | "measurement";

export interface AdvisorAnswers {
  data?: DataKind;
  /** Classification or events: typically zero to two per period? */
  rare?: "yes" | "no";
  /** Classification: roughly the same number of cases each period? */
  constant?: "yes" | "no";
  /** Events: does the opportunity for events (patient-days, admissions) vary? */
  exposure?: "varies" | "constant";
  /** Measurement: one value per period, or several? */
  subgroup?: "one" | "several";
  /** Periods of data available now. */
  history?: "under12" | "12plus";
}

export type AdvisorQuestionId = keyof AdvisorAnswers;

export interface AdvisorOption {
  value: string;
  label: string;
  example: string;
}

export interface AdvisorQuestion {
  id: AdvisorQuestionId;
  prompt: string;
  help: string;
  options: AdvisorOption[];
}

export type RecommendedChart = ChartKind | "xbar_s" | "g" | "t";

export interface Recommendation {
  chart: RecommendedChart;
  name: string;
  /** Whether this studio draws it. */
  supported: boolean;
  /** What to plot in this studio today. */
  useNow: ChartKind;
  /** One sentence per fact that led here, in the order it was asked. */
  reasons: string[];
  caveats: string[];
}

export const QUESTIONS: Record<AdvisorQuestionId, AdvisorQuestion> = {
  data: {
    id: "data",
    prompt: "What are you recording each period?",
    help: "Think about a single case — one patient, one discharge, one order — and what you write down about it.",
    options: [
      {
        value: "classification",
        label: "Whether each case met a criterion",
        example: "Each discharge summary was signed late or on time; each patient did or did not get the bundle.",
      },
      {
        value: "events",
        label: "How many times something happened",
        example: "Falls, lab draws, medication errors — one patient can have several.",
      },
      {
        value: "measurement",
        label: "A measured amount",
        example: "Minutes to antibiotics, length of stay, a pain score, a lab value.",
      },
    ],
  },
  rare: {
    id: "rare",
    prompt: "In a typical period, how many are there?",
    help: "Rare events make monthly counts mostly zeros, and a chart of mostly zeros cannot show improvement.",
    options: [
      { value: "no", label: "Several or more", example: "Dozens of late summaries a month." },
      { value: "yes", label: "Usually none, one or two", example: "Central line infections on one unit." },
    ],
  },
  constant: {
    id: "constant",
    prompt: "Is the number of cases about the same every period?",
    help: "This is the denominator: all the cases that could have met the criterion.",
    options: [
      { value: "no", label: "No, it varies", example: "95 discharges one month, 127 the next." },
      { value: "yes", label: "Yes, roughly constant", example: "Always the same 40 audited charts." },
    ],
  },
  exposure: {
    id: "exposure",
    prompt: "Does the opportunity for the event change from period to period?",
    help: "The area of opportunity: patient-days, admissions, procedures — whatever the events could happen during.",
    options: [
      { value: "varies", label: "Yes, it varies", example: "Patient-days on the ward differ each month." },
      { value: "constant", label: "No, it is about the same", example: "Same unit, same beds, similar census every month." },
    ],
  },
  subgroup: {
    id: "subgroup",
    prompt: "How many measurements do you plot for each period?",
    help: "The subgroup size.",
    options: [
      { value: "one", label: "One value per period", example: "The monthly median minutes, or one measurement per day." },
      { value: "several", label: "Several, kept separately", example: "Every patient's door-to-antibiotic time for the week." },
    ],
  },
  history: {
    id: "history",
    prompt: "How many periods of data do you have now?",
    help: "Control limits computed from fewer than about twelve subgroups are unstable.",
    options: [
      { value: "under12", label: "Fewer than 12", example: "A new project with four months of data." },
      { value: "12plus", label: "12 or more", example: "A year or more of monthly data, or a baseline pulled retrospectively." },
    ],
  },
};

const NAMES: Record<RecommendedChart, string> = {
  run: "Run chart",
  xmr: "XmR chart (individuals and moving range)",
  p: "p chart",
  u: "u chart",
  c: "c chart",
  xbar_s: "X̄ and S chart",
  g: "g chart (cases between events)",
  t: "t chart (time between events)",
};

function valid<K extends AdvisorQuestionId>(id: K, value: unknown): value is NonNullable<AdvisorAnswers[K]> {
  return QUESTIONS[id].options.some((o) => o.value === value);
}

/** Keeps only recognised answers. Unknown keys and values are dropped. */
export function parseAnswers(search: Record<string, string | string[] | undefined>): AdvisorAnswers {
  const answers: AdvisorAnswers = {};
  for (const id of Object.keys(QUESTIONS) as AdvisorQuestionId[]) {
    const raw = search[id];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (valid(id, value)) (answers as Record<string, string>)[id] = value;
  }
  return answers;
}

export type AdvisorStep =
  | { kind: "question"; question: AdvisorQuestion; path: AdvisorQuestionId[] }
  | { kind: "recommendation"; recommendation: Recommendation; path: AdvisorQuestionId[] };

/**
 * The next step for a set of answers. `path` lists the questions that were
 * relevant, in order — answers to questions off the path are ignored, so a
 * changed early answer cannot leave a stale later one steering the result.
 */
export function advise(answers: AdvisorAnswers): AdvisorStep {
  const path: AdvisorQuestionId[] = [];
  const ask = (id: AdvisorQuestionId): AdvisorStep => ({ kind: "question", question: QUESTIONS[id], path });
  const reasons: string[] = [];
  const caveats: string[] = [];

  path.push("data");
  if (!answers.data) return ask("data");

  let chart: RecommendedChart;

  if (answers.data === "classification") {
    reasons.push("Each case either meets the criterion or does not, so you are counting classified units: a proportion.");
    path.push("rare");
    if (!answers.rare) return ask("rare");
    if (answers.rare === "yes") {
      reasons.push("The criterion is rarely met, so monthly proportions would be mostly zero.");
      return done("g", reasons, [
        "A g chart plots the number of cases between each event, so every event is a data point and improvement shows as longer gaps.",
      ]);
    }
    path.push("constant");
    if (!answers.constant) return ask("constant");
    reasons.push(
      answers.constant === "no"
        ? "The number of cases varies, so the limits will step: a month with more cases has narrower natural variation."
        : "The number of cases is roughly constant, so the limits will be nearly flat.",
    );
    chart = "p";
  } else if (answers.data === "events") {
    reasons.push("You are counting events, and one case can have more than one: counts, not proportions.");
    path.push("rare");
    if (!answers.rare) return ask("rare");
    if (answers.rare === "yes") {
      reasons.push("The events are rare, so monthly counts would be mostly zero.");
      return done("t", reasons, [
        "A t chart plots the time between events, so each event is a data point and improvement shows as longer intervals.",
      ]);
    }
    path.push("exposure");
    if (!answers.exposure) return ask("exposure");
    if (answers.exposure === "varies") {
      reasons.push("The opportunity for events varies, so each count is divided by its exposure: a rate.");
      chart = "u";
    } else {
      reasons.push("The opportunity for events is about the same each period, so the raw counts are comparable.");
      caveats.push("If the census or unit changes, switch to a u chart: a c chart would show a busier month as a worse process.");
      chart = "c";
    }
  } else {
    reasons.push("You are recording a measured amount on a continuous scale.");
    path.push("subgroup");
    if (!answers.subgroup) return ask("subgroup");
    if (answers.subgroup === "several") {
      reasons.push("You keep several measurements per period, so each period is a subgroup with its own spread.");
      return done("xbar_s", reasons, [
        "Meanwhile, an XmR chart of each period's average is a reasonable stand-in: its limits come from how the averages vary between periods.",
      ]);
    }
    reasons.push("There is one value per period, so the natural variation is estimated from the moving range between consecutive values.");
    chart = "xmr";
  }

  path.push("history");
  if (!answers.history) return ask("history");
  if (answers.history === "under12") {
    reasons.push("With fewer than 12 periods, control limits would be unstable.");
    caveats.unshift(
      `Start with a run chart now. Its rules need about 12 points, but it plots from the first. Move to the ${NAMES[chart]} once you have 12 or more periods.`,
    );
    return { kind: "recommendation", path, recommendation: { chart, name: NAMES[chart], supported: true, useNow: "run", reasons, caveats } };
  }
  reasons.push("With 12 or more periods there is enough data for stable control limits.");
  return { kind: "recommendation", path, recommendation: { chart, name: NAMES[chart], supported: true, useNow: chart, reasons, caveats } };

  function done(unsupported: "g" | "t" | "xbar_s", why: string[], notes: string[]): AdvisorStep {
    return {
      kind: "recommendation",
      path,
      recommendation: {
        chart: unsupported,
        name: NAMES[unsupported],
        supported: false,
        useNow: unsupported === "xbar_s" ? "xmr" : "run",
        reasons: why,
        caveats: [
          `This studio does not draw a ${NAMES[unsupported]} yet.`,
          ...notes,
          ...(unsupported === "xbar_s" ? [] : ["Meanwhile, a run chart of the same data still shows shifts and trends."]),
        ],
      },
    };
  }
}

/** The query string for a set of answers, keeping only those on the path. */
export function advisorQuery(answers: AdvisorAnswers, path: readonly AdvisorQuestionId[]): string {
  const q = new URLSearchParams();
  for (const id of path) {
    const value = answers[id];
    if (value) q.set(id, value);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function optionLabel(id: AdvisorQuestionId, value: string | undefined): string {
  return QUESTIONS[id].options.find((o) => o.value === value)?.label ?? "";
}
