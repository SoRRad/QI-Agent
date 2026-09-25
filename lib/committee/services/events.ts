import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { EventType, User } from "@/lib/generated/prisma/client";
import { quarterOf } from "@/lib/pulse/quarter";
import { buildKit, serialiseKit } from "../eventKit";
import { aggregate, resultsCsv, type ResultRow } from "../judging";
import { RUBRIC, SCORE_MAX, SCORE_MIN, weightedTotal, type RubricScores } from "../rubric";
import { CommitteeAccessError, CommitteeNotFoundError, CommitteeRuleError, requireChair, requireCommittee } from "./access";

/**
 * Events, their kits and after-action notes, and symposium judging (§6.6).
 *
 * The chair creates events, generates kits and assigns judges. Judges are the
 * chair and the coaches; a judge is never assigned a project they coach or
 * lead, and a score is accepted only from an assigned judge (the database
 * enforces the second with a foreign key). The results — every judge's
 * scores and the ranking — are the chair's (Q4: JudgeScore is chair-only).
 */

export const EVENT_TYPES: readonly EventType[] = ["symposium", "committee_meeting", "workshop", "cler_mock"];

export async function listEvents(user: User) {
  requireCommittee(user);
  return db.event.findMany({
    orderBy: { date: "desc" },
    select: {
      id: true,
      title: true,
      type: true,
      date: true,
      quarter: true,
      kitGeneratedAt: true,
      _count: { select: { submissions: true, clerQuestions: true } },
    },
  });
}

export async function createEvent(user: User, input: { title: string; type: string; date: string; agenda: string | null }): Promise<string> {
  requireChair(user, "Creating an event");
  const title = input.title.trim();
  if (title.length < 4 || title.length > 140) throw new CommitteeRuleError("Give the event a title of 4 to 140 characters.");
  if (!EVENT_TYPES.includes(input.type as EventType)) throw new CommitteeRuleError("Choose the kind of event.");
  const date = new Date(`${input.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(date.getTime())) throw new CommitteeRuleError("Give the event's date.");
  const event = await db.event.create({
    data: {
      title,
      type: input.type as EventType,
      date,
      quarter: quarterOf(date),
      agenda: input.agenda?.trim() || null,
    },
    select: { id: true },
  });
  await audit({
    userId: user.id,
    action: "event.created",
    entity: "Event",
    entityId: event.id,
    metadata: { type: input.type },
  });
  return event.id;
}

export async function eventDetail(user: User, eventId: string) {
  requireCommittee(user);
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      submissions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          presenters: true,
          createdAt: true,
          project: {
            select: {
              id: true,
              title: true,
              program: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!event) throw new CommitteeNotFoundError("That event");
  // Stale when a submission arrived after the kit was generated.
  const kitStale = !!event.kitGeneratedAt && event.submissions.some((s) => s.createdAt > event.kitGeneratedAt!);
  return { event, kitStale };
}

export async function generateKit(user: User, eventId: string): Promise<void> {
  requireChair(user, "Generating an event kit");
  const { event } = await eventDetail(user, eventId);
  const sections = buildKit(
    {
      title: event.title ?? "Committee event",
      type: event.type,
      date: event.date,
      quarter: event.quarter,
      agenda: event.agenda,
    },
    event.submissions.map((s) => ({
      title: s.project.title,
      program: s.project.program.name,
      presenters: s.presenters,
    })),
  );
  await db.event.update({
    where: { id: eventId },
    data: { kit: serialiseKit(sections), kitGeneratedAt: new Date() },
  });
  await audit({
    userId: user.id,
    action: "event.kit_generated",
    entity: "Event",
    entityId: eventId,
    metadata: { sections: sections.map((s) => s.id) },
  });
}

export async function saveAfterAction(user: User, eventId: string, note: string): Promise<void> {
  requireChair(user, "The after-action note");
  const text = note.trim();
  if (text.length > 4000) throw new CommitteeRuleError("Keep the after-action note under 4,000 characters.");
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { date: true },
  });
  if (!event) throw new CommitteeNotFoundError("That event");
  await db.event.update({
    where: { id: eventId },
    data: { afterActionNote: text || null },
  });
  await audit({
    userId: user.id,
    action: "event.after_action_saved",
    entity: "Event",
    entityId: eventId,
  });
}

// ------------------------------------------------------------------ judging

async function judges() {
  return db.user.findMany({
    where: { role: { in: ["chair", "coach"] }, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

async function submissionFor(submissionId: string) {
  const s = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      eventId: true,
      project: { select: { title: true, coachId: true, ownerId: true } },
    },
  });
  if (!s) throw new CommitteeNotFoundError("That submission");
  return s;
}

/** Why a judge may not score a submission, or null. */
export function conflictOf(judgeId: string, project: { coachId: string | null; ownerId: string | null }): string | null {
  if (project.coachId === judgeId) return "coaches this project";
  if (project.ownerId === judgeId) return "leads this project";
  return null;
}

export async function judgingBoard(user: User, eventId: string) {
  requireChair(user, "The judging board");
  const [event, pool] = await Promise.all([
    db.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        type: true,
        submissions: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            presenters: true,
            project: {
              select: {
                title: true,
                coachId: true,
                ownerId: true,
                program: { select: { name: true } },
              },
            },
            assignments: {
              orderBy: { createdAt: "asc" },
              select: {
                judgeId: true,
                judge: { select: { name: true } },
                score: { select: { rubricScores: true } },
              },
            },
          },
        },
      },
    }),
    judges(),
  ]);
  if (!event) throw new CommitteeNotFoundError("That event");

  const results: ResultRow[] = aggregate(
    event.submissions.map((s) => ({
      submissionId: s.id,
      title: s.project.title,
      program: s.project.program.name,
      presenters: s.presenters,
      assignedJudges: s.assignments.length,
      scores: s.assignments.flatMap((a) => (a.score ? [a.score.rubricScores as RubricScores] : [])),
    })),
  );

  const submissions = event.submissions.map((s) => ({
    id: s.id,
    title: s.project.title,
    program: s.project.program.name,
    assigned: s.assignments.map((a) => ({
      judgeId: a.judgeId,
      name: a.judge.name,
      scored: !!a.score,
      total: a.score ? weightedTotal(a.score.rubricScores as RubricScores) : null,
    })),
    eligible: pool.filter((j) => !s.assignments.some((a) => a.judgeId === j.id)).map((j) => ({ ...j, conflict: conflictOf(j.id, s.project) })),
  }));

  return { event, submissions, results };
}

export async function assignJudge(user: User, submissionId: string, judgeId: string): Promise<void> {
  requireChair(user, "Assigning judges");
  const s = await submissionFor(submissionId);
  const judge = await db.user.findUnique({
    where: { id: judgeId },
    select: { id: true, name: true, role: true, active: true },
  });
  if (!judge || !judge.active || (judge.role !== "chair" && judge.role !== "coach")) throw new CommitteeRuleError("Judges are the chair and the coaches.");
  const conflict = conflictOf(judge.id, s.project);
  if (conflict) throw new CommitteeRuleError(`${judge.name} ${conflict}, so cannot judge it.`);
  const existing = await db.judgeAssignment.findUnique({
    where: { submissionId_judgeId: { submissionId, judgeId } },
  });
  if (existing) return;
  await db.judgeAssignment.create({ data: { submissionId, judgeId } });
  await audit({
    userId: user.id,
    action: "judging.assigned",
    entity: "Submission",
    entityId: submissionId,
    metadata: { judgeId },
  });
}

export async function unassignJudge(user: User, submissionId: string, judgeId: string): Promise<void> {
  requireChair(user, "Assigning judges");
  const a = await db.judgeAssignment.findUnique({
    where: { submissionId_judgeId: { submissionId, judgeId } },
    select: { score: { select: { submissionId: true } } },
  });
  if (!a) return;
  if (a.score) throw new CommitteeRuleError("That judge has already scored this submission; a scored assignment stays, so the results cannot change silently.");
  await db.judgeAssignment.delete({
    where: { submissionId_judgeId: { submissionId, judgeId } },
  });
  await audit({
    userId: user.id,
    action: "judging.unassigned",
    entity: "Submission",
    entityId: submissionId,
    metadata: { judgeId },
  });
}

/** A judge's own assignments, with their own scores. Never another judge's. */
export async function myAssignments(user: User) {
  requireCommittee(user);
  return db.judgeAssignment.findMany({
    where: { judgeId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      submissionId: true,
      score: { select: { rubricScores: true, updatedAt: true } },
      submission: {
        select: {
          abstract: true,
          presenters: true,
          event: { select: { id: true, title: true, date: true } },
          project: {
            select: {
              id: true,
              title: true,
              program: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

export function parseScores(raw: Record<string, string | undefined>): RubricScores {
  const scores: RubricScores = {};
  for (const c of RUBRIC) {
    const v = Number(raw[c.id]);
    if (!Number.isInteger(v) || v < SCORE_MIN || v > SCORE_MAX) throw new CommitteeRuleError(`Score "${c.label}" from ${SCORE_MIN} to ${SCORE_MAX}.`);
    scores[c.id] = v;
  }
  return scores;
}

export async function submitScore(user: User, submissionId: string, raw: Record<string, string | undefined>): Promise<number> {
  requireCommittee(user);
  const assignment = await db.judgeAssignment.findUnique({
    where: { submissionId_judgeId: { submissionId, judgeId: user.id } },
  });
  if (!assignment) throw new CommitteeAccessError("You can score only the submissions you are assigned to judge.");
  const scores = parseScores(raw);
  await db.judgeScore.upsert({
    where: { submissionId_judgeId: { submissionId, judgeId: user.id } },
    create: { submissionId, judgeId: user.id, rubricScores: scores },
    update: { rubricScores: scores },
  });
  await audit({
    userId: user.id,
    action: "judging.scored",
    entity: "Submission",
    entityId: submissionId,
  });
  return weightedTotal(scores)!;
}

export async function judgingExport(user: User, eventId: string): Promise<{ filename: string; csv: string }> {
  const board = await judgingBoard(user, eventId);
  await audit({
    userId: user.id,
    action: "export.generated",
    entity: "Event",
    entityId: eventId,
    metadata: { kind: "judging_results_csv", rows: board.results.length },
  });
  const slug = (board.event.title ?? "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return { filename: `${slug}-results.csv`, csv: resultsCsv(board.results) };
}
