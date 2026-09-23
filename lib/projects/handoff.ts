import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { sendMail, type MailDependencies } from "@/lib/mail";
import { recordUsage } from "@/lib/usage";
import { canWorkOn, ProjectNotFoundError, ProjectPermissionError, ProjectRuleError } from "./service";

/**
 * The handoff packet (§6.2): what the incoming owner needs when a trainee
 * rotates off — current state, open items, data access, coach contact and the
 * next three actions.
 *
 * "Current state" is computed from the record, not written from memory, so it
 * cannot be rosier than the record. The outgoing owner writes the rest. The
 * packet is mailed through the adapter (ADR-0008) and accepted in the
 * application: an unaccepted handoff older than 14 days is a stall signal
 * (addition C1), and an email is not a record.
 */

export const HANDOFF_ACCEPTANCE_DAYS = 14;

export interface HandoffRecord {
  status: string;
  aim: string | null;
  measures: Array<{ name: string; type: string; points: number; lastPeriod: string | null }>;
  cycles: Array<{ number: number; completed: boolean; hasPrediction: boolean; actDecision: string | null }>;
  lastActivityAt: Date;
}

/** The computed "current state" section, one line per fact. */
export function currentState(record: HandoffRecord, today: Date): string[] {
  const days = Math.floor((today.getTime() - record.lastActivityAt.getTime()) / 86_400_000);
  const done = record.cycles.filter((c) => c.completed);
  const open = record.cycles.filter((c) => !c.completed);
  const lines = [
    `Status: ${record.status}. Last PDSA entry or data point ${days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`}.`,
    record.aim ? `Current aim: ${record.aim}` : "There is no aim statement on record.",
    ...record.measures.map(
      (m) => `${m.type[0]!.toUpperCase()}${m.type.slice(1)} measure "${m.name}": ${m.points === 0 ? "no data points yet" : `${m.points} data point${m.points === 1 ? "" : "s"}, latest ${m.lastPeriod}`}.`,
    ),
    `PDSA: ${done.length} cycle${done.length === 1 ? "" : "s"} complete${done.length ? ` (${done.map((c) => `cycle ${c.number}: ${c.actDecision ?? "no decision"}`).join("; ")})` : ""}.`,
    ...open.map((c) => `Cycle ${c.number} is open${c.hasPrediction ? "" : " and has no prediction yet, so it cannot be closed"}.`),
  ];
  return lines;
}

export function packetText(input: {
  projectTitle: string;
  fromName: string;
  toName: string;
  state: string[];
  openItems: string;
  dataAccessNotes: string;
  coachContact: string | null;
  nextActions: string[];
  link: string;
}): string {
  return [
    `Handoff: ${input.projectTitle}`,
    `From ${input.fromName} to ${input.toName}.`,
    "",
    "CURRENT STATE (from the project record)",
    ...input.state.map((l) => `- ${l}`),
    "",
    "OPEN ITEMS",
    input.openItems,
    "",
    "DATA ACCESS",
    input.dataAccessNotes,
    "",
    "COACH",
    input.coachContact ?? "No coach assigned yet.",
    "",
    "NEXT THREE ACTIONS",
    ...input.nextActions.map((a, i) => `${i + 1}. ${a}`),
    "",
    `Accept the handoff in QI Agent to take over the project: ${input.link}`,
    `An unaccepted handoff is flagged to the committee after ${HANDOFF_ACCEPTANCE_DAYS} days.`,
  ].join("\n");
}

async function handoffRecord(projectId: string): Promise<HandoffRecord & { title: string }> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      title: true,
      status: true,
      lastActivityAt: true,
      aimStatements: { orderBy: { version: "desc" }, take: 1, select: { text: true } },
      measures: {
        select: {
          name: true,
          type: true,
          _count: { select: { dataPoints: true } },
          dataPoints: { orderBy: { periodIndex: "desc" }, take: 1, select: { periodLabel: true } },
        },
      },
      pdsaCycles: { orderBy: { number: "asc" }, select: { number: true, completedAt: true, prediction: true, actDecision: true } },
    },
  });
  return {
    title: p.title,
    status: p.status,
    lastActivityAt: p.lastActivityAt,
    aim: p.aimStatements[0]?.text ?? null,
    measures: p.measures.map((m) => ({ name: m.name, type: m.type, points: m._count.dataPoints, lastPeriod: m.dataPoints[0]?.periodLabel ?? null })),
    cycles: p.pdsaCycles.map((c) => ({ number: c.number, completed: !!c.completedAt, hasPrediction: !!c.prediction?.trim(), actDecision: c.actDecision })),
  };
}

export interface HandoffInput {
  toUserId: string;
  openItems: string;
  dataAccessNotes: string;
  nextActions: [string, string, string];
}

export async function createHandoff(
  user: User,
  projectId: string,
  input: HandoffInput,
  options: { baseUrl: string; today?: Date; mail?: MailDependencies } = { baseUrl: "" },
): Promise<{ id: string; delivered: boolean }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { programId: true, coachId: true, status: true, ownerId: true, coach: { select: { name: true, email: true } } },
  });
  if (!project) throw new ProjectNotFoundError();
  if (!canWorkOn(user, project)) throw new ProjectPermissionError();
  if (project.status === "archived" || project.status === "complete") throw new ProjectRuleError("A finished project has no one to hand over to.");
  const pending = await db.handoff.findFirst({ where: { projectId, acceptedAt: null }, include: { toUser: { select: { name: true } } } });
  if (pending) throw new ProjectRuleError(`A handoff to ${pending.toUser?.name ?? "someone"} is still waiting to be accepted.`);
  const to = await db.user.findUnique({ where: { id: input.toUserId }, select: { id: true, name: true, email: true, active: true } });
  if (!to?.active) throw new ProjectRuleError("Choose who is taking the project over.");
  if (to.id === project.ownerId) throw new ProjectRuleError(`${to.name} already owns this project.`);

  const record = await handoffRecord(projectId);
  const state = currentState(record, options.today ?? new Date());
  const coachContact = project.coach ? `${project.coach.name} (${project.coach.email})` : null;

  const handoff = await db.handoff.create({
    data: {
      projectId,
      fromUserId: user.id,
      toUserId: to.id,
      summary: state.join("\n"),
      openItems: input.openItems,
      dataAccessNotes: input.dataAccessNotes,
      nextActions: input.nextActions,
      coachContact,
    },
  });
  await audit({ userId: user.id, action: "handoff.generated", entity: "Handoff", entityId: handoff.id, metadata: { projectId, toUserId: to.id } });
  await recordUsage("handoff_generated", { id: user.id, role: user.role, programId: user.programId }, { entityId: projectId });

  const mail = await sendMail(
    {
      to: [to.email, ...(project.coach ? [project.coach.email] : [])],
      subject: `Handoff: ${record.title}`,
      text: packetText({
        projectTitle: record.title,
        fromName: user.name,
        toName: to.name,
        state,
        openItems: input.openItems,
        dataAccessNotes: input.dataAccessNotes,
        coachContact,
        nextActions: input.nextActions,
        link: `${options.baseUrl}/projects/${projectId}/handoff`,
      }),
      purpose: "handoff.packet",
      entity: "Handoff",
      entityId: handoff.id,
    },
    options.mail,
  );
  return { id: handoff.id, delivered: mail.delivered };
}

/** The incoming owner accepts in the application; ownership moves with it. */
export async function acceptHandoff(user: User, handoffId: string): Promise<void> {
  const handoff = await db.handoff.findUnique({ where: { id: handoffId }, select: { projectId: true, toUserId: true, acceptedAt: true } });
  if (!handoff) throw new ProjectNotFoundError();
  if (handoff.acceptedAt) return;
  if (handoff.toUserId !== user.id && user.role !== "chair") {
    throw new ProjectPermissionError("Only the person the project is being handed to can accept it.");
  }
  await db.$transaction([
    db.handoff.update({ where: { id: handoffId }, data: { acceptedAt: new Date(), acceptedById: user.id } }),
    db.project.update({ where: { id: handoff.projectId }, data: { ownerId: handoff.toUserId } }),
  ]);
  await audit({ userId: user.id, action: "handoff.accepted", entity: "Handoff", entityId: handoffId, metadata: { projectId: handoff.projectId } });
}
