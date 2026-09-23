import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { ActDecision, User } from "@/lib/generated/prisma/client";
import { canWorkOn, ProjectNotFoundError, ProjectPermissionError, ProjectRuleError, touchActivity } from "./service";

/**
 * The PDSA cycle log.
 *
 * Two rules make a cycle a test rather than a diary:
 *   1. A cycle cannot be marked done without a prediction. Enforced here with
 *      an explanation, and by a CHECK constraint underneath (migration
 *      hard_guarantees), so no code path can get round it.
 *   2. The prediction is fixed once the Do step is recorded. A prediction
 *      edited after the result is known is not a prediction.
 * A completed cycle is a record and is not edited.
 */

export class PredictionRequiredError extends ProjectRuleError {
  constructor() {
    super(
      "Write the prediction before marking this cycle done. The Study step compares what happened with what you predicted; without a prediction there is nothing to learn from, only a description.",
    );
    this.name = "PredictionRequiredError";
  }
}

async function cycleFor(user: User, cycleId: string) {
  const cycle = await db.pdsaCycle.findUnique({
    where: { id: cycleId },
    include: { project: { select: { id: true, programId: true, coachId: true, status: true } } },
  });
  if (!cycle) throw new ProjectNotFoundError();
  if (!canWorkOn(user, cycle.project)) throw new ProjectPermissionError();
  return cycle;
}

const blank = (s: string | null | undefined) => !s || s.trim().length === 0;

export async function createCycle(
  user: User,
  projectId: string,
  input: { plan: string; prediction: string | null; plannedStart: Date | null; plannedEnd: Date | null },
): Promise<number> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { programId: true, coachId: true, status: true } });
  if (!project) throw new ProjectNotFoundError();
  if (!canWorkOn(user, project)) throw new ProjectPermissionError();
  if (project.status !== "active" && project.status !== "stalled") {
    throw new ProjectRuleError("PDSA cycles are logged once a project is approved and active.");
  }
  const last = await db.pdsaCycle.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
  const number = (last?.number ?? 0) + 1;
  await db.pdsaCycle.create({ data: { projectId, number, ...input } });
  await touchActivity(projectId, user.id);
  return number;
}

export async function updateCycle(
  user: User,
  cycleId: string,
  input: { plan?: string; prediction?: string | null; doAction?: string | null; studyResult?: string | null; actDecision?: ActDecision | null },
): Promise<void> {
  const cycle = await cycleFor(user, cycleId);
  if (cycle.completedAt) throw new ProjectRuleError("This cycle is complete and is kept as a record. Start the next cycle instead.");
  const predictionChanged = input.prediction !== undefined && (input.prediction ?? null) !== (cycle.prediction ?? null);
  if (predictionChanged && !blank(cycle.doAction)) {
    throw new ProjectRuleError(
      "The prediction is fixed once the Do step is recorded. A prediction changed after the test has started is no longer a prediction. If it was wrong, say so in the Study step.",
    );
  }
  await db.pdsaCycle.update({ where: { id: cycleId }, data: input });
  await touchActivity(cycle.projectId, user.id);
}

export async function completeCycle(user: User, cycleId: string): Promise<void> {
  const cycle = await cycleFor(user, cycleId);
  if (cycle.completedAt) return;
  if (blank(cycle.prediction)) throw new PredictionRequiredError();
  if (blank(cycle.studyResult)) {
    throw new ProjectRuleError("Record what happened in the Study step, against the prediction, before marking the cycle done.");
  }
  if (!cycle.actDecision) throw new ProjectRuleError("Choose the Act decision — adopt, adapt or abandon — before marking the cycle done.");
  await db.pdsaCycle.update({ where: { id: cycleId }, data: { completedAt: new Date() } });
  await audit({ userId: user.id, action: "pdsa.completed", entity: "PdsaCycle", entityId: cycleId, metadata: { projectId: cycle.projectId, number: cycle.number } });
  await touchActivity(cycle.projectId, user.id);
}
