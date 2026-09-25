import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { suggestCoaches, type CoachCandidate } from "../coaches";
import { CommitteeNotFoundError, CommitteeRuleError, requireChair, requireCommittee } from "./access";

/**
 * Coach matching (§6.6). Coaches are the coach-role users and the chair; load
 * counts the active and stalled projects each coaches now. The chair assigns.
 */

const OPEN = ["submitted", "approved", "active", "stalled"] as const;

async function candidates(): Promise<CoachCandidate[]> {
  const coaches = await db.user.findMany({
    where: { role: { in: ["coach", "chair"] }, active: true },
    select: {
      id: true,
      name: true,
      programId: true,
      expertise: true,
      program: { select: { name: true } },
      _count: {
        select: {
          coachedProjects: { where: { status: { in: ["active", "stalled"] } } },
        },
      },
    },
  });
  return coaches.map((c) => ({
    id: c.id,
    name: c.name,
    programId: c.programId,
    program: c.program?.name ?? null,
    expertise: c.expertise,
    load: c._count.coachedProjects,
  }));
}

export async function coachBoard(user: User) {
  requireCommittee(user);
  const [pool, projects] = await Promise.all([
    candidates(),
    db.project.findMany({
      where: { status: { in: [...OPEN] } },
      orderBy: [{ coachId: { sort: "asc", nulls: "first" } }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        status: true,
        programId: true,
        clerDomain: true,
        coachId: true,
        program: { select: { name: true } },
        coach: { select: { name: true } },
      },
    }),
  ]);
  return {
    coaches: [...pool].sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects.map((p) => ({
      ...p,
      suggestions: suggestCoaches(
        {
          programId: p.programId,
          clerDomain: p.clerDomain,
          currentCoachId: p.coachId,
        },
        pool,
      ).slice(0, 3),
    })),
  };
}

export async function assignCoach(user: User, projectId: string, coachId: string): Promise<void> {
  requireChair(user, "Assigning a coach");
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, coachId: true, ownerId: true },
  });
  if (!project) throw new CommitteeNotFoundError("That project");
  const coach = await db.user.findUnique({
    where: { id: coachId },
    select: { id: true, role: true, active: true },
  });
  if (!coach || !coach.active || (coach.role !== "coach" && coach.role !== "chair")) throw new CommitteeRuleError("Choose a coach or the chair.");
  if (project.coachId === coachId) return;
  await db.project.update({ where: { id: projectId }, data: { coachId } });
  await audit({
    userId: user.id,
    action: "coach.assigned",
    entity: "Project",
    entityId: projectId,
    metadata: { from: project.coachId, to: coachId },
  });
}
