import { cache } from "react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canWorkOn } from "./service";

/**
 * The project header, shared by the workspace layout and its tabs. Cached per
 * request, so the layout and a page asking for it cost one query.
 *
 * Fields here are the cross-program layer; restricted material is loaded by
 * each tab after checking `canWork`.
 */
export const loadProjectHeader = cache(async (projectId: string) => {
  const user = await getCurrentUser();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      problemStatement: true,
      status: true,
      programId: true,
      coachId: true,
      ownerId: true,
      cohortYear: true,
      clerDomain: true,
      submittedAt: true,
      approvedAt: true,
      completedAt: true,
      archivedAt: true,
      stalledAt: true,
      outcomeSummary: true,
      endReason: true,
      program: { select: { name: true, specialty: true } },
      owner: { select: { id: true, name: true } },
      coach: { select: { id: true, name: true, email: true } },
    },
  });
  if (!project) return null;
  return { user, project, canWork: canWorkOn(user, project) };
});
