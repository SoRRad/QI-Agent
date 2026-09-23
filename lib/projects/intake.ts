import { validateAim, type AimValidation } from "@/lib/aim/validate";
import type { MeasureType } from "@/lib/generated/prisma/client";

/**
 * What stands between a draft project and submission, as a pure function.
 *
 * The brief: intake "blocks submission on a missing balancing measure or a
 * missing clinical owner, with an explanation rather than a generic error",
 * and "validates the aim against the five-element standard before submit".
 * Each blocker therefore says what is missing, why the committee needs it,
 * and which step of the wizard fixes it. Warnings are advice; only blockers
 * stop submission.
 */

export const INTAKE_STEPS = ["problem", "aim", "measures", "people", "context", "review"] as const;
export type IntakeStep = (typeof INTAKE_STEPS)[number];

export const STEP_LABELS: Record<IntakeStep, string> = {
  problem: "Problem",
  aim: "Aim",
  measures: "Measures",
  people: "People",
  context: "Context",
  review: "Review",
};

export interface IntakeSnapshot {
  title: string;
  problemStatement: string;
  clinicalOwner: string | null;
  coachId: string | null;
  sponsor: string | null;
  analystContact: string | null;
  clerDomain: string | null;
  equityStratificationPlan: string | null;
  aim: {
    text: string;
    baselineValue: number | null;
    baselinePeriod: string | null;
    target: number | null;
    deadline: Date | null;
    population: string | null;
  } | null;
  measures: Array<{
    name: string;
    type: MeasureType;
    definition: { numerator: string; denominator: string; dataSource: string } | null;
  }>;
}

export interface IntakeIssue {
  id: string;
  step: IntakeStep;
  title: string;
  explanation: string;
}

export interface IntakeReview {
  canSubmit: boolean;
  blockers: IntakeIssue[];
  warnings: IntakeIssue[];
  aim: AimValidation | null;
}

const blank = (s: string | null | undefined) => !s || s.trim().length === 0;

export function reviewIntake(project: IntakeSnapshot): IntakeReview {
  const blockers: IntakeIssue[] = [];
  const warnings: IntakeIssue[] = [];
  const outcome = project.measures.find((m) => m.type === "outcome");

  if (blank(project.title) || blank(project.problemStatement) || project.problemStatement.trim().length < 40) {
    blockers.push({
      id: "problem",
      step: "problem",
      title: "The problem is not described yet",
      explanation:
        "Say what goes wrong, for whom, and how you know — a sentence or two with what you have observed. The committee reviews the problem before the solution, and duplicate detection searches on it.",
    });
  }

  let aim: AimValidation | null = null;
  if (!project.aim || blank(project.aim.text)) {
    blockers.push({
      id: "aim",
      step: "aim",
      title: "There is no aim statement",
      explanation: "Write the aim in step 2. It needs all five elements of the aim statement standard.",
    });
  } else {
    aim = validateAim({ ...project.aim, measure: outcome?.definition ?? null });
    if (!aim.passed) {
      const missing = aim.elements.filter((e) => !e.met);
      blockers.push({
        id: "aim",
        step: "aim",
        title:
          missing.length === 5
            ? "The aim is missing all five elements"
            : `The aim is missing ${missing.length === 1 ? "one element" : `${missing.length} of its five elements`}`,
        explanation: `Missing: ${missing.map((e) => e.label.split(/[,—]/)[0]!.trim().toLowerCase()).join("; ")}. The aim statement check says what each one needs, and the standard in the library has a passing example annotated element by element.`,
      });
    }
  }

  if (!project.measures.some((m) => m.type === "balancing")) {
    blockers.push({
      id: "balancing",
      step: "measures",
      title: "There is no balancing measure",
      explanation:
        "A balancing measure checks that improving one thing has not made something else worse — for example, documentation time rising when summaries are signed sooner, or delayed results when routine labs are cut. Without one the committee cannot tell an improvement from a cost moved somewhere else. Add one in step 3.",
    });
  }

  if (blank(project.clinicalOwner)) {
    blockers.push({
      id: "clinical_owner",
      step: "people",
      title: "There is no clinical owner",
      explanation:
        "Name the clinician who owns the process you are changing — usually a medical or nursing director for the unit or service. They are who keeps a successful change in place after you rotate off; without one, projects that work still revert. Name them in step 4 even if you have not asked them yet; your coach can help you find the right person.",
    });
  }

  if (!outcome) {
    warnings.push({
      id: "outcome",
      step: "measures",
      title: "No outcome measure",
      explanation: "The aim's fifth element is the outcome measure's numerator and denominator. Declare one, or link a library measure.",
    });
  }
  for (const m of project.measures) {
    if (!m.definition) {
      warnings.push({
        id: `definition:${m.name}`,
        step: "measures",
        title: `“${m.name}” has no operational definition`,
        explanation: "Write it from the measure's page in Charts before your first data request, so the next resident can pull the same numbers.",
      });
    }
  }
  if (!project.coachId) {
    warnings.push({ id: "coach", step: "people", title: "No coach yet", explanation: "The committee can assign one at review; say so if you have someone in mind." });
  }
  if (blank(project.equityStratificationPlan)) {
    warnings.push({
      id: "equity",
      step: "context",
      title: "No equity stratification plan",
      explanation: "Say which groups you will stratify the outcome by — for example preferred language or insurance type — so an average improvement cannot hide a widening gap.",
    });
  }
  if (!project.clerDomain) {
    warnings.push({ id: "cler", step: "context", title: "No CLER focus area", explanation: "Pick the one that fits best; it is how the committee reports projects to the GMEC." });
  }

  return { canSubmit: blockers.length === 0, blockers, warnings, aim };
}

/** The first step with a blocker, for "fix this" links. */
export function firstBlockedStep(review: IntakeReview): IntakeStep | null {
  const steps = new Set(review.blockers.map((b) => b.step));
  return INTAKE_STEPS.find((s) => steps.has(s)) ?? null;
}
