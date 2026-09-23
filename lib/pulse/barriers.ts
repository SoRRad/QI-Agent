import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { BarrierStatus, EscalationTarget, User } from "@/lib/generated/prisma/client";
import { PulseNotFoundError, PulsePermissionError, PulseRuleError } from "./errors";
import { checkTransition, MIN_DECISION_LENGTH, STATUS_LABEL } from "./lifecycle";
import { findVerbatim, VERBATIM_WORDS } from "./verbatim";

/**
 * The barriers log (§6.4). A theme becomes a Barrier that moves through
 * raised → at GMEC → decided → closed, with the decision recorded.
 *
 * The chair creates and edits barriers. The chair or the barrier's owner
 * moves it through its lifecycle. Every save checks that no theme label or
 * summary repeats a respondent's words, whoever wrote it.
 */

export const TARGETS: readonly EscalationTarget[] = ["committee", "gmec", "program"];

function requireChair(user: User): void {
  if (user.role !== "chair") throw new PulsePermissionError("Only the chair creates and edits barriers.");
}

export interface BarrierText {
  label: string;
  summary: string;
}

function checkText(text: BarrierText): BarrierText {
  const label = text.label.trim();
  const summary = text.summary.trim();
  if (label.length < 4 || label.length > 80) throw new PulseRuleError("Give the theme a short label, up to 80 characters.");
  if (summary.length < 30 || summary.length > 600) throw new PulseRuleError("Summarise the theme in two or three sentences, up to 600 characters.");
  return { label, summary };
}

/** Refuses text that repeats a respondent's words. */
function checkParaphrased(text: BarrierText, responses: ReadonlyArray<{ barrierText: string | null }>): void {
  const hit = findVerbatim([text.label, text.summary], responses.map((r) => r.barrierText ?? ""));
  if (hit) {
    throw new PulseRuleError(
      `The theme repeats a respondent's words (“${hit.run}”). Themes are read across programs, so they paraphrase: no run of ${VERBATIM_WORDS} or more words from any response.`,
    );
  }
}

async function unthemed(responseIds: readonly string[]) {
  const ids = [...new Set(responseIds)];
  if (ids.length === 0) throw new PulseRuleError("Choose at least one response for this theme.");
  const responses = await db.pulseResponse.findMany({
    where: { id: { in: ids } },
    select: { id: true, barrierText: true, quarter: true, _count: { select: { barriers: true } } },
  });
  if (responses.length !== ids.length) throw new PulseNotFoundError("Some of those responses could not be found.");
  if (responses.some((r) => !r.barrierText)) throw new PulseRuleError("Only responses with free text can be themed.");
  if (responses.some((r) => r._count.barriers > 0)) throw new PulseRuleError("Some of those responses are already in a barrier.");
  return responses;
}

export async function createBarrier(
  user: User,
  input: BarrierText & { escalationTarget: EscalationTarget; responseIds: string[] },
): Promise<string> {
  requireChair(user);
  const text = checkText(input);
  const responses = await unthemed(input.responseIds);
  checkParaphrased(text, responses);
  const quarters = [...new Set(responses.map((r) => r.quarter))].sort();
  const barrier = await db.barrier.create({
    data: {
      themeLabel: text.label,
      summary: text.summary,
      escalationTarget: input.escalationTarget,
      count: responses.length,
      quarter: quarters.at(-1) ?? null,
      ownerId: user.id,
      pulseResponses: { connect: responses.map((r) => ({ id: r.id })) },
    },
  });
  await audit({ userId: user.id, action: "barrier.created", entity: "Barrier", entityId: barrier.id, metadata: { responses: responses.length } });
  return barrier.id;
}

async function openBarrier(barrierId: string) {
  const barrier = await db.barrier.findUnique({
    where: { id: barrierId },
    include: { pulseResponses: { select: { barrierText: true } } },
  });
  if (!barrier) throw new PulseNotFoundError("That barrier could not be found.");
  return barrier;
}

export async function addResponses(user: User, barrierId: string, responseIds: string[]): Promise<void> {
  requireChair(user);
  const barrier = await openBarrier(barrierId);
  if (barrier.status === "closed") throw new PulseRuleError("A closed barrier takes no new responses. If the problem has come back, raise a new barrier.");
  const responses = await unthemed(responseIds);
  checkParaphrased({ label: barrier.themeLabel, summary: barrier.summary }, responses);
  await db.barrier.update({
    where: { id: barrierId },
    data: { count: { increment: responses.length }, pulseResponses: { connect: responses.map((r) => ({ id: r.id })) } },
  });
  await audit({ userId: user.id, action: "barrier.updated", entity: "Barrier", entityId: barrierId, metadata: { change: "responses_added", responses: responses.length } });
}

export async function updateBarrier(
  user: User,
  barrierId: string,
  input: BarrierText & { escalationTarget: EscalationTarget; ownerId: string | null },
): Promise<void> {
  requireChair(user);
  const barrier = await openBarrier(barrierId);
  if (barrier.status === "closed") throw new PulseRuleError("A closed barrier is part of the record and is not edited.");
  const text = checkText(input);
  checkParaphrased(text, barrier.pulseResponses);
  if (input.ownerId) {
    const owner = await db.user.findUnique({ where: { id: input.ownerId }, select: { role: true, active: true } });
    if (!owner?.active || owner.role === "trainee") throw new PulseRuleError("A barrier is owned by the chair or a coach.");
  }
  if (barrier.status !== "raised" && barrier.escalationTarget === "gmec" && input.escalationTarget !== "gmec") {
    throw new PulseRuleError("This barrier has already gone to GMEC, so its escalation target stays GMEC.");
  }
  await db.barrier.update({
    where: { id: barrierId },
    data: { themeLabel: text.label, summary: text.summary, escalationTarget: input.escalationTarget, ownerId: input.ownerId },
  });
  await audit({ userId: user.id, action: "barrier.updated", entity: "Barrier", entityId: barrierId, metadata: { change: "edited" } });
}

export async function transitionBarrier(
  user: User,
  barrierId: string,
  input: { to: BarrierStatus; decision: string | null; whatChanged: string | null },
): Promise<void> {
  const barrier = await openBarrier(barrierId);
  if (user.role !== "chair" && barrier.ownerId !== user.id) {
    throw new PulsePermissionError("The chair or the barrier's owner moves it along.");
  }
  const decision = input.decision?.trim() || barrier.decision;
  const whatChanged = input.whatChanged?.trim() || barrier.whatChanged;
  const problem = checkTransition({ from: barrier.status, to: input.to, target: barrier.escalationTarget, decision, whatChanged });
  if (problem) throw new PulseRuleError(problem);

  const now = new Date();
  await db.barrier.update({
    where: { id: barrierId },
    data: {
      status: input.to,
      // Taking a barrier to GMEC escalates it there, whatever it was first aimed at.
      ...(input.to === "at_gmec" ? { atGmecAt: now, escalationTarget: "gmec" as const } : {}),
      ...(input.to === "decided" ? { decidedAt: now, decision } : {}),
      ...(input.to === "closed" ? { closedAt: now, decision, whatChanged } : {}),
    },
  });
  await audit({
    userId: user.id,
    action: "barrier.status_changed",
    entity: "Barrier",
    entityId: barrierId,
    metadata: { from: barrier.status, to: input.to },
  });
}

export { MIN_DECISION_LENGTH, STATUS_LABEL };

export async function listBarriers(status?: BarrierStatus) {
  return db.barrier.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { raisedAt: "desc" }],
    select: {
      id: true,
      themeLabel: true,
      summary: true,
      status: true,
      escalationTarget: true,
      count: true,
      quarter: true,
      raisedAt: true,
      atGmecAt: true,
      decidedAt: true,
      closedAt: true,
      decision: true,
      whatChanged: true,
      owner: { select: { id: true, name: true } },
    },
  });
}
