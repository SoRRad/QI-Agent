import { audit } from "@/lib/audit";
import { CLER_LABEL } from "@/lib/cler";
import { CHART_NAMES, describeChart } from "@/lib/charts/describe";
import { studioChart, toObservations } from "@/lib/charts/studio";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import type { LlmDependencies } from "@/lib/llm";
import { milestoneDraftPrompt } from "@/lib/llm/prompts";
import { runPrompt } from "@/lib/llm/run";
import { buildFacts, DRAFT_LABEL, SUBCOMPETENCIES, subcompetency, type MilestoneFact, type MilestoneRecord } from "../milestones";
import { CommitteeAccessError, CommitteeNotFoundError, CommitteeRuleError, requireCommittee } from "./access";

/**
 * The milestone mapper's records (§6.6). A draft is evidence about one
 * trainee on one project, restricted to the chair and that project's coach —
 * the people who write to program directors — and stored marked as a draft
 * until a program director's review is recorded.
 */

async function requireProject(user: User, projectId: string) {
  requireCommittee(user);
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      coachId: true,
      ownerId: true,
      clerDomain: true,
    },
  });
  if (!project) throw new CommitteeNotFoundError("That project");
  if (user.role !== "chair" && project.coachId !== user.id) throw new CommitteeAccessError("Milestone drafts are for the chair and the project's coach.");
  return project;
}

/** Projects the user may map, with the trainees the record connects to each. */
export async function mappableProjects(user: User) {
  requireCommittee(user);
  const projects = await db.project.findMany({
    where: {
      status: { in: ["active", "stalled", "complete", "archived"] },
      ...(user.role === "chair" ? {} : { coachId: user.id }),
    },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      program: { select: { name: true } },
      owner: { select: { id: true, name: true, role: true } },
      handoffs: {
        select: {
          fromUser: { select: { id: true, name: true, role: true } },
          toUser: { select: { id: true, name: true, role: true } },
        },
      },
      _count: { select: { milestoneMaps: true } },
    },
  });
  return projects.map((p) => {
    const people = [p.owner, ...p.handoffs.flatMap((h) => [h.fromUser, h.toUser])].filter(
      (
        u,
      ): u is {
        id: string;
        name: string;
        role: "trainee" | "coach" | "chair";
      } => !!u && u.role === "trainee",
    );
    const trainees = [...new Map(people.map((u) => [u.id, { id: u.id, name: u.name }])).values()];
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      program: p.program.name,
      trainees,
      drafts: p._count.milestoneMaps,
    };
  });
}

/** The keyed facts for one trainee on one project, built from the record. */
export async function milestoneFacts(user: User, projectId: string, traineeId: string): Promise<MilestoneFact[]> {
  const project = await requireProject(user, projectId);
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      aimStatements: { orderBy: { version: "desc" }, take: 1 },
      pdsaCycles: { orderBy: { number: "asc" } },
      sustainabilityPlan: true,
      handoffs: {
        select: { fromUserId: true, toUserId: true, acceptedAt: true },
      },
      submissions: {
        select: { presenters: true, event: { select: { title: true } } },
      },
      measures: {
        orderBy: [{ type: "asc" }, { name: "asc" }],
        include: {
          definitions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { reproducibilityConfirmedAt: true },
          },
          dataPoints: {
            orderBy: { periodIndex: "asc" },
            select: {
              periodLabel: true,
              value: true,
              numerator: true,
              denominator: true,
            },
          },
        },
      },
    },
  });
  const trainee = await db.user.findUnique({
    where: { id: traineeId },
    select: { id: true, name: true, role: true },
  });
  const related = p.ownerId === traineeId || p.handoffs.some((h) => h.fromUserId === traineeId || h.toUserId === traineeId);
  if (!trainee || trainee.role !== "trainee" || !related)
    throw new CommitteeRuleError("Choose a trainee the project record connects to: its lead, or someone in one of its handoffs.");

  // A presenter list is free text; match the trainee by the surname in their recorded name.
  const surname = trainee.name.split(/\s+/).pop() ?? trainee.name;
  const record: MilestoneRecord = {
    role: {
      isLead: p.ownerId === traineeId,
      handedOver: p.handoffs.some((h) => h.fromUserId === traineeId),
      tookOver: p.handoffs.some((h) => h.toUserId === traineeId && h.acceptedAt),
      presented: p.submissions.filter((s) => s.presenters.includes(surname)).map((s) => s.event.title ?? "an institutional event"),
    },
    aim: p.aimStatements[0]?.text ?? null,
    measures: p.measures.map((m) => {
      const chart = m.dataPoints.length
        ? studioChart(m.chartType, toObservations(m.dataPoints), {
            view: "run",
            baseline: null,
            westernElectric: false,
          })
        : null;
      return {
        type: m.type,
        name: m.name,
        chart: CHART_NAMES[m.chartType].toLowerCase(),
        points: m.dataPoints.length,
        reading: chart ? describeChart(chart.analysis, chart.unit) : null,
        reproducible: !!m.definitions[0]?.reproducibilityConfirmedAt,
      };
    }),
    pdsa: p.pdsaCycles.map((c) => ({
      number: c.number,
      plan: c.plan,
      prediction: c.prediction,
      studyResult: c.studyResult,
      actDecision: c.actDecision,
    })),
    sustainability: p.sustainabilityPlan
      ? {
          cadence: p.sustainabilityPlan.cadence,
          hasOwner: !!p.sustainabilityPlan.changeOwner,
        }
      : null,
    clerDomainLabel: project.clerDomain ? CLER_LABEL[project.clerDomain] : null,
    patientSafety: project.clerDomain === "patient_safety",
  };
  return buildFacts(record);
}

/**
 * Drafts the evidence text and stores one row per subcompetency. Earlier
 * drafts for the same trainee and project that no program director has
 * reviewed are replaced; reviewed ones are kept as they were reviewed.
 */
export async function draftMilestones(user: User, projectId: string, traineeId: string, deps: LlmDependencies = {}): Promise<number> {
  const facts = await milestoneFacts(user, projectId, traineeId);
  if (facts.length === 0) throw new CommitteeRuleError("The record holds nothing yet to map.");
  const output = await runPrompt(milestoneDraftPrompt, { facts, subcompetencies: SUBCOMPETENCIES }, { userId: user.id }, deps);
  const byKey = new Map(facts.map((f) => [f.key, f]));

  const rows = output.entries.map((e) => ({
    projectId,
    userId: traineeId,
    milestoneCode: e.code,
    evidenceText: [e.evidence, "", "Drawn from the record:", ...e.factKeys.map((k) => `- ${byKey.get(k)!.text}`)].join("\n"),
  }));
  await db.$transaction(async (tx) => {
    await tx.milestoneMap.deleteMany({
      where: { projectId, userId: traineeId, pdReviewedAt: null },
    });
    for (const row of rows) await tx.milestoneMap.create({ data: row });
  });
  await audit({
    userId: user.id,
    action: "milestone.drafted",
    entity: "Project",
    entityId: projectId,
    metadata: { traineeId, codes: rows.map((r) => r.milestoneCode) },
  });
  return rows.length;
}

export async function milestoneDrafts(user: User, projectId: string) {
  await requireProject(user, projectId);
  const rows = await db.milestoneMap.findMany({
    where: { projectId },
    orderBy: [{ userId: "asc" }, { milestoneCode: "asc" }, { generatedAt: "desc" }],
    select: {
      id: true,
      milestoneCode: true,
      evidenceText: true,
      generatedAt: true,
      pdReviewedAt: true,
      user: { select: { id: true, name: true } },
      pdReviewedBy: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    subcompetency: subcompetency(r.milestoneCode) ?? null,
    status: r.pdReviewedAt ? "reviewed" : DRAFT_LABEL,
  }));
}

/**
 * Records that the program director has reviewed a draft. The system has no
 * program director role, so the chair or coach who received the review
 * records it, and the page says who recorded it.
 */
export async function recordPdReview(user: User, mapId: string): Promise<void> {
  const row = await db.milestoneMap.findUnique({
    where: { id: mapId },
    select: { projectId: true, pdReviewedAt: true },
  });
  if (!row) throw new CommitteeNotFoundError("That draft");
  await requireProject(user, row.projectId);
  if (row.pdReviewedAt) return;
  await db.milestoneMap.update({
    where: { id: mapId },
    data: { pdReviewedAt: new Date(), pdReviewedById: user.id },
  });
  await audit({
    userId: user.id,
    action: "milestone.reviewed",
    entity: "MilestoneMap",
    entityId: mapId,
  });
}
