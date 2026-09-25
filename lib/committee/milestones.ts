import { z } from "zod";
import raw from "@/content/milestones.json";

/**
 * The milestone mapper's inputs (§6.6): the subcompetency list, and the facts
 * a draft may draw on.
 *
 * The list lives in /content/milestones.json, validated here at load like the
 * venue list. It carries codes, titles and the committee's paraphrase of what
 * each covers — never ACGME level language, because levels are the program
 * director's to assign and the draft must not suggest one.
 *
 * Facts are built from the record in code, each with a key the draft must
 * cite. The record does not say which trainee ran which PDSA cycle, so facts
 * describe the project and the trainee's recorded role in it (lead, handed
 * over, took over, presented); every draft says the evidence is project-level
 * and that the program director confirms the trainee's own contribution.
 */

const fileSchema = z.object({
  note: z.string(),
  lastReviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subcompetencies: z
    .array(
      z.object({
        code: z.string().regex(/^(SBP|PBLI)\d$/),
        domain: z.enum(["Systems-Based Practice", "Practice-Based Learning and Improvement"]),
        title: z.string().min(3),
        covers: z.string().min(20),
      }),
    )
    .min(2),
});

const parsed = fileSchema.parse(raw);

export type Subcompetency = (typeof parsed.subcompetencies)[number];
export const SUBCOMPETENCIES: readonly Subcompetency[] = parsed.subcompetencies;
export const MILESTONES_NOTE = parsed.note;
export const MILESTONES_LAST_REVIEWED = parsed.lastReviewed;

export function subcompetency(code: string): Subcompetency | undefined {
  return SUBCOMPETENCIES.find((s) => s.code === code);
}

/** The words every draft carries until a program director's review is recorded. */
export const DRAFT_LABEL = "DRAFT — requires program director review";

export const PROJECT_LEVEL_CAVEAT =
  "The evidence below describes the project record. The record does not attribute each step to one person, so the program director confirms the resident's own contribution before using any of it.";

export type FactKind = "role" | "aim" | "measures" | "data" | "definition" | "pdsa" | "handoff" | "sustainability" | "safety" | "focus" | "dissemination";

export interface MilestoneFact {
  /** "F1", "F2", … — what a draft cites. */
  key: string;
  kind: FactKind;
  /** A short phrase with no numbers, for the mock and for the page's evidence list. */
  label: string;
  /** The fact in full, copied from the record or the SPC engine. */
  text: string;
}

export interface MilestoneRecord {
  /** The trainee's recorded relation to the project. */
  role: {
    isLead: boolean;
    handedOver: boolean;
    tookOver: boolean;
    presented: string[];
  };
  aim: string | null;
  measures: Array<{
    type: string;
    name: string;
    chart: string;
    points: number;
    reading: string | null;
    reproducible: boolean;
  }>;
  pdsa: Array<{
    number: number;
    plan: string;
    prediction: string | null;
    studyResult: string | null;
    actDecision: string | null;
  }>;
  sustainability: { cadence: string; hasOwner: boolean } | null;
  clerDomainLabel: string | null;
  patientSafety: boolean;
}

const trim = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The keyed facts, in a fixed order. Pure: the same record gives the same keys. */
export function buildFacts(record: MilestoneRecord): MilestoneFact[] {
  const facts: Array<Omit<MilestoneFact, "key">> = [];
  const { role } = record;

  if (role.isLead)
    facts.push({
      kind: "role",
      label: "leads the project",
      text: "The resident is the project's current lead.",
    });
  if (role.tookOver)
    facts.push({
      kind: "handoff",
      label: "took over the project at a written handoff",
      text: "The resident took over the project through a written handoff and accepted it in the system.",
    });
  if (role.handedOver)
    facts.push({
      kind: "handoff",
      label: "handed the project on with a written handoff packet",
      text: "The resident handed the project on with a written handoff packet: current state, open items, data access and next actions.",
    });

  if (record.aim)
    facts.push({
      kind: "aim",
      label: "a written aim statement",
      text: `Aim: ${trim(record.aim)}`,
    });

  if (record.measures.length) {
    const family = [...new Set(record.measures.map((m) => m.type))];
    facts.push({
      kind: "measures",
      label: `a family of measures (${family.join(", ")})`,
      text: `Measures: ${record.measures.map((m) => `${m.type} — ${m.name} (${m.chart})`).join("; ")}.`,
    });
  }
  for (const m of record.measures.filter((x) => x.reading)) {
    facts.push({
      kind: "data",
      label: `a chart of the ${m.type} measure read with SPC rules`,
      text: `${m.name}: ${m.reading}`,
    });
  }
  if (record.measures.some((m) => m.reproducible)) {
    facts.push({
      kind: "definition",
      label: "an operational definition checked for reproducibility",
      text: "At least one measure's operational definition was confirmed reproducible by a second person pulling the same data.",
    });
  }

  const completed = record.pdsa.filter((c) => c.studyResult);
  for (const c of record.pdsa) {
    const parts = [`PDSA cycle ${c.number}: ${trim(c.plan, 160)}`];
    if (c.prediction) parts.push(`predicted: ${trim(c.prediction, 160)}`);
    if (c.studyResult) parts.push(`result: ${trim(c.studyResult, 160)}`);
    if (c.actDecision) parts.push(`decision: ${c.actDecision}`);
    facts.push({
      kind: "pdsa",
      label: c.studyResult ? "a PDSA cycle with its prediction compared against the result" : "a planned PDSA cycle with a recorded prediction",
      text: `${parts.join("; ")}.`,
    });
  }
  if (completed.some((c) => c.actDecision === "adapt" || c.actDecision === "abandon")) {
    facts.push({
      kind: "pdsa",
      label: "changed course after a test did not go as predicted",
      text: "At least one PDSA cycle ended in a decision to adapt or abandon the change, recorded with its result.",
    });
  }

  if (record.sustainability) {
    facts.push({
      kind: "sustainability",
      label: "a sustainability plan with a named owner and review cadence",
      text: `Sustainability plan: a named change owner, the measure continued ${record.sustainability.cadence}, and a named reviewer.`,
    });
  }
  if (record.patientSafety)
    facts.push({
      kind: "safety",
      label: "a project in the patient safety focus area",
      text: "The project's CLER focus area is patient safety.",
    });
  else if (record.clerDomainLabel)
    facts.push({
      kind: "focus",
      label: `a project in the ${record.clerDomainLabel.toLowerCase()} focus area`,
      text: `The project's CLER focus area is ${record.clerDomainLabel.toLowerCase()}.`,
    });

  for (const event of role.presented) {
    facts.push({
      kind: "dissemination",
      label: "presented the work at an institutional event",
      text: `The project was submitted to ${event}, with the resident among the presenters.`,
    });
  }

  return facts.map((f, i) => ({ ...f, key: `F${i + 1}` }));
}

/**
 * Words that assign or imply a milestone level. A draft is evidence for the
 * program director, not a rating: any of these fails the prompt's refine.
 */
export const LEVEL_LANGUAGE =
  /\b(level|levels|novice|advanced beginner|proficient|expert|aspirational|entrustable|entrusted|ready for (?:unsupervised|independent) practice|meets (?:the )?(?:milestone|expectations?)|exceeds)\b/i;

/** Which fact kinds bear on each subcompetency. Used by the mock only; the model decides for itself. */
export const MOCK_KINDS: Record<string, readonly FactKind[]> = {
  SBP1: ["safety"],
  SBP2: ["aim", "measures", "pdsa"],
  SBP3: ["handoff"],
  SBP4: ["sustainability"],
  PBLI1: ["data", "definition"],
  PBLI2: ["pdsa"],
};
