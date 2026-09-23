import { audit } from "@/lib/audit";
import { canRead } from "@/lib/auth/scope";
import { db } from "@/lib/db";
import type { ChartType, ClerDomain, MeasureType, ProjectStatus, User } from "@/lib/generated/prisma/client";
import { recordUsage } from "@/lib/usage";
import { reviewIntake, type IntakeReview, type IntakeSnapshot } from "./intake";

/**
 * Projects: the lifecycle and the intake steps.
 *
 *   draft → submitted → active ⇄ stalled → complete → archived
 *
 * Who may do what:
 *   - the working record (intake, aim, drivers, PDSA, handoff) is edited by
 *     the owning program, the assigned coach and the chair — the same people
 *     the sensitivity policy lets read it;
 *   - approval is the assigned coach or the chair;
 *   - archival is the chair.
 */

export class ProjectNotFoundError extends Error {
  constructor() {
    super("That project does not exist.");
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectPermissionError extends Error {
  constructor(message = "Only the owning program, its coach and the chair can change this project.") {
    super(message);
    this.name = "ProjectPermissionError";
  }
}

/** A rule of the process, explained: not a permission problem and not a bug. */
export class ProjectRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRuleError";
  }
}

export class IntakeBlockedError extends Error {
  readonly review: IntakeReview;
  constructor(review: IntakeReview) {
    super(`Submission is blocked: ${review.blockers.map((b) => b.title.toLowerCase()).join("; ")}.`);
    this.name = "IntakeBlockedError";
    this.review = review;
  }
}

type Scoped = { programId: string; coachId: string | null };

export function canWorkOn(user: User, project: Scoped): boolean {
  return canRead(user, "PdsaCycle", undefined, { programId: project.programId, coachId: project.coachId });
}

async function editable(user: User, projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, programId: true, coachId: true, status: true, ownerId: true, title: true },
  });
  if (!project) throw new ProjectNotFoundError();
  if (!canWorkOn(user, project)) throw new ProjectPermissionError();
  return project;
}

/** The current academic year's cohort: July starts a new one. */
export function cohortYearFor(date: Date): number {
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

async function changeStatus(user: User, projectId: string, from: ProjectStatus, to: ProjectStatus, extra: Record<string, unknown> = {}) {
  await db.project.update({ where: { id: projectId }, data: { status: to, ...extra } });
  await audit({ userId: user.id, action: "project.status_changed", entity: "Project", entityId: projectId, metadata: { from, to } });
}

// ---------------------------------------------------------------- intake

export async function createDraft(user: User, input: { title: string; problemStatement: string }): Promise<string> {
  if (!user.programId) throw new ProjectRuleError("Your account is not attached to a program yet, so a project cannot be filed under one. Ask the chair.");
  const project = await db.project.create({
    data: {
      title: input.title,
      problemStatement: input.problemStatement,
      programId: user.programId,
      ownerId: user.role === "trainee" ? user.id : null,
      cohortYear: cohortYearFor(new Date()),
      status: "draft",
    },
  });
  return project.id;
}

const DRAFT_ONLY = "This part of intake can only change while the project is a draft.";

export async function updateProblem(user: User, projectId: string, input: { title: string; problemStatement: string }) {
  const project = await editable(user, projectId);
  if (project.status !== "draft") throw new ProjectRuleError(DRAFT_ONLY);
  await db.project.update({ where: { id: projectId }, data: input });
}

export interface AimFields {
  text: string;
  baselineValue: number | null;
  baselineUnit: string | null;
  baselinePeriod: string | null;
  target: number | null;
  targetUnit: string | null;
  deadline: Date | null;
  population: string | null;
}

/** Aims are append-only: every save is the next version, at any status. */
export async function saveAim(user: User, projectId: string, aim: AimFields): Promise<number> {
  await editable(user, projectId);
  const latest = await db.aimStatement.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  const same =
    latest &&
    latest.text === aim.text &&
    latest.baselineValue === aim.baselineValue &&
    latest.baselineUnit === aim.baselineUnit &&
    latest.baselinePeriod === aim.baselinePeriod &&
    latest.target === aim.target &&
    latest.targetUnit === aim.targetUnit &&
    (latest.deadline?.getTime() ?? null) === (aim.deadline?.getTime() ?? null) &&
    latest.population === aim.population;
  if (same) return latest.version;
  const version = (latest?.version ?? 0) + 1;
  await db.aimStatement.create({ data: { projectId, version, ...aim, authorId: user.id } });
  await audit({ userId: user.id, action: "aim.version_created", entity: "Project", entityId: projectId, metadata: { version } });
  return version;
}

export async function addMeasure(
  user: User,
  projectId: string,
  input: { name: string; type: MeasureType; chartType: ChartType; libraryMeasureId: string | null },
): Promise<string> {
  await editable(user, projectId);
  if (input.libraryMeasureId) {
    // Linking copies the library definition in as this measure's version 1,
    // so the project's chart has a definition of its own and the library
    // link carries any later supersession banner.
    const library = await db.measure.findUnique({
      where: { id: input.libraryMeasureId },
      select: { isLibrary: true, deprecated: true, name: true, chartType: true, definitions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!library?.isLibrary) throw new ProjectRuleError("That is not a library measure.");
    if (library.deprecated) throw new ProjectRuleError("That library definition has been superseded. Choose its replacement.");
    const def = library.definitions[0];
    const measure = await db.measure.create({
      data: {
        projectId,
        name: input.name || library.name,
        type: input.type,
        chartType: library.chartType,
        basedOnId: input.libraryMeasureId,
        ...(def
          ? {
              definitions: {
                create: {
                  version: 1,
                  numerator: def.numerator,
                  denominator: def.denominator,
                  inclusions: def.inclusions,
                  exclusions: def.exclusions,
                  dataSource: def.dataSource,
                  puller: def.puller,
                  cadence: def.cadence,
                  createdById: user.id,
                },
              },
            }
          : {}),
      },
    });
    return measure.id;
  }
  const measure = await db.measure.create({ data: { projectId, name: input.name, type: input.type, chartType: input.chartType } });
  return measure.id;
}

/** Only a measure with no data yet can be removed; a plotted one is a record. */
export async function removeMeasure(user: User, projectId: string, measureId: string) {
  await editable(user, projectId);
  const measure = await db.measure.findFirst({ where: { id: measureId, projectId }, select: { _count: { select: { dataPoints: true } } } });
  if (!measure) throw new ProjectRuleError("That measure is not part of this project.");
  if (measure._count.dataPoints > 0) throw new ProjectRuleError("This measure already has data on its chart, so it stays on the record.");
  await db.measure.delete({ where: { id: measureId } });
}

export async function updatePeople(
  user: User,
  projectId: string,
  input: { clinicalOwner: string | null; coachId: string | null; sponsor: string | null; analystContact: string | null },
) {
  await editable(user, projectId);
  if (input.coachId) {
    const coach = await db.user.findUnique({ where: { id: input.coachId }, select: { role: true, active: true } });
    if (!coach?.active || (coach.role !== "coach" && coach.role !== "chair")) throw new ProjectRuleError("Choose a coach from the list.");
  }
  await db.project.update({ where: { id: projectId }, data: input });
}

export async function updateContext(
  user: User,
  projectId: string,
  input: { clerDomain: ClerDomain | null; equityStratificationPlan: string | null },
) {
  await editable(user, projectId);
  await db.project.update({ where: { id: projectId }, data: input });
}

export async function intakeSnapshot(projectId: string): Promise<IntakeSnapshot> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      title: true,
      problemStatement: true,
      clinicalOwner: true,
      coachId: true,
      sponsor: true,
      analystContact: true,
      clerDomain: true,
      equityStratificationPlan: true,
      aimStatements: { orderBy: { version: "desc" }, take: 1 },
      measures: {
        select: {
          name: true,
          type: true,
          definitions: { orderBy: { version: "desc" }, take: 1, select: { numerator: true, denominator: true, dataSource: true } },
        },
      },
    },
  });
  const aim = p.aimStatements[0];
  return {
    ...p,
    aim: aim
      ? {
          text: aim.text,
          baselineValue: aim.baselineValue,
          baselinePeriod: aim.baselinePeriod,
          target: aim.target,
          deadline: aim.deadline,
          population: aim.population,
        }
      : null,
    measures: p.measures.map((m) => ({ name: m.name, type: m.type, definition: m.definitions[0] ?? null })),
  };
}

export async function submitProject(user: User, projectId: string): Promise<void> {
  const project = await editable(user, projectId);
  if (project.status !== "draft") throw new ProjectRuleError("Only a draft can be submitted.");
  const review = reviewIntake(await intakeSnapshot(projectId));
  if (!review.canSubmit) throw new IntakeBlockedError(review);
  await changeStatus(user, projectId, "draft", "submitted", { submittedAt: new Date() });
  await audit({ userId: user.id, action: "project.submitted", entity: "Project", entityId: projectId });
  await recordUsage("project_submitted", { id: user.id, role: user.role, programId: user.programId }, { entityId: projectId });
}

// ---------------------------------------------------------------- lifecycle

export async function approveProject(user: User, projectId: string): Promise<void> {
  const project = await editable(user, projectId);
  const allowed = user.role === "chair" || (user.role === "coach" && project.coachId === user.id);
  if (!allowed) throw new ProjectPermissionError("A submitted project is approved by its coach or the chair.");
  if (project.status !== "submitted") throw new ProjectRuleError("Only a submitted project can be approved.");
  await changeStatus(user, projectId, "submitted", "active", { approvedAt: new Date(), lastActivityAt: new Date() });
}

/** Sent back for changes: the owner fixes intake and submits again. */
export async function returnToDraft(user: User, projectId: string): Promise<void> {
  const project = await editable(user, projectId);
  const allowed = user.role === "chair" || (user.role === "coach" && project.coachId === user.id);
  if (!allowed) throw new ProjectPermissionError("A submitted project is returned by its coach or the chair.");
  if (project.status !== "submitted") throw new ProjectRuleError("Only a submitted project can be returned.");
  await changeStatus(user, projectId, "submitted", "draft", { submittedAt: null });
}

export interface CompletionInput {
  outcomeSummary: string;
  changeOwner: string;
  continuingMeasureId: string | null;
  cadence: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  reviewer: string;
  notes: string | null;
}

/**
 * Completion prompts the sustainability plan (§6.2): who owns the change now,
 * what measure continues, at what cadence, and who reviews it. It is not
 * optional — a project that "completes" without one has simply stopped.
 */
export async function completeProject(user: User, projectId: string, input: CompletionInput): Promise<void> {
  const project = await editable(user, projectId);
  if (project.status !== "active" && project.status !== "stalled") throw new ProjectRuleError("Only an active project can be completed.");
  if (input.continuingMeasureId) {
    const m = await db.measure.findFirst({ where: { id: input.continuingMeasureId, projectId } });
    if (!m) throw new ProjectRuleError("The continuing measure must be one of this project's measures.");
  }
  await db.$transaction(async (tx) => {
    await tx.sustainabilityPlan.upsert({
      where: { projectId },
      create: {
        projectId,
        changeOwner: input.changeOwner,
        continuingMeasureId: input.continuingMeasureId,
        cadence: input.cadence,
        reviewer: input.reviewer,
        notes: input.notes,
      },
      update: {
        changeOwner: input.changeOwner,
        continuingMeasureId: input.continuingMeasureId,
        cadence: input.cadence,
        reviewer: input.reviewer,
        notes: input.notes,
      },
    });
    await tx.project.update({
      where: { id: projectId },
      data: { status: "complete", completedAt: new Date(), outcomeSummary: input.outcomeSummary, endReason: "Completed.", stalledAt: null, stallReason: null },
    });
  });
  await audit({ userId: user.id, action: "project.status_changed", entity: "Project", entityId: projectId, metadata: { from: project.status, to: "complete" } });
}

/** Archival is the chair's. The reason it ended is what the next cohort reads. */
export async function archiveProject(user: User, projectId: string, input: { endReason: string; outcomeSummary: string | null }): Promise<void> {
  if (user.role !== "chair") throw new ProjectPermissionError("Only the chair archives a project.");
  const project = await db.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) throw new ProjectNotFoundError();
  if (project.status === "archived") throw new ProjectRuleError("This project is already archived.");
  await changeStatus(user, projectId, project.status, "archived", {
    archivedAt: new Date(),
    endReason: input.endReason,
    ...(input.outcomeSummary ? { outcomeSummary: input.outcomeSummary } : {}),
  });
}

/**
 * Recording work on a project: a PDSA entry or a data point. Resets the stall
 * clock, and brings a stalled project back to active — the stall was a
 * statement about inactivity, and there is now activity.
 */
export async function touchActivity(projectId: string, userId: string | null): Promise<void> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project) return;
  await db.project.update({
    where: { id: projectId },
    data: {
      lastActivityAt: new Date(),
      ...(project.status === "stalled" ? { status: "active", stalledAt: null, stallReason: null } : {}),
    },
  });
  if (project.status === "stalled") {
    await audit({ userId, action: "project.status_changed", entity: "Project", entityId: projectId, metadata: { from: "stalled", to: "active", reason: "activity" } });
  }
}
