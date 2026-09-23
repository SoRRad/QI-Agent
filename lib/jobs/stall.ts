import { audit } from "@/lib/audit";
import { runDevilsAdvocate } from "@/lib/ask/service";
import { db } from "@/lib/db";
import type { LlmDependencies } from "@/lib/llm";
import { sendMail, type MailDependencies } from "@/lib/mail";
import { HANDOFF_ACCEPTANCE_DAYS } from "@/lib/projects/handoff";

/**
 * Stall detection (§6.2), run nightly through POST /api/jobs/stall (ADR-0001).
 *
 * An active project with no PDSA entry or data point in 42 days flips to
 * `stalled`, and its owner, coach and the chair are told. The notice carries
 * devil's advocate's reading of the project (addition C4), because "stalled"
 * alone tells nobody what to do next.
 *
 * A handoff nobody has accepted in 14 days is a stall SIGNAL (addition C1):
 * the job reports it and the committee's stalled queue lists it, but it does
 * not flip the status. The brief's stall rule is inactivity; a project whose
 * data is still arriving is not stalled, it is at risk.
 *
 * Last activity is recomputed from the rows themselves — the latest PDSA
 * entry and the latest data point — never taken from a field someone could
 * have touched by hand.
 */

export const STALL_DAYS = 42;
const DAY = 86_400_000;

export interface StallInput {
  status: string;
  lastActivity: Date;
}

/** Pure: whether a project stalls today, and the reason in plain language. */
export function stallDecision(project: StallInput, now: Date): { stall: boolean; reason: string | null } {
  if (project.status !== "active") return { stall: false, reason: null };
  const idle = Math.floor((now.getTime() - project.lastActivity.getTime()) / DAY);
  if (idle > STALL_DAYS) return { stall: true, reason: `No PDSA entry or data point in ${idle} days.` };
  return { stall: false, reason: null };
}

/** Pure: whether a pending handoff has waited long enough to be a stall signal. */
export function handoffOverdue(createdAt: Date, now: Date): number | null {
  const waiting = Math.floor((now.getTime() - createdAt.getTime()) / DAY);
  return waiting >= HANDOFF_ACCEPTANCE_DAYS ? waiting : null;
}

export interface StallJobResult {
  checked: number;
  stalled: Array<{ id: string; title: string; reason: string; notified: string[] }>;
  /** Projects with a handoff unaccepted for 14 days or more (C1). Not stalled by this alone. */
  handoffSignals: Array<{ id: string; title: string; days: number }>;
}

export async function runStallJob(
  options: { now?: Date; mail?: MailDependencies; llm?: LlmDependencies; baseUrl?: string } = {},
): Promise<StallJobResult> {
  const now = options.now ?? new Date();
  const projects = await db.project.findMany({
    where: { status: "active" },
    select: {
      id: true,
      title: true,
      status: true,
      approvedAt: true,
      createdAt: true,
      owner: { select: { email: true } },
      coach: { select: { email: true } },
      pdsaCycles: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      measures: { select: { dataPoints: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } },
      handoffs: { where: { acceptedAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
    },
  });
  const chairs = await db.user.findMany({ where: { role: "chair", active: true }, select: { id: true, email: true } });
  const actor = await db.user.findFirst({ where: { role: "chair", active: true } });

  const result: StallJobResult = { checked: projects.length, stalled: [], handoffSignals: [] };

  for (const p of projects) {
    const times = [
      p.pdsaCycles[0]?.updatedAt,
      ...p.measures.map((m) => m.dataPoints[0]?.createdAt),
      p.approvedAt ?? p.createdAt,
    ].filter((d): d is Date => !!d);
    const lastActivity = new Date(Math.max(...times.map((d) => d.getTime())));
    const overdue = p.handoffs[0] ? handoffOverdue(p.handoffs[0].createdAt, now) : null;
    if (overdue !== null) result.handoffSignals.push({ id: p.id, title: p.title, days: overdue });
    const decision = stallDecision({ status: p.status, lastActivity }, now);

    if (!decision.stall || !decision.reason) {
      await db.project.update({ where: { id: p.id }, data: { lastActivityAt: lastActivity } });
      continue;
    }

    await db.project.update({
      where: { id: p.id },
      data: { status: "stalled", stalledAt: now, stallReason: decision.reason, lastActivityAt: lastActivity },
    });
    await audit({ userId: null, action: "project.stalled", entity: "Project", entityId: p.id, metadata: { reason: decision.reason } });

    // Devil's advocate reads the record and names the likeliest ways it
    // fails from here. Optional: a stall notice without it still goes out.
    let risks: string[] = [];
    if (actor) {
      try {
        const review = await runDevilsAdvocate(actor, p.id, options.llm);
        risks = review.risks.slice(0, 3).map((r, i) => `${i + 1}. ${r.title} — ${r.mitigation}`);
      } catch (error) {
        console.error("[job.stall] devil's advocate unavailable", error);
      }
    }

    const to = [p.owner?.email, p.coach?.email, ...chairs.map((c) => c.email)].filter((e): e is string => !!e);
    await sendMail(
      {
        to,
        subject: `Stalled: ${p.title}`,
        text: [
          `"${p.title}" has been marked stalled.`,
          "",
          `Why: ${decision.reason}`,
          "",
          ...(risks.length
            ? ["What is most likely to sink it from here, and what to do about each (devil's advocate, from the project record):", ...risks, ""]
            : []),
          "Any new PDSA entry or data point returns the project to active.",
          `${options.baseUrl ?? ""}/projects/${p.id}`,
        ].join("\n"),
        purpose: "project.stalled",
        entity: "Project",
        entityId: p.id,
      },
      options.mail,
    );
    result.stalled.push({ id: p.id, title: p.title, reason: decision.reason, notified: [...new Set(to)] });
  }

  await audit({ userId: null, action: "job.run", entity: "job", entityId: "stall", metadata: { checked: result.checked, stalled: result.stalled.length, handoffSignals: result.handoffSignals.length } });
  return result;
}
