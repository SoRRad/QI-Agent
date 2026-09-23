import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { mockDriver } from "@/lib/llm/drivers/mock";
import { runStallJob } from "@/lib/jobs/stall";
import { addPoints } from "@/lib/charts/dataService";
import { saveDefinition } from "@/lib/charts/definitionService";
import { addDriverNode, moveDriverNode, removeDriverNode } from "@/lib/projects/driverService";
import { acceptHandoff, createHandoff } from "@/lib/projects/handoff";
import { completeCycle, createCycle, PredictionRequiredError, updateCycle } from "@/lib/projects/pdsa";
import {
  addMeasure,
  approveProject,
  archiveProject,
  completeProject,
  createDraft,
  IntakeBlockedError,
  ProjectPermissionError,
  ProjectRuleError,
  saveAim,
  submitProject,
  updateContext,
  updatePeople,
} from "@/lib/projects/service";
import { findSimilarProjects } from "@/lib/search/similar";
import { runWithContext } from "@/lib/request-context";

/**
 * Phase 5 against the TEST database: the four exit criteria, and the rules
 * around them. Projects created here are removed afterwards.
 */

const hasDb = !!process.env["DATABASE_URL_TEST"];
const llm = { driver: mockDriver(), audit: async () => undefined };
const DAY = 86_400_000;
const created: string[] = [];

let trainee: User;
let trainee2: User;
let surgeon: User;
let coach: User;
let chair: User;

const as = <T>(user: User, fn: () => Promise<T>) => runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, fn);

function mailSink() {
  const sent: Array<Record<string, unknown>> = [];
  return { sent, deps: { env: {}, audit: async (entry: Record<string, unknown>) => void sent.push(entry) } as never };
}

async function draft(user: User, title = "Summaries drafted before departure on the medicine wards") {
  const id = await as(user, () =>
    createDraft(user, {
      title,
      problemStatement: "Discharge summaries are drafted after the patient leaves, so the receiving clinician has nothing at the first visit.",
    }),
  );
  created.push(id);
  return id;
}

/** A draft with everything intake requires. */
async function completeDraft(user: User, title?: string) {
  const id = await draft(user, title);
  await as(user, async () => {
    const outcome = await addMeasure(user, id, { name: "Summaries signed more than 48 hours after discharge", type: "outcome", chartType: "p", libraryMeasureId: null });
    // The aim's fifth element is the outcome measure's numerator and denominator.
    await saveDefinition(user, outcome, {
      numerator: "Discharge summaries signed more than 48 hours after the recorded discharge time.",
      denominator: "All discharge summaries for medicine ward discharges in the month.",
      inclusions: "Adult medicine ward discharges.",
      exclusions: "Deaths; transfers to another acute facility.",
      dataSource: "EHR documentation report DSR-114",
      puller: "Decision Support analyst",
      cadence: "monthly",
    });
    await addMeasure(user, id, { name: "Documentation minutes per discharge", type: "balancing", chartType: "xmr", libraryMeasureId: null });
    await saveAim(user, id, {
      text: "Reduce the proportion of discharge summaries signed more than 48 hours after discharge on the medicine wards at University Hospital from 34% (baseline, 1 October 2024 – 30 September 2025) to 15% by 30 June 2027.",
      baselineValue: 34,
      baselineUnit: "%",
      baselinePeriod: "1 October 2024 – 30 September 2025",
      target: 15,
      targetUnit: "%",
      deadline: new Date("2027-06-30T00:00:00Z"),
      population: "Adult patients discharged from the medicine wards at University Hospital",
    });
    await updatePeople(user, id, { clinicalOwner: "Dr. H. Vasquez, Hospitalist Medical Director", coachId: coach.id, sponsor: null, analystContact: null });
    await updateContext(user, id, { clerDomain: "care_transitions", equityStratificationPlan: "Stratify by preferred language." });
  });
  return id;
}

beforeAll(async () => {
  if (!hasDb) return;
  const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
  trainee = await user("resident1.medicine@example.edu");
  trainee2 = await user("resident2.medicine@example.edu");
  surgeon = await user("resident1.surgery@example.edu");
  coach = await user("coach.medicine@example.edu");
  chair = await user("chair@example.edu");
});

afterAll(async () => {
  if (!hasDb) return;
  await db.project.deleteMany({ where: { id: { in: created } } });
});

describe.skipIf(!hasDb)("intake", () => {
  it("blocks the seeded bad project with specific explanations, and leaves it a draft", async () => {
    const bad = await db.project.findFirstOrThrow({ where: { title: "Improve handoff communication" } });
    const error = await as(trainee2, () => submitProject(trainee2, bad.id)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntakeBlockedError);
    const blockers = (error as IntakeBlockedError).review.blockers;
    expect(blockers.map((b) => b.id)).toEqual(expect.arrayContaining(["balancing", "clinical_owner", "aim"]));
    expect(blockers.find((b) => b.id === "balancing")?.explanation).toMatch(/balancing measure checks/i);
    expect((await db.project.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe("draft");
  });

  it("submits a complete draft, and only its coach or the chair approves it", async () => {
    const id = await completeDraft(trainee);
    await as(trainee, () => submitProject(trainee, id));
    expect((await db.project.findUniqueOrThrow({ where: { id } })).status).toBe("submitted");
    await expect(as(trainee, () => approveProject(trainee, id))).rejects.toBeInstanceOf(ProjectPermissionError);
    await as(coach, () => approveProject(coach, id));
    const project = await db.project.findUniqueOrThrow({ where: { id } });
    expect(project.status).toBe("active");
    expect(project.approvedAt).not.toBeNull();
  });

  it("keeps aims append-only: every change is a new version", async () => {
    const id = await draft(trainee);
    const base = { baselineValue: null, baselineUnit: null, baselinePeriod: null, target: null, targetUnit: null, deadline: null, population: null };
    expect(await as(trainee, () => saveAim(trainee, id, { ...base, text: "First attempt at the aim statement." }))).toBe(1);
    expect(await as(trainee, () => saveAim(trainee, id, { ...base, text: "First attempt at the aim statement." }))).toBe(1);
    expect(await as(trainee, () => saveAim(trainee, id, { ...base, text: "Second attempt at the aim statement." }))).toBe(2);
  });

  it("does not let another program edit the working record", async () => {
    const id = await draft(trainee);
    await expect(as(surgeon, () => updateContext(surgeon, id, { clerDomain: null, equityStratificationPlan: null }))).rejects.toBeInstanceOf(ProjectPermissionError);
  });

  it("links a library measure by copying its current definition", async () => {
    const id = await draft(trainee);
    // A seeded library measure with a definition; other test files create bare
    // library measures in their own transactions while this one runs.
    const library = await db.measure.findFirstOrThrow({ where: { isLibrary: true, deprecated: false, definitions: { some: {} } }, orderBy: { createdAt: "asc" } });
    const measureId = await as(trainee, () => addMeasure(trainee, id, { name: "", type: "outcome", chartType: "run", libraryMeasureId: library.id }));
    const m = await db.measure.findUniqueOrThrow({ where: { id: measureId }, include: { definitions: true } });
    expect(m.basedOnId).toBe(library.id);
    expect(m.chartType).toBe(library.chartType);
    expect(m.definitions).toHaveLength(1);
  });
});

describe.skipIf(!hasDb)("duplicate detection", () => {
  it("surfaces the archived precedent with why it ended, from the record", async () => {
    const bad = await db.project.findFirstOrThrow({ where: { title: "Improve handoff communication" } });
    const result = await findSimilarProjects({ title: bad.title, problemStatement: bad.problemStatement }, { excludeId: bad.id, userId: trainee2.id }, llm);
    expect(result.ranked).toBe(true);
    const precedent = result.projects.find((p) => p.title.startsWith("Standardised evening handoff"));
    expect(precedent?.status).toBe("archived");
    expect(precedent?.endReason).toMatch(/resident lead graduated/);
    expect(precedent?.reason).toMatch(/handoff/i);
    expect(result.projects.some((p) => p.title === bad.title)).toBe(false);
  });
});

describe.skipIf(!hasDb)("PDSA", () => {
  it("refuses to mark a cycle done without a prediction, and fixes the prediction once Do is recorded", async () => {
    const id = await completeDraft(trainee);
    await as(trainee, () => submitProject(trainee, id));
    await as(chair, () => approveProject(chair, id));

    await as(trainee, () => createCycle(trainee, id, { plan: "Draft summaries in the afternoon huddle for two weeks on Team B.", prediction: null, plannedStart: null, plannedEnd: null }));
    const cycle = await db.pdsaCycle.findFirstOrThrow({ where: { projectId: id, number: 1 } });
    await as(trainee, () => updateCycle(trainee, cycle.id, { studyResult: "Drafting reached 46%.", actDecision: "adapt" }));
    await expect(as(trainee, () => completeCycle(trainee, cycle.id))).rejects.toBeInstanceOf(PredictionRequiredError);
    expect((await db.pdsaCycle.findUniqueOrThrow({ where: { id: cycle.id } })).completedAt).toBeNull();

    await as(trainee, () => updateCycle(trainee, cycle.id, { prediction: "Drafting before departure will rise to about half." }));
    await as(trainee, () => updateCycle(trainee, cycle.id, { doAction: "Ran on Team B for two weeks." }));
    await expect(as(trainee, () => updateCycle(trainee, cycle.id, { prediction: "Drafting will reach about 46%." }))).rejects.toThrow(/prediction is fixed/);

    await as(trainee, () => completeCycle(trainee, cycle.id));
    expect((await db.pdsaCycle.findUniqueOrThrow({ where: { id: cycle.id } })).completedAt).not.toBeNull();
    await expect(as(trainee, () => updateCycle(trainee, cycle.id, { plan: "Rewritten" }))).rejects.toBeInstanceOf(ProjectRuleError);
  });

  it("refuses cycles before the project is approved", async () => {
    const id = await draft(trainee);
    await expect(as(trainee, () => createCycle(trainee, id, { plan: "Too early to test anything here.", prediction: null, plannedStart: null, plannedEnd: null }))).rejects.toThrow(
      /approved and active/,
    );
  });
});

describe.skipIf(!hasDb)("stall job", () => {
  it("flips a 43-day-idle active project, notifies owner, coach and chair, and un-stalls on new activity", async () => {
    const id = await completeDraft(trainee);
    await as(trainee, () => submitProject(trainee, id));
    await as(coach, () => approveProject(coach, id));
    // Approved 43 days ago, nothing since.
    await db.project.update({ where: { id }, data: { approvedAt: new Date(Date.now() - 43 * DAY) } });

    const mail = mailSink();
    const result = await runStallJob({ mail: mail.deps, llm, baseUrl: "https://qi.example.edu" });
    const flagged = result.stalled.find((s) => s.id === id);
    expect(flagged?.reason).toBe("No PDSA entry or data point in 43 days.");
    expect(flagged?.notified).toEqual(expect.arrayContaining([trainee.email, coach.email, chair.email]));

    const project = await db.project.findUniqueOrThrow({ where: { id } });
    expect(project.status).toBe("stalled");
    expect(project.stallReason).toBe("No PDSA entry or data point in 43 days.");

    // The notice was rendered and logged (mail is in log mode), with devil's
    // advocate's risks attached (addition C4).
    const notice = mail.sent.find((e) => (e["metadata"] as { purpose?: string })?.purpose === "project.stalled" && e["entityId"] === id);
    const text = (notice?.["metadata"] as { text: string }).text;
    expect(text).toMatch(/Why: No PDSA entry or data point in 43 days\./);
    expect(text).toMatch(/devil's advocate/);

    // Any new data point returns it to active.
    const measure = await db.measure.findFirstOrThrow({ where: { projectId: id, type: "outcome" } });
    await as(trainee, () => addPoints(trainee, measure.id, [{ period: "Sep 2026", numerator: "20", denominator: "100" }]));
    const after = await db.project.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("active");
    expect(after.stalledAt).toBeNull();
  });

  it("leaves the recently active seeded project alone, but reports its overdue handoff as a signal", async () => {
    const result = await runStallJob({ mail: mailSink().deps, llm });
    const discharge = await db.project.findFirstOrThrow({ where: { title: "Discharge summary completion within 48 hours" } });
    expect(result.stalled.some((s) => s.id === discharge.id)).toBe(false);
    expect(result.handoffSignals.find((s) => s.id === discharge.id)?.days).toBeGreaterThanOrEqual(14);
    expect((await db.project.findUniqueOrThrow({ where: { id: discharge.id } })).status).toBe("active");
  });
});

describe.skipIf(!hasDb)("handoff", () => {
  it("records the packet, logs the mail, and moves ownership only when the incoming owner accepts", async () => {
    const id = await completeDraft(trainee);
    await as(trainee, () => submitProject(trainee, id));
    await as(coach, () => approveProject(coach, id));
    const mail = mailSink();
    const { id: handoffId, delivered } = await as(trainee, () =>
      createHandoff(
        trainee,
        id,
        { toUserId: trainee2.id, openItems: "Cycle 1 not yet planned.", dataAccessNotes: "Report DSR-114 via Decision Support.", nextActions: ["Plan cycle 1", "Request the baseline pull", "Meet the coach"] },
        { baseUrl: "https://qi.example.edu", mail: mail.deps },
      ),
    );
    expect(delivered).toBe(false);
    const logged = mail.sent.find((e) => e["action"] === "mail.logged");
    expect((logged?.["metadata"] as { to: string[]; text: string }).to).toEqual([trainee2.email, coach.email]);
    expect((logged?.["metadata"] as { text: string }).text).toMatch(/CURRENT STATE \(from the project record\)/);

    await expect(
      as(trainee, () =>
        createHandoff(trainee, id, { toUserId: trainee2.id, openItems: "x".repeat(12), dataAccessNotes: "x".repeat(12), nextActions: ["a", "b", "c"] }, { baseUrl: "", mail: mail.deps }),
      ),
    ).rejects.toThrow(/still waiting to be accepted/);
    await expect(as(surgeon, () => acceptHandoff(surgeon, handoffId))).rejects.toBeInstanceOf(ProjectPermissionError);
    expect((await db.project.findUniqueOrThrow({ where: { id } })).ownerId).toBe(trainee.id);

    await as(trainee2, () => acceptHandoff(trainee2, handoffId));
    expect((await db.project.findUniqueOrThrow({ where: { id } })).ownerId).toBe(trainee2.id);
  });
});

describe.skipIf(!hasDb)("completion and archive", () => {
  it("requires a sustainability plan to complete, and a reason to archive; archived projects stay searchable", async () => {
    // A title of its own: the other tests' drafts share the default title, and
    // identical twins would tie with this project in the rerank's top five.
    const id = await completeDraft(trainee, `Summaries drafted before departure, archive check ${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6)}`);
    await as(trainee, () => submitProject(trainee, id));
    await as(coach, () => approveProject(coach, id));
    await as(trainee, () =>
      completeProject(trainee, id, {
        outcomeSummary: "Signed-late fell from 34% to 17% and held for six months.",
        changeOwner: "Hospitalist Medical Director",
        continuingMeasureId: null,
        cadence: "quarterly",
        reviewer: "Hospitalist quality meeting",
        notes: null,
      }),
    );
    expect(await db.sustainabilityPlan.findUnique({ where: { projectId: id } })).not.toBeNull();

    await expect(as(trainee, () => archiveProject(trainee, id, { endReason: "Finished and handed to the service line.", outcomeSummary: null }))).rejects.toBeInstanceOf(ProjectPermissionError);
    await as(chair, () => archiveProject(chair, id, { endReason: "Finished and handed to the service line.", outcomeSummary: null }));
    const archived = await db.project.findUniqueOrThrow({ where: { id } });
    expect(archived.status).toBe("archived");

    // Still found by the registry's search and by duplicate detection.
    const found = await db.project.findMany({ where: { title: { contains: "drafted before departure", mode: "insensitive" } }, select: { id: true } });
    expect(found.map((p) => p.id)).toContain(id);
    const similar = await findSimilarProjects({ title: archived.title, problemStatement: archived.problemStatement }, { excludeId: null, userId: trainee.id }, llm);
    expect(similar.projects.some((p) => p.id === id)).toBe(true);
  });
});

describe.skipIf(!hasDb)("driver diagram", () => {
  it("enforces the tree shape and reorders siblings", async () => {
    const id = await draft(trainee);
    const p1 = await as(trainee, () => addDriverNode(trainee, id, { kind: "primary", parentId: null, text: "First primary driver" }));
    const p2 = await as(trainee, () => addDriverNode(trainee, id, { kind: "primary", parentId: null, text: "Second primary driver" }));
    await expect(as(trainee, () => addDriverNode(trainee, id, { kind: "change", parentId: p1, text: "A change idea too high up" }))).rejects.toThrow(/sit under a secondary driver/);
    const s1 = await as(trainee, () => addDriverNode(trainee, id, { kind: "secondary", parentId: p1, text: "A secondary driver" }));
    await as(trainee, () => addDriverNode(trainee, id, { kind: "change", parentId: s1, text: "A change idea" }));
    // The database refuses a non-primary root regardless of the service.
    await expect(db.driverNode.create({ data: { projectId: id, kind: "secondary", parentId: null, text: "orphan", position: 9 } })).rejects.toThrow();

    await as(trainee, () => moveDriverNode(trainee, id, p2, "up"));
    const roots = await db.driverNode.findMany({ where: { projectId: id, parentId: null }, orderBy: { position: "asc" } });
    expect(roots.map((r) => r.id)).toEqual([p2, p1]);

    await as(trainee, () => removeDriverNode(trainee, id, p1));
    expect(await db.driverNode.count({ where: { projectId: id } })).toBe(1);
  });
});
