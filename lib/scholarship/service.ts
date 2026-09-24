import { validateAim } from "@/lib/aim/validate";
import { audit } from "@/lib/audit";
import { CLER_LABEL } from "@/lib/cler";
import { describeChart, findings } from "@/lib/charts/describe";
import { studioChart, toObservations } from "@/lib/charts/studio";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { buildTree, type DriverTreeNode } from "@/lib/projects/drivers";
import { canWorkOn, ProjectNotFoundError, ProjectPermissionError, ProjectRuleError } from "@/lib/projects/service";
import { recallSimilar } from "@/lib/search/similar";
import { countAbstract, type AbstractSection } from "./abstract";
import { draftMemo, OUTCOME_LABEL, parseIrbAnswers, screen, type MemoProject, type PolicyDoc } from "./irb";
import type { SquireRecord } from "./squire";
import { abstractHeadings, venueById, type ProjectProfile } from "./venues";

/**
 * Loads what the scholarship tools read, and records what they write.
 *
 * Everything here is the owning program's working record (Q4): results, the
 * PDSA log, the ethics screening. `requireWork` is the gate.
 */

export const IRB_POLICY_SLUG = "local-irb-determination";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

async function requireWork(user: User, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, programId: true, coachId: true } });
  if (!project) throw new ProjectNotFoundError();
  if (!canWorkOn(user, project)) throw new ProjectPermissionError("Scholarship drafts are part of the working record: the owning program, its coach and the chair.");
  return project;
}

function flatten(nodes: readonly DriverTreeNode[], depth = 0): SquireRecord["drivers"] {
  return nodes.flatMap((n) => [{ kind: n.kind, text: n.text, depth }, ...flatten(n.children, depth + 1)]);
}

async function loadProject(projectId: string) {
  return db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      program: { select: { name: true, specialty: true } },
      owner: { select: { name: true } },
      coach: { select: { name: true } },
      aimStatements: { orderBy: { version: "asc" } },
      driverNodes: true,
      pdsaCycles: { orderBy: { number: "asc" } },
      sustainabilityPlan: true,
      irbPrechecks: { orderBy: { createdAt: "desc" }, take: 1 },
      measures: {
        orderBy: [{ type: "asc" }, { name: "asc" }],
        include: {
          definitions: { orderBy: { version: "desc" }, take: 1 },
          dataPoints: { orderBy: { periodIndex: "asc" }, select: { periodIndex: true, periodLabel: true, value: true, numerator: true, denominator: true } },
          annotations: { orderBy: { date: "asc" }, select: { label: true, periodIndex: true } },
        },
      },
    },
  });
}

/** The record the SQUIRE drafter arranges, with the engine run over each measure's data. */
export async function squireRecord(user: User, projectId: string): Promise<SquireRecord> {
  await requireWork(user, projectId);
  const p = await loadProject(projectId);

  const precedents = (await recallSimilar({ title: p.title, problemStatement: p.problemStatement }, p.id))
    .filter((row) => (row.status === "complete" || row.status === "archived") && row.score >= 0.25)
    .slice(0, 3);
  const outcomeDefinition = p.measures.find((m) => m.type === "outcome" && m.definitions[0])?.definitions[0];
  const policyTitle = p.irbPrechecks[0]?.policyDocId
    ? (await db.libraryDoc.findUnique({ where: { id: p.irbPrechecks[0].policyDocId }, select: { title: true } }))?.title ?? null
    : null;

  return {
    project: {
      title: p.title,
      problemStatement: p.problemStatement,
      program: p.program.name,
      specialty: p.program.specialty,
      clinicalOwner: p.clinicalOwner,
      clerDomain: p.clerDomain ? CLER_LABEL[p.clerDomain] : null,
      cohortYear: p.cohortYear,
      outcomeSummary: p.outcomeSummary,
    },
    aims: p.aimStatements.map((a) => ({
      version: a.version,
      text: a.text,
      baseline: a.baselineValue !== null ? `${a.baselineValue}${a.baselineUnit ?? ""}${a.baselinePeriod ? ` (${a.baselinePeriod})` : ""}` : null,
      // The same five-element check intake applies (lib/projects/intake.ts).
      missing: validateAim({ ...a, measure: outcomeDefinition ?? null })
        .elements.filter((e) => !e.met)
        .map((e) => e.label.split(/[,—]/)[0]!.trim().toLowerCase()),
    })),
    drivers: flatten(buildTree(p.driverNodes)),
    measures: p.measures.map((m) => {
      const def = m.definitions[0];
      const chart = m.dataPoints.length ? studioChart(m.chartType, toObservations(m.dataPoints), { view: "run", baseline: null, westernElectric: false }) : null;
      return {
        name: m.name,
        type: m.type,
        chartType: m.chartType,
        definition: def
          ? { numerator: def.numerator, denominator: def.denominator, inclusions: def.inclusions, exclusions: def.exclusions, dataSource: def.dataSource, puller: def.puller, cadence: def.cadence }
          : null,
        points: m.dataPoints.length,
        chart: chart
          ? {
              description: describeChart(chart.analysis, chart.unit),
              findings: findings(chart.analysis).map((f) => `${f.title}${f.periods ? ` ${f.periods}` : ""}${f.judgement ? " (a prompt to look, not a finding)" : ""}.`),
            }
          : null,
        annotations: m.annotations.map((a) => ({ label: a.label, period: a.periodIndex !== null ? (m.dataPoints.find((d) => d.periodIndex === a.periodIndex)?.periodLabel ?? null) : null })),
      };
    }),
    cycles: p.pdsaCycles.map((c) => ({
      number: c.number,
      plan: c.plan,
      prediction: c.prediction,
      studyResult: c.studyResult,
      actDecision: c.actDecision,
      completed: !!c.completedAt,
    })),
    precedents: precedents.map((r) => ({ title: r.title, program: r.program, cohortYear: r.cohortYear, status: r.status, outcomeSummary: r.outcomeSummary, endReason: r.endReason })),
    screening: p.irbPrechecks[0]
      ? { outcome: OUTCOME_LABEL[p.irbPrechecks[0].outcome].toLowerCase(), date: day(p.irbPrechecks[0].createdAt), citedPolicy: policyTitle }
      : null,
    sustainability: p.sustainabilityPlan
      ? { changeOwner: p.sustainabilityPlan.changeOwner, cadence: p.sustainabilityPlan.cadence, reviewer: p.sustainabilityPlan.reviewer }
      : null,
  };
}

/** What the venue matcher needs to know about the project. */
export async function venueProfile(user: User, projectId: string): Promise<ProjectProfile> {
  await requireWork(user, projectId);
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      status: true,
      clerDomain: true,
      program: { select: { specialty: true } },
      measures: { select: { _count: { select: { dataPoints: true } } } },
      _count: { select: { pdsaCycles: { where: { completedAt: { not: null } } } } },
    },
  });
  return {
    status: p.status,
    specialty: p.program.specialty,
    clerDomain: p.clerDomain,
    dataPoints: Math.max(0, ...p.measures.map((m) => m._count.dataPoints)),
    completedCycles: p._count.pdsaCycles,
  };
}

// ---------------------------------------------------------------- abstracts

export async function loadAbstract(user: User, projectId: string, venueId: string) {
  await requireWork(user, projectId);
  const draft = await db.abstractDraft.findUnique({ where: { projectId_venueId: { projectId, venueId } } });
  return draft ? { ...draft, sections: draft.sections as unknown as AbstractSection[] } : null;
}

export async function listAbstracts(user: User, projectId: string) {
  await requireWork(user, projectId);
  return db.abstractDraft.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, select: { venueId: true, updatedAt: true, sections: true } });
}

/**
 * Saves a draft. Over the word limit is allowed — a draft is how you get
 * under it — but the headings must be the venue's, in its order.
 */
export async function saveAbstract(user: User, projectId: string, venueId: string, input: { title: string | null; sections: AbstractSection[] }) {
  await requireWork(user, projectId);
  const venue = venueById(venueId);
  if (!venue) throw new ProjectRuleError("That meeting or journal is not in the venue list.");
  const { headings } = abstractHeadings(venue);
  if (input.sections.length !== headings.length || input.sections.some((s, i) => s.heading !== headings[i])) {
    throw new ProjectRuleError(`An abstract for ${venue.name} uses the headings ${headings.join(", ")}.`);
  }
  const sections = input.sections.map((s) => ({ heading: s.heading, text: s.text.trim() }));
  const title = input.title?.trim() || null;
  await db.abstractDraft.upsert({
    where: { projectId_venueId: { projectId, venueId } },
    create: { projectId, venueId, title, sections, updatedById: user.id },
    update: { title, sections, updatedById: user.id },
  });
  const count = countAbstract(sections, venue.abstractWordLimit);
  await audit({ userId: user.id, action: "scholarship.abstract_saved", entity: "Project", entityId: projectId, metadata: { venueId, words: count.total, limit: count.limit } });
  return count;
}

/**
 * A starting point for each heading, from the record only: the problem
 * statement, what was tested, the engine's description of the outcome chart.
 * Conclusions start empty — they are the author's.
 */
export async function abstractStarter(user: User, projectId: string, headings: readonly string[]): Promise<AbstractSection[]> {
  const r = await squireRecord(user, projectId);
  // The outcome measure with the most data; failing that, any measure with data.
  const charted = [...r.measures].filter((m) => m.chart).sort((a, b) => b.points - a.points);
  const outcome = charted.find((m) => m.type === "outcome") ?? charted[0];
  const changes = r.drivers.filter((d) => d.kind === "change").map((d) => d.text);
  const methods = [
    r.aims.at(-1)?.text ?? "",
    changes.length ? `Changes tested: ${changes.join("; ")}.` : "",
    r.cycles.length ? `${r.cycles.length} PDSA ${r.cycles.length === 1 ? "cycle" : "cycles"}.` : "",
    r.measures.length ? `Measures: ${r.measures.map((m) => `${m.name} (${m.type})`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const results = outcome?.chart ? [outcome.chart.description, ...outcome.chart.findings].join(" ") : "";
  const byHeading = (h: string): string => {
    const k = h.toLowerCase();
    if (k === "background" || k === "introduction") return r.project.problemStatement;
    if (k === "methods") return methods;
    if (k === "results") return results;
    return "";
  };
  return headings.map((heading) => ({ heading, text: heading === "Abstract" ? "" : byHeading(heading) }));
}

// ---------------------------------------------------------------- IRB pre-check

async function policyDoc(): Promise<(PolicyDoc & { id: string }) | null> {
  const doc = await db.libraryDoc.findUnique({ where: { slug: IRB_POLICY_SLUG } });
  return doc ? { id: doc.id, slug: doc.slug, title: doc.title, version: doc.version, updatedAt: doc.updatedAt, isLocal: doc.isLocal, localFieldsRequired: doc.localFieldsRequired } : null;
}

async function memoProject(projectId: string): Promise<MemoProject> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      title: true,
      program: { select: { name: true } },
      owner: { select: { name: true } },
      coach: { select: { name: true } },
      aimStatements: { orderBy: { version: "desc" }, take: 1, select: { text: true } },
      measures: { orderBy: { name: "asc" }, select: { name: true, definitions: { orderBy: { version: "desc" }, take: 1, select: { dataSource: true } } } },
      driverNodes: { where: { kind: "change" }, orderBy: { position: "asc" }, select: { text: true } },
      _count: { select: { pdsaCycles: true } },
    },
  });
  return {
    title: p.title,
    program: p.program.name,
    lead: p.owner?.name ?? null,
    coach: p.coach?.name ?? null,
    aim: p.aimStatements[0]?.text ?? null,
    measures: p.measures.map((m) => ({ name: m.name, dataSource: m.definitions[0]?.dataSource ?? null })),
    changeIdeas: p.driverNodes.map((d) => d.text),
    cycles: p._count.pdsaCycles,
  };
}

export async function runPrecheck(user: User, projectId: string, raw: Record<string, string | undefined>) {
  await requireWork(user, projectId);
  const parsed = parseIrbAnswers(raw);
  if (!parsed.ok) throw new ProjectRuleError(`Answer “${parsed.missing.prompt}” to finish the screening.`);
  const screening = screen(parsed.answers);
  const policy = await policyDoc();
  const memo = draftMemo({ project: await memoProject(projectId), answers: parsed.answers, screening, policy, preparedBy: user.name, date: new Date() });
  const created = await db.irbPrecheck.create({
    data: {
      projectId,
      answers: parsed.answers as never,
      outcome: screening.outcome,
      memo: memo.text,
      policyDocId: memo.cited ? policy!.id : null,
      policyDocVersion: memo.cited?.version ?? null,
      createdById: user.id,
    },
  });
  await audit({ userId: user.id, action: "scholarship.precheck_run", entity: "Project", entityId: projectId, metadata: { outcome: screening.outcome, cited: !!memo.cited } });
  return created.id;
}

export async function latestPrecheck(user: User, projectId: string) {
  await requireWork(user, projectId);
  return db.irbPrecheck.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } });
}
