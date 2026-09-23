import { validateAim, type AimValidation } from "@/lib/aim/validate";
import { MINIMUM_RUN_CHART_POINTS } from "@/lib/spc";
import type { Cadence, MeasureType } from "@/lib/generated/prisma/client";

/**
 * What a project's record says about its chances, computed deterministically.
 *
 * Devil's advocate argues from these facts; it does not work them out. "The
 * effect is too small to detect in the time available" is a calculation —
 * points so far, points still to come before the deadline, the minimum the
 * run chart rules need — so it is done here and handed to the model as
 * placeholders, under the same numeric guard as chart interpretation.
 */

export interface ProjectRecord {
  title: string;
  problemStatement: string;
  clinicalOwner: string | null;
  coachId: string | null;
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
    dataPoints: number;
    definition: { numerator: string; denominator: string; dataSource: string; cadence: Cadence } | null;
  }>;
  pdsaCycles: Array<{ prediction: string | null; completedAt: Date | null }>;
}

export interface ProjectFacts {
  title: string;
  hasClinicalOwner: boolean;
  hasCoach: boolean;
  hasOutcomeMeasure: boolean;
  hasProcessMeasure: boolean;
  hasBalancingMeasure: boolean;
  dataSourceIdentified: boolean;
  outcomePoints: number;
  pdsaCycles: number;
  cyclesMissingPrediction: number;
  aim: AimValidation;
  monthsToDeadline: number | null;
  /** Outcome points expected by the deadline at the measure's cadence. */
  pointsByDeadline: number | null;
  minimumPoints: number;
}

const PERIODS_PER_MONTH: Record<Cadence, number> = {
  daily: 30,
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

const UNIDENTIFIED_SOURCE = /not yet|unassigned|requested|unknown|\btbd\b|to be (?:confirmed|determined)|none/i;

export function projectFacts(record: ProjectRecord, now: Date = new Date()): ProjectFacts {
  const outcome = record.measures.find((m) => m.type === "outcome") ?? null;

  const aim = validateAim({
    text: record.aim?.text ?? "",
    baselineValue: record.aim?.baselineValue ?? null,
    baselinePeriod: record.aim?.baselinePeriod ?? null,
    target: record.aim?.target ?? null,
    deadline: record.aim?.deadline ?? null,
    population: record.aim?.population ?? null,
    measure: outcome?.definition ?? null,
  });

  const deadline = record.aim?.deadline ?? null;
  const monthsToDeadline =
    deadline !== null
      ? Math.max(0, (deadline.getUTCFullYear() - now.getUTCFullYear()) * 12 + (deadline.getUTCMonth() - now.getUTCMonth()))
      : null;

  const cadence = outcome?.definition?.cadence ?? null;
  const pointsByDeadline =
    monthsToDeadline !== null && cadence !== null
      ? (outcome?.dataPoints ?? 0) + Math.floor(monthsToDeadline * PERIODS_PER_MONTH[cadence])
      : null;

  return {
    title: record.title,
    hasClinicalOwner: !!record.clinicalOwner?.trim(),
    hasCoach: !!record.coachId,
    hasOutcomeMeasure: !!outcome,
    hasProcessMeasure: record.measures.some((m) => m.type === "process"),
    hasBalancingMeasure: record.measures.some((m) => m.type === "balancing"),
    dataSourceIdentified:
      !!outcome?.definition?.dataSource && !UNIDENTIFIED_SOURCE.test(outcome.definition.dataSource),
    outcomePoints: outcome?.dataPoints ?? 0,
    pdsaCycles: record.pdsaCycles.length,
    cyclesMissingPrediction: record.pdsaCycles.filter((c) => !c.prediction?.trim()).length,
    aim,
    monthsToDeadline,
    pointsByDeadline,
    minimumPoints: MINIMUM_RUN_CHART_POINTS,
  };
}

/** The placeholder table for devil's advocate: every number it may mention. */
export function factValues(facts: ProjectFacts): Record<string, string> {
  const values: Record<string, string> = {
    project: facts.title,
    points_so_far: String(facts.outcomePoints),
    minimum_points: String(facts.minimumPoints),
    cycles: String(facts.pdsaCycles),
    cycles_missing_prediction: String(facts.cyclesMissingPrediction),
    aim_elements_missing: String(facts.aim.missing.length),
  };
  if (facts.monthsToDeadline !== null) values["months_to_deadline"] = String(facts.monthsToDeadline);
  if (facts.pointsByDeadline !== null) values["points_by_deadline"] = String(facts.pointsByDeadline);
  return values;
}
