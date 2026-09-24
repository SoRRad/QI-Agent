/**
 * The IRB / QI determination pre-check (§6.5): a branching questionnaire that
 * produces a screening result and a determination-request memo draft.
 *
 * What it will not do:
 *   - Make a determination. Determination is local and belongs to the office
 *     the institution names. The memo says so in its first line.
 *   - State policy. The questions are screening considerations commonly used
 *     to tell improvement work from research, phrased as questions; what the
 *     institution requires comes from its own policy document in the library
 *     (`local-irb-determination`). The memo cites that document by title and
 *     version — or, while it is still a placeholder, says plainly that the
 *     policy is missing and what the institution must supply.
 *   - Guess. An "unsure", or a combination where improvement and research
 *     features pull in both directions, makes the result "ambiguous" and names
 *     the answers responsible, rather than being resolved one way.
 *
 * Pure: the evaluation and the memo are functions of their inputs.
 */

export type YesNoUnsure = "yes" | "no" | "unsure";

export interface Question {
  id: keyof Answers;
  prompt: string;
  help?: string;
  options: ReadonlyArray<readonly [string, string]>;
  /** Asked only when this returns true. */
  showIf?: (answers: Partial<Answers>) => boolean;
}

export interface Answers {
  purpose: "local" | "generalizable" | "both" | "unsure";
  assignment: YesNoUnsure;
  acceptedPractice: YesNoUnsure;
  risk: YesNoUnsure;
  extraData: "yes" | "no";
  extraDataFrom?: "patients" | "staff" | "trainees" | "several";
  identifiableOut: YesNoUnsure;
  funding: "yes" | "no";
  dissemination: "yes" | "no" | "undecided";
}

const YNU = [
  ["yes", "Yes"],
  ["no", "No"],
  ["unsure", "Not sure"],
] as const;

export const QUESTIONS: readonly Question[] = [
  {
    id: "purpose",
    prompt: "What is the project for?",
    options: [
      ["local", "To improve care or a process here"],
      ["generalizable", "To answer a question meant to apply beyond this institution"],
      ["both", "Both"],
      ["unsure", "Not sure"],
    ],
  },
  {
    id: "assignment",
    prompt: "Will patients or staff be randomised, or deliberately given different care, so that groups can be compared?",
    options: YNU,
  },
  {
    id: "acceptedPractice",
    prompt: "Is every change you are testing already accepted practice — guideline-endorsed or established elsewhere — rather than new or experimental?",
    options: YNU,
  },
  {
    id: "risk",
    prompt: "Could any change expose patients to more risk than their usual care?",
    options: YNU,
  },
  {
    id: "extraData",
    prompt: "Will you collect anything beyond what care already records — surveys, interviews, extra tests or observations?",
    options: [
      ["yes", "Yes"],
      ["no", "No"],
    ],
  },
  {
    id: "extraDataFrom",
    prompt: "From whom?",
    options: [
      ["patients", "Patients or families"],
      ["staff", "Staff, about the process"],
      ["trainees", "Residents or fellows, about their education"],
      ["several", "More than one of these"],
    ],
    showIf: (a) => a.extraData === "yes",
  },
  {
    id: "identifiableOut",
    prompt: "Will anyone outside the care team, or outside the institution, receive data that could identify a patient?",
    options: YNU,
  },
  {
    id: "funding",
    prompt: "Is the project funded by a research grant or an outside sponsor?",
    options: [
      ["yes", "Yes"],
      ["no", "No"],
    ],
  },
  {
    id: "dissemination",
    prompt: "Do you plan to present or publish it?",
    options: [
      ["yes", "Yes"],
      ["no", "No"],
      ["undecided", "Not decided"],
    ],
  },
];

export function visibleQuestions(answers: Partial<Answers>): Question[] {
  return QUESTIONS.filter((q) => !q.showIf || q.showIf(answers));
}

/** Validates raw form input against the questions that apply. Returns the answers, or the first unanswered question. */
export function parseIrbAnswers(raw: Record<string, string | undefined>): { ok: true; answers: Answers } | { ok: false; missing: Question } {
  const answers: Partial<Answers> = {};
  for (const q of QUESTIONS) {
    if (q.showIf && !q.showIf(answers)) continue;
    const value = raw[q.id];
    if (!value || !q.options.some(([v]) => v === value)) return { ok: false, missing: q };
    (answers as Record<string, string>)[q.id] = value;
  }
  return { ok: true, answers: answers as Answers };
}

export type ScreenOutcome = "likely_qi" | "likely_research" | "ambiguous";

export const OUTCOME_LABEL: Record<ScreenOutcome, string> = {
  likely_qi: "Looks like quality improvement",
  likely_research: "Looks like research — expect IRB review",
  ambiguous: "Ambiguous — needs a determination, not a guess",
};

export interface Screening {
  outcome: ScreenOutcome;
  /** Features pointing towards research. */
  researchFeatures: string[];
  /** Answers that make the result genuinely uncertain, each saying why. */
  ambiguities: string[];
  /** Features consistent with local improvement work. */
  improvementFeatures: string[];
}

export function screen(a: Answers): Screening {
  const research: string[] = [];
  const ambiguous: string[] = [];
  const improvement: string[] = [];

  if (a.purpose === "local") improvement.push("The purpose is to improve care or a process at this institution.");
  if (a.purpose === "generalizable") research.push("The purpose is to answer a question meant to apply beyond this institution.");
  if (a.purpose === "both") ambiguous.push("The project aims both to improve local care and to produce knowledge that applies elsewhere. Which purpose is primary is the question a determination answers.");
  if (a.purpose === "unsure") ambiguous.push("The purpose was answered “not sure”.");

  if (a.assignment === "yes") research.push("Patients or staff will be randomised or deliberately given different care in order to compare groups.");
  if (a.assignment === "no") improvement.push("Nobody is assigned to different care for comparison.");
  if (a.assignment === "unsure") ambiguous.push("Whether anyone is assigned to different care for comparison was answered “not sure”.");

  if (a.acceptedPractice === "yes") improvement.push("Every change tested is already accepted practice.");
  if (a.acceptedPractice === "no") ambiguous.push("At least one change is new or experimental rather than accepted practice. Testing an unproven change is where improvement and research overlap.");
  if (a.acceptedPractice === "unsure") ambiguous.push("Whether every change is accepted practice was answered “not sure”.");

  if (a.risk === "yes") ambiguous.push("A change could expose patients to more risk than usual care. That needs review whichever category the project falls into.");
  if (a.risk === "no") improvement.push("No change adds risk beyond usual care.");
  if (a.risk === "unsure") ambiguous.push("Added risk to patients was answered “not sure”.");

  if (a.extraData === "no") improvement.push("Only data that care already records will be used.");
  if (a.extraData === "yes") {
    if (a.extraDataFrom === "staff") improvement.push("Extra data comes only from staff, about the process.");
    if (a.extraDataFrom === "patients") ambiguous.push("Extra information will be collected from patients or families beyond routine care.");
    if (a.extraDataFrom === "trainees") ambiguous.push("Residents or fellows will be surveyed or interviewed about their education, which can be educational research in its own right.");
    if (a.extraDataFrom === "several") ambiguous.push("Extra information will be collected from more than one group, including people other than staff.");
  }

  if (a.identifiableOut === "yes") ambiguous.push("Data that could identify a patient will leave the care team or the institution. That needs review for privacy regardless of the category.");
  if (a.identifiableOut === "unsure") ambiguous.push("Whether identifiable data leaves the care team was answered “not sure”.");

  if (a.funding === "yes") research.push("The project is funded by a research grant or an outside sponsor.");

  const outcome: ScreenOutcome = research.length > 0 ? "likely_research" : ambiguous.length > 0 ? "ambiguous" : "likely_qi";
  return { outcome, researchFeatures: research, ambiguities: ambiguous, improvementFeatures: improvement };
}

// ---------------------------------------------------------------- memo

export interface PolicyDoc {
  slug: string;
  title: string;
  version: number;
  updatedAt: Date;
  /** A placeholder still awaiting institutional policy. */
  isLocal: boolean;
  localFieldsRequired: string[];
}

export interface MemoProject {
  title: string;
  program: string;
  lead: string | null;
  coach: string | null;
  aim: string | null;
  measures: Array<{ name: string; dataSource: string | null }>;
  changeIdeas: string[];
  cycles: number;
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export interface Memo {
  text: string;
  /** The policy cited, or null when the memo declares the gap. */
  cited: { slug: string; version: number } | null;
}

export function draftMemo(input: { project: MemoProject; answers: Answers; screening: Screening; policy: PolicyDoc | null; preparedBy: string; date: Date }): Memo {
  const { project: p, answers, screening, policy } = input;
  const usable = policy && !policy.isLocal ? policy : null;
  const office = usable ? "the office named in the local policy cited below" : "the institution's determining office (not yet named in the library — see “Local policy”)";

  const answerLines = visibleQuestions(answers).map((q) => {
    const value = (answers as unknown as Record<string, string>)[q.id];
    const label = q.options.find(([v]) => v === value)?.[1] ?? value;
    return `- ${q.prompt} **${label}.**`;
  });

  const policySection = usable
    ? [
        "## Local policy",
        "",
        `This screening should be read with the institution's policy: **${usable.title}**, version ${usable.version}, updated ${day(usable.updatedAt)} (library: \`/ask/library/${usable.slug}\`). That document, not this memo, says who issues determinations, how to request one, how long it takes, and whether one is needed before data collection begins.`,
      ]
    : [
        "## Local policy — not in the library",
        "",
        `**Gap:** the institution's QI-versus-research determination policy has not been supplied.${policy ? ` The library document “${policy.title}” is a placeholder.` : " There is no determination policy document in the library."} Until it is replaced, this memo cannot say who issues a determination, how to request one, how long it takes, or whether one is needed before data collection begins. Ask your coach or the committee chair, and do not collect data for dissemination on the strength of this screening.`,
        ...(policy && policy.localFieldsRequired.length
          ? ["", "The institution must supply:", ...policy.localFieldsRequired.map((f) => `- ${f}`)]
          : []),
      ];

  const next =
    screening.outcome === "likely_qi"
      ? "Submit this memo with a request for a determination if local policy requires one, or if you intend to present or publish. Record the determination in the project before dissemination."
      : screening.outcome === "likely_research"
        ? "Contact the IRB before collecting data. Work that is research needs review before it starts, and a retrospective determination may not be possible."
        : `Do not resolve the ambiguity yourself. Send this memo to ${office} with the questions below, and wait for a determination before collecting data for dissemination.`;

  const lines = [
    "# QI or research? Screening memo — DRAFT",
    "",
    `**This is a screening, not a determination.** Only ${office} can determine whether this project is quality improvement or human subjects research.`,
    "",
    `- Project: ${p.title}`,
    `- Program: ${p.program}`,
    `- Project lead: ${p.lead ?? "not recorded"}`,
    `- Coach: ${p.coach ?? "not recorded"}`,
    `- Screened: ${day(input.date)}, prepared by ${input.preparedBy}`,
    "",
    "## The project, from its record",
    "",
    `- Aim: ${p.aim ?? "No aim statement recorded yet."}`,
    ...(p.measures.length
      ? [`- Measures: ${p.measures.map((m) => `${m.name}${m.dataSource ? ` (source: ${m.dataSource})` : " (no data source recorded)"}`).join("; ")}`]
      : ["- Measures: none recorded yet."]),
    `- Changes tested: ${p.changeIdeas.length ? p.changeIdeas.join("; ") : "none recorded in the driver diagram yet"}${p.cycles ? `, across ${p.cycles} PDSA ${p.cycles === 1 ? "cycle" : "cycles"}` : ""}.`,
    "",
    "## Screening answers",
    "",
    ...answerLines,
    "",
    `## Screening result: ${OUTCOME_LABEL[screening.outcome]}`,
    "",
    ...(screening.researchFeatures.length ? ["Features that point towards research:", ...screening.researchFeatures.map((r) => `- ${r}`), ""] : []),
    ...(screening.ambiguities.length ? ["Questions a determination needs to settle:", ...screening.ambiguities.map((r) => `- ${r}`), ""] : []),
    ...(screening.improvementFeatures.length ? ["Features consistent with improvement work:", ...screening.improvementFeatures.map((r) => `- ${r}`), ""] : []),
    ...policySection,
    "",
    "## Next step",
    "",
    next,
  ];
  return { text: lines.join("\n"), cited: usable ? { slug: usable.slug, version: usable.version } : null };
}
