import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PulseSurvey, User } from "@/lib/generated/prisma/client";
import { mockDriver } from "@/lib/llm/drivers/mock";
import type { LlmDriver } from "@/lib/llm";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "@/lib/phi/errors";
import { addResponses, createBarrier, transitionBarrier, updateBarrier } from "@/lib/pulse/barriers";
import { draftDigest, publishDigest } from "@/lib/pulse/digest";
import { PulsePermissionError } from "@/lib/pulse/errors";
import { receiptHash } from "@/lib/pulse/receipts";
import { addQuestion, createSurvey, hasResponded, myResponses, openForResponses, removeQuestion, submitResponse } from "@/lib/pulse/survey";
import { proposeThemes } from "@/lib/pulse/theming";
import { runWithContext } from "@/lib/request-context";

/**
 * Pulse against the test database (pnpm test:db:prepare). Everything created
 * here is removed afterwards, so the suite can be re-run without reseeding.
 */

const hasDb = !!process.env["DATABASE_URL_TEST"];

let chair: User;
let coach: User;
let trainees: User[];
let survey: PulseSurvey & { questions: Array<{ id: string; core: string | null }> };

const created = { responses: [] as string[], participations: [] as string[], barriers: [] as string[], digests: [] as string[], surveys: [] as string[] };

const as = <T>(user: User, fn: () => Promise<T>, acknowledged: string[] = []) =>
  runWithContext({ userId: user.id, acknowledgedPhi: new Set(acknowledged) }, fn);

const core = (name: string) => survey.questions.find((q) => q.core === name)!.id;
const answers = (barrier: string | null, confidence = "3") => ({
  [core("confidence")]: confidence,
  ...(barrier ? { [core("barrier")]: barrier } : {}),
});

async function respond(user: User, barrier: string | null, opts: { identify?: boolean; acknowledged?: string[] } = {}) {
  const receipt = await as(user, () => submitResponse(user, survey.id, { answers: answers(barrier), identify: !!opts.identify, shareProgram: false }), opts.acknowledged);
  created.participations.push(user.id);
  const row = await db.pulseResponse.findUniqueOrThrow({ where: { receiptHash: receiptHash(receipt, user.id) } });
  created.responses.push(row.id);
  return { receipt, row };
}

/** A response written straight to the table, for barrier tests that do not need a respondent. */
async function seedResponse(text: string) {
  const row = await as(chair, () => db.pulseResponse.create({ data: { surveyId: survey.id, quarter: survey.quarter, confidence: 3, barrierText: text } }));
  created.responses.push(row.id);
  return row.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  chair = await db.user.findUniqueOrThrow({ where: { email: "chair@example.edu" } });
  coach = await db.user.findUniqueOrThrow({ where: { email: "coach.medicine@example.edu" } });
  survey = await db.pulseSurvey.findFirstOrThrow({ where: { status: "open" }, include: { questions: true } });
  // Roster trainees who did not respond in the seed.
  const responded = new Set((await db.pulseParticipation.findMany({ where: { surveyId: survey.id } })).map((p) => p.userId));
  trainees = (await db.user.findMany({ where: { role: "trainee", active: true }, orderBy: { email: "asc" } })).filter((u) => !responded.has(u.id));
});

afterAll(async () => {
  if (!hasDb) return;
  await db.pulseDigest.deleteMany({ where: { id: { in: created.digests } } });
  await db.barrier.deleteMany({ where: { id: { in: created.barriers } } });
  await db.pulseResponse.deleteMany({ where: { id: { in: created.responses } } });
  await db.pulseParticipation.deleteMany({ where: { surveyId: survey.id, userId: { in: created.participations } } });
  await db.pulseSurvey.deleteMany({ where: { id: { in: created.surveys } } });
});

describe.skipIf(!hasDb)("responding", () => {
  it("records who responded apart from what they said, once per quarter", async () => {
    const [t] = trainees;
    const { row } = await respond(t!, "Nobody could say who owns the discharge order set.");
    expect(row).toMatchObject({ respondentUserId: null, respondentName: null, programId: null });
    expect(await hasResponded(t!.id, survey.id)).toBe(true);
    await expect(as(t!, () => submitResponse(t!, survey.id, { answers: answers(null), identify: false, shareProgram: false }))).rejects.toThrow(/already responded/);
  });

  it("is for trainees; committee members preview it", async () => {
    await expect(as(chair, () => submitResponse(chair, survey.id, { answers: answers(null), identify: false, shareProgram: false }))).rejects.toBeInstanceOf(PulsePermissionError);
  });

  it("leaves no participation behind when the PHI guard refuses the response", async () => {
    const t = trainees[1]!;
    await expect(as(t, () => submitResponse(t, survey.id, { answers: answers("The report for MRN 00123456 never came."), identify: false, shareProgram: false }))).rejects.toBeInstanceOf(PhiBlockedError);
    expect(await hasResponded(t.id, survey.id)).toBe(false);
  });

  it("audits a confirmed warning without the response's id or the flag's position", async () => {
    const t = trainees[2]!;
    const text = "Our request from 14 March 2026 was still open at the end of the rotation.";
    let fingerprints: string[] = [];
    try {
      await as(t, () => submitResponse(t, survey.id, { answers: answers(text), identify: false, shareProgram: false }));
    } catch (error) {
      expect(error).toBeInstanceOf(PhiAcknowledgementRequiredError);
      fingerprints = (error as PhiAcknowledgementRequiredError).flags.map((f) => f.fingerprint!).filter(Boolean);
    }
    expect(fingerprints.length).toBeGreaterThan(0);
    expect(await hasResponded(t.id, survey.id)).toBe(false);

    await respond(t, text, { acknowledged: fingerprints });
    const logged = await db.auditLog.findFirstOrThrow({ where: { userId: t.id, action: "phi.warn_acknowledged" }, orderBy: { createdAt: "desc" } });
    expect(logged.entity).toBe("PulseResponse");
    expect(logged.entityId).toBeNull();
    const flags = (logged.metadata as { flags: Array<Record<string, unknown>> }).flags;
    expect(flags[0]).toMatchObject({ rule: expect.any(String), tier: "warn", category: "date" });
    for (const f of flags) expect(Object.keys(f).sort()).toEqual(["category", "model", "rule", "tier"]);
  });

  it("shows a person their named responses anywhere, and anonymous ones only with this browser's receipt", async () => {
    const [named, anon] = [trainees[3]!, trainees[4]!];
    await respond(named, "The abstract template arrived after the deadline.", { identify: true });
    const { receipt } = await respond(anon, "Scheduling meant I met my coach only once.");

    expect((await myResponses(named, [])).responses.map((r) => r.identified)).toEqual([true]);
    const without = await myResponses(anon, []);
    expect(without.responses).toEqual([]);
    expect(without.quarters.map((q) => q.quarter)).toEqual([survey.quarter]);
    expect((await myResponses(anon, [receipt])).responses.map((r) => r.barrierText)).toEqual(["Scheduling meant I met my coach only once."]);
    // The same browser, someone else signed in: nothing.
    expect((await myResponses(named, [receipt])).responses.every((r) => r.identified)).toBe(true);
  });

  it("refuses to edit a submitted response, at the database", async () => {
    const id = created.responses[0]!;
    await expect(db.pulseResponse.update({ where: { id }, data: { barrierText: "Edited afterwards." } })).rejects.toThrow(/cannot be edited/);
  });
});

describe.skipIf(!hasDb)("composing", () => {
  it("copies the latest questions into a draft, keeps the core questions, and freezes an open survey", async () => {
    const id = await as(chair, () => createSurvey(chair, "2031-Q1"));
    created.surveys.push(id);
    const draft = await db.pulseSurvey.findUniqueOrThrow({ where: { id }, include: { questions: { orderBy: { position: "asc" } } } });
    expect(draft.questions.map((q) => q.core)).toEqual(expect.arrayContaining(["confidence", "cler_domain", "barrier"]));
    expect(draft.questions).toHaveLength(survey.questions.length);
    const confidence = draft.questions.find((q) => q.core === "confidence")!;
    await expect(as(chair, () => removeQuestion(chair, confidence.id))).rejects.toThrow(/core questions stay/);
    await expect(as(chair, () => addQuestion(chair, id, { kind: "single_choice", prompt: "How often did you meet your coach?", help: null, required: false, options: ["Never"] }))).rejects.toThrow(/between 2 and 8/);
    await as(chair, () => addQuestion(chair, id, { kind: "scale", prompt: "How useful was the QI curriculum?", help: null, required: false, options: [] }));

    await expect(as(chair, () => openForResponses(chair, id))).rejects.toThrow(/still open/);
    await expect(as(chair, () => addQuestion(chair, survey.id, { kind: "free_text", prompt: "Anything else to add?", help: null, required: false, options: [] }))).rejects.toThrow(/fixed once a survey opens/);
    await expect(as(coach, () => createSurvey(coach, "2031-Q2"))).rejects.toBeInstanceOf(PulsePermissionError);
  });
});

describe.skipIf(!hasDb)("barriers", () => {
  it("refuses a theme that repeats a respondent's words, whoever wrote it", async () => {
    const id = await seedResponse("Every audit needed a data request that sat in a queue for months without an owner.");
    await expect(
      as(chair, () => createBarrier(chair, { label: "Data requests", summary: "Trainees say every audit needed a data request that sat in a queue for weeks.", escalationTarget: "gmec", responseIds: [id] })),
    ).rejects.toThrow(/repeats a respondent's words \(“every audit needed a data request”\)/);
  });

  it("counts responses in code, takes each response once, and moves forward through the lifecycle", async () => {
    const a = await seedResponse("Our unit could not find who signs off order set changes.");
    const b = await seedResponse("Changing the order set took three committees and nobody said which.");
    const barrierId = await as(chair, () =>
      createBarrier(chair, { label: "Unclear approval routes", summary: "Trainees could not find out who authorises changes to clinical systems.", escalationTarget: "committee", responseIds: [a] }),
    );
    created.barriers.push(barrierId);
    await expect(as(chair, () => createBarrier(chair, { label: "Duplicate", summary: "A second theme claiming a response already in a barrier.", escalationTarget: "committee", responseIds: [a] }))).rejects.toThrow(/already in a barrier/);
    await as(chair, () => addResponses(chair, barrierId, [b]));
    expect((await db.barrier.findUniqueOrThrow({ where: { id: barrierId } })).count).toBe(2);

    await expect(as(coach, () => transitionBarrier(coach, barrierId, { to: "at_gmec", decision: null, whatChanged: null }))).rejects.toBeInstanceOf(PulsePermissionError);
    await as(chair, () => updateBarrier(chair, barrierId, { label: "Unclear approval routes", summary: "Trainees could not find out who authorises changes to clinical systems.", escalationTarget: "committee", ownerId: coach.id }));
    // The owner may move it along.
    await as(coach, () => transitionBarrier(coach, barrierId, { to: "decided", decision: "The committee will publish the order set approval route on the intranet.", whatChanged: null }));
    await expect(as(coach, () => transitionBarrier(coach, barrierId, { to: "closed", decision: null, whatChanged: null }))).rejects.toThrow(/Say what changed/);
    await as(coach, () => transitionBarrier(coach, barrierId, { to: "closed", decision: null, whatChanged: "The approval route for order set changes is published on the intranet." }));
    const closed = await db.barrier.findUniqueOrThrow({ where: { id: barrierId } });
    expect(closed).toMatchObject({ status: "closed", decision: expect.stringMatching(/publish the order set/) });
    expect(closed.decidedAt).not.toBeNull();
    expect(closed.closedAt).not.toBeNull();
    await expect(as(chair, () => transitionBarrier(chair, barrierId, { to: "raised", decision: null, whatChanged: null }))).rejects.toThrow(/stays closed/);
    const late = await seedResponse("Another note about approvals for order changes.");
    await expect(as(chair, () => addResponses(chair, barrierId, [late]))).rejects.toThrow(/closed barrier takes no new responses/);
  });
});

describe.skipIf(!hasDb)("theming", () => {
  it("proposes themes for unthemed responses only, counted in code", async () => {
    const result = await as(chair, () => proposeThemes(chair, survey.quarter, { driver: mockDriver(), audit: async () => undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const themed = new Set((await db.pulseResponse.findMany({ where: { barriers: { some: {} } }, select: { id: true } })).map((r) => r.id));
    for (const p of result.proposals) {
      expect(p.count).toBe(p.responseIds.length);
      for (const id of p.responseIds) expect(themed.has(id)).toBe(false);
    }
  });

  it("is the chair's", async () => {
    await expect(proposeThemes(coach, survey.quarter)).rejects.toBeInstanceOf(PulsePermissionError);
  });
});

describe.skipIf(!hasDb)("digest (exit criterion: generated from closed barriers only)", () => {
  it("gives the model closed barriers only, and publishing refuses anything else", async () => {
    const id = await seedResponse("Nobody told us the protected-time policy had changed.");
    const barrierId = await as(chair, () =>
      createBarrier(chair, { label: "Policy changes are not communicated", summary: "Changes to trainee policy reach residents late or not at all.", escalationTarget: "program", responseIds: [id] }),
    );
    created.barriers.push(barrierId);
    await as(chair, () => transitionBarrier(chair, barrierId, { to: "decided", decision: "Programs will announce policy changes at the monthly town hall.", whatChanged: null }));
    await as(chair, () => transitionBarrier(chair, barrierId, { to: "closed", decision: null, whatChanged: "Policy changes are announced at the monthly town hall and in the newsletter." }));

    const prompts: string[] = [];
    const base = mockDriver();
    const recording: LlmDriver = { ...base, generate: async (request) => (prompts.push(request.prompt), base.generate(request)) };
    const draft = await as(chair, () => draftDigest(chair, { driver: recording, audit: async () => undefined }));

    const open = await db.barrier.findMany({ where: { status: { not: "closed" } }, select: { id: true, themeLabel: true } });
    expect(open.length).toBeGreaterThan(0);
    for (const b of open) expect(prompts.join("\n")).not.toContain(b.themeLabel);
    expect(prompts.join("\n")).toContain("Policy changes are not communicated");
    const closedIds = new Set((await db.barrier.findMany({ where: { status: "closed" }, select: { id: true } })).map((b) => b.id));
    for (const item of draft.items) expect(closedIds.has(item.barrierId)).toBe(true);
    // No response text reaches the digest prompt.
    expect(prompts.join("\n")).not.toContain("protected-time policy had changed");

    await expect(
      as(chair, () => publishDigest(chair, { headline: "You reported, we changed", intro: "What changed this quarter.", items: [{ barrierId: open[0]!.id, text: "Something changed here." }] })),
    ).rejects.toThrow(/closed barriers only/);

    const sent: Array<Record<string, unknown>> = [];
    const mail = { env: {}, audit: async (entry: Record<string, unknown>) => void sent.push(entry) } as never;
    const item = draft.items.find((i) => i.barrierId === barrierId)!;
    const digestId = await as(chair, () => publishDigest(chair, { headline: draft.headline, intro: draft.intro, items: [item] }, mail));
    created.digests.push(digestId);
    const metadata = sent[0]?.["metadata"] as { to: string[]; bcc: string[] };
    expect(metadata.to).toEqual([]);
    expect(metadata.bcc.length).toBeGreaterThan(10);

    await expect(as(chair, () => publishDigest(chair, { headline: draft.headline, intro: draft.intro, items: [item] }, mail))).rejects.toThrow(/already been reported/);
  });

  it("is the chair's", async () => {
    await expect(draftDigest(coach)).rejects.toBeInstanceOf(PulsePermissionError);
    await expect(publishDigest(coach, { headline: "x", intro: "y", items: [] })).rejects.toBeInstanceOf(PulsePermissionError);
  });
});

