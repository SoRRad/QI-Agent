import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { canRead } from "@/lib/auth/scope";
import type { ProjectRecord } from "./facts";

/**
 * Projects whose RESTRICTED material this user may read — data points, PDSA
 * contents — per the sensitivity policy. Tutor mode and devil's advocate work
 * from exactly that material, so they are offered only these projects.
 */
export async function coachableProjects(user: User) {
  const where =
    user.role === "chair"
      ? {}
      : {
          OR: [
            ...(user.programId ? [{ programId: user.programId }] : []),
            ...(user.role === "coach" ? [{ coachId: user.id }] : []),
          ],
        };

  return db.project.findMany({
    where: { ...where, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, programId: true, coachId: true },
  });
}

export class ProjectAccessError extends Error {
  constructor() {
    super("You do not have access to this project's working record.");
    this.name = "ProjectAccessError";
  }
}

/** The project record devil's advocate and the tutor argue from. */
export async function loadProjectRecord(user: User, projectId: string): Promise<ProjectRecord> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      problemStatement: true,
      clinicalOwner: true,
      coachId: true,
      programId: true,
      aimStatements: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          text: true,
          baselineValue: true,
          baselinePeriod: true,
          target: true,
          deadline: true,
          population: true,
        },
      },
      measures: {
        select: {
          name: true,
          type: true,
          _count: { select: { dataPoints: true } },
          definitions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { numerator: true, denominator: true, dataSource: true, cadence: true },
          },
        },
      },
      pdsaCycles: { select: { prediction: true, completedAt: true } },
    },
  });

  if (!project) throw new ProjectAccessError();
  const allowed = canRead(user, "PdsaCycle", undefined, {
    programId: project.programId,
    coachId: project.coachId,
  });
  if (!allowed) throw new ProjectAccessError();

  return {
    title: project.title,
    problemStatement: project.problemStatement,
    clinicalOwner: project.clinicalOwner,
    coachId: project.coachId,
    aim: project.aimStatements[0] ?? null,
    measures: project.measures.map((m) => ({
      name: m.name,
      type: m.type,
      dataPoints: m._count.dataPoints,
      definition: m.definitions[0] ?? null,
    })),
    pdsaCycles: project.pdsaCycles,
  };
}
