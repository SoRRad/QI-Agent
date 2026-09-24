/**
 * Read-visibility policy.
 *
 * The boundary is drawn by SENSITIVITY OF THE FIELD, not by program (Q4).
 * Cross-cohort learning is the point of the registry: a Surgery resident must
 * be able to see that Internal Medicine tried this in 2024 and why it ended.
 * What stays inside a program is the material that makes people guarded —
 * their data, their failed cycles, and what they wrote about obstacles.
 *
 * This is one configuration object so the committee can move the boundary
 * without a code change. It is documented in docs/SECURITY.md, which is the
 * page the committee reviews.
 */

import type { Role } from "@/lib/generated/prisma/client";

export type SensitivityTier =
  /** Readable by any authenticated user, in any program. */
  | "cross_program"
  /** Owning program, the project's assigned coach, and the chair. */
  | "owning_program"
  /** Chair only. */
  | "chair_only";

/**
 * Field paths are `model.field`. A `*` field applies to the whole model and is
 * the fallback when no more specific entry exists. More specific wins.
 */
export const SENSITIVITY_POLICY: Readonly<Record<string, SensitivityTier>> = {
  // --- the cross-cohort learning layer -------------------------------------
  "Project.title": "cross_program",
  "Project.problemStatement": "cross_program",
  "Project.status": "cross_program",
  "Project.programId": "cross_program",
  "Project.clerDomain": "cross_program",
  "Project.cohortYear": "cross_program",
  "Project.completedAt": "cross_program",
  "Project.archivedAt": "cross_program",
  "Project.ownerId": "cross_program",
  "Project.coachId": "cross_program",
  // What a project achieved and why it ended is the cross-cohort lesson.
  "Project.outcomeSummary": "cross_program",
  "Project.endReason": "cross_program",
  "AimStatement.*": "cross_program",
  "Measure.*": "cross_program",
  "MeasureDefinition.*": "cross_program",
  "SustainabilityPlan.*": "cross_program",
  "LibraryDoc.*": "cross_program",
  "Barrier.themeLabel": "cross_program",
  "Barrier.summary": "cross_program",
  "Barrier.status": "cross_program",
  "Barrier.decision": "cross_program",
  "Barrier.whatChanged": "cross_program",
  "Barrier.escalationTarget": "cross_program",
  "Barrier.count": "cross_program",
  "Barrier.quarter": "cross_program",
  "Barrier.ownerId": "cross_program",
  "Barrier.raisedAt": "cross_program",
  "Barrier.atGmecAt": "cross_program",
  "Barrier.decidedAt": "cross_program",
  "Barrier.closedAt": "cross_program",
  // The survey itself and the published digest are what every trainee sees.
  "PulseSurvey.*": "cross_program",
  "PulseQuestion.*": "cross_program",
  "PulseDigest.*": "cross_program",
  "Event.*": "cross_program",
  "Program.*": "cross_program",

  // --- restricted to owning program, assigned coach, chair -----------------
  "Project.obstacleNotes": "owning_program",
  "Project.clinicalOwner": "owning_program",
  "Project.sponsor": "owning_program",
  "Project.analystContact": "owning_program",
  "Project.stallReason": "owning_program",
  "Project.equityStratificationPlan": "owning_program",
  "DriverNode.*": "owning_program",
  // Scholarship drafts carry results and the ethics screening: working record.
  "AbstractDraft.*": "owning_program",
  "IrbPrecheck.*": "owning_program",
  "DataPoint.*": "owning_program",
  "Annotation.*": "owning_program",
  "PdsaCycle.*": "owning_program",
  "Handoff.*": "owning_program",
  "MilestoneMap.*": "owning_program",
  "Submission.*": "owning_program",

  // --- chair only ----------------------------------------------------------
  "PulseResponse.respondentName": "chair_only",
  "PulseResponse.barrierText": "chair_only",
  "PulseResponse.*": "chair_only",
  "PulseAnswer.*": "chair_only",
  // Who responded is shown only as a rate by program.
  "PulseParticipation.*": "chair_only",
  "JudgeScore.*": "chair_only",
  "AuditLog.*": "chair_only",
  "KnowledgeGap.*": "chair_only",
  "UsageEvent.*": "chair_only",
  "CurriculumRecord.*": "chair_only",
};

/** Anything not named in the policy is treated as the most restrictive tier. */
export const DEFAULT_TIER: SensitivityTier = "chair_only";

export function tierFor(model: string, field?: string): SensitivityTier {
  if (field) {
    const exact = SENSITIVITY_POLICY[`${model}.${field}`];
    if (exact) return exact;
  }
  return SENSITIVITY_POLICY[`${model}.*`] ?? DEFAULT_TIER;
}

export interface ScopeActor {
  id: string;
  role: Role;
  programId: string | null;
}

/** The record being read, as far as visibility is concerned. */
export interface ResourceContext {
  /** Program that owns the record, when it belongs to one. */
  programId?: string | null;
  /** Coach assigned to the owning project, when there is one. */
  coachId?: string | null;
}

export function canRead(
  actor: ScopeActor,
  model: string,
  field?: string,
  resource: ResourceContext = {},
): boolean {
  const tier = tierFor(model, field);

  if (actor.role === "chair") return true;

  switch (tier) {
    case "cross_program":
      return true;
    case "owning_program": {
      const sameProgram =
        !!actor.programId &&
        !!resource.programId &&
        actor.programId === resource.programId;
      const isAssignedCoach =
        actor.role === "coach" && !!resource.coachId && resource.coachId === actor.id;
      return sameProgram || isAssignedCoach;
    }
    case "chair_only":
      return false;
  }
}

/**
 * Strips fields the actor may not read. Used at the edge of query results so
 * one predicate governs every read path rather than each route re-deciding.
 */
export function redactForActor<T extends Record<string, unknown>>(
  actor: ScopeActor,
  model: string,
  row: T,
  resource: ResourceContext = {},
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(row) as Array<keyof T & string>) {
    if (canRead(actor, model, key, resource)) out[key] = row[key];
  }
  return out;
}
