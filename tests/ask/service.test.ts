import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { askQuestion, runDevilsAdvocate, tutorTurn } from "@/lib/ask/service";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { mockDriver } from "@/lib/llm/drivers/mock";
import type { LlmDriver } from "@/lib/llm";
import { looksLikeAimStatement } from "@/lib/llm/prompts";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "@/lib/phi/errors";
import { runWithContext } from "@/lib/request-context";

/**
 * Ask, tutor and devil's advocate, end to end against the TEST database with
 * the mock provider. The mock follows the same rules as a real model — and is
 * checked by the same refine — so these exercise the real grounding checks.
 */

const hasDb = !!process.env["DATABASE_URL_TEST"];
const deps = { driver: mockDriver(), audit: async () => undefined };

let trainee: User;
let surgeryTrainee: User;
let discharge = "";
let badProject = "";
let sepsis = "";
let labs = "";
// Gaps these tests create are removed by time, not by a marker in the text:
// a marker such as "[test]" is itself a word, and it skews retrieval.
const startedAt = new Date();

beforeAll(async () => {
  if (!hasDb) return;
  trainee = await db.user.findUniqueOrThrow({ where: { email: "resident1.medicine@example.edu" } });
  surgeryTrainee = await db.user.findUniqueOrThrow({ where: { email: "resident1.surgery@example.edu" } });
  const byTitle = async (t: string) => (await db.project.findFirstOrThrow({ where: { title: t } })).id;
  discharge = await byTitle("Discharge summary completion within 48 hours");
  badProject = await byTitle("Improve handoff communication");
  sepsis = await byTitle("Time to first antibiotic dose in suspected sepsis");
  labs = await byTitle("Reducing routine daily laboratory testing on the surgical ward");
});

afterAll(async () => {
  if (!hasDb) return;
  await db.knowledgeGap.deleteMany({ where: { createdAt: { gte: startedAt } } });
});

const as = <T>(user: User, fn: () => Promise<T>, acknowledged: string[] = []) =>
  runWithContext({ userId: user.id, acknowledgedPhi: new Set(acknowledged) }, fn);

describe.skipIf(!hasDb)("Ask", () => {
  it("answers from the library, citing a document with a quote that appears in it", async () => {
    const result = await as(trainee, () =>
      askQuestion(trainee, "What are the five required elements of an aim statement?", deps),
    );
    expect(result.kind).toBe("answered");
    if (result.kind !== "answered") return;
    expect(result.citations[0]?.slug).toBe("aim-statement-standard");
    expect(result.citesLocal).toBe(false);

    const doc = await db.libraryDoc.findUniqueOrThrow({ where: { slug: "aim-statement-standard" } });
    const flat = doc.body.replace(/\*\*/g, "").replace(/\s+/g, " ").toLowerCase();
    expect(flat).toContain(result.citations[0]!.quote.replace(/\s+/g, " ").toLowerCase());
  });

  it("says a question is not covered, names the missing document, and logs the gap", async () => {
    const question = "What is the maximum duty hour limit for interns on night float?";
    const result = await as(trainee, () => askQuestion(trainee, question, deps));
    expect(result.kind).toBe("not_covered");
    if (result.kind !== "not_covered") return;
    expect(result.suggestedDocument).toBeTruthy();
    expect(result.askedBefore).toBe(false);

    const gap = await db.knowledgeGap.findFirst({ where: { question } });
    expect(gap?.status).toBe("open");
    expect(gap?.askedById).toBe(trainee.id);
  });

  it("merges a reworded repeat into the same gap instead of adding a row", async () => {
    // The test database is shared with the browser suite, which asks a
    // similar question, so this asserts the behaviour — the repeat merges and
    // at most one row is added — rather than assuming an empty table.
    const first = "What parking permit do residents get?";
    const reworded = "What parking permit do residents need?";
    const matching = () => db.knowledgeGap.count({ where: { question: { contains: "parking permit" } } });

    const before = await matching();
    const a = await as(trainee, () => askQuestion(trainee, first, deps));
    const b = await as(trainee, () => askQuestion(trainee, reworded, deps));

    expect(a.kind).toBe("not_covered");
    expect(b.kind === "not_covered" && b.askedBefore).toBe(true);
    expect((await matching()) - before).toBeLessThanOrEqual(1);
  });

  it("flags an answer that rests on a LOCAL placeholder, and counts it against that gap", async () => {
    // The seed already holds an open gap for this question in other words, so
    // the answer is merged into it: the chair sees one gap asked more often,
    // not a second row.
    const seeded = await db.knowledgeGap.findFirstOrThrow({
      where: { question: { contains: "IRB determination before I start collecting data" } },
    });

    const result = await as(trainee, () =>
      askQuestion(trainee, "Do I need an IRB determination before collecting data for my QI project?", deps),
    );
    expect(result.kind).toBe("answered");
    if (result.kind !== "answered") return;
    expect(result.citesLocal).toBe(true);
    expect(result.citations[0]?.slug).toBe("local-irb-determination");

    const after = await db.knowledgeGap.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(after.askCount).toBe(seeded.askCount + 1);
  });

  it("refuses to send a question containing a patient identifier to the model", async () => {
    let called = false;
    const spy: LlmDriver = { ...mockDriver(), generate: async (r) => ((called = true), mockDriver().generate(r)) };
    await expect(
      as(trainee, () => askQuestion(trainee, "Why was MRN 00123456 readmitted?", { driver: spy, audit: async () => undefined })),
    ).rejects.toBeInstanceOf(PhiBlockedError);
    expect(called).toBe(false);
  });

  it("asks for acknowledgement of a warn-tier question, then proceeds and stores the gap", async () => {
    const question = "Parking permits issued on 14 March 2025 expire when?";
    const fingerprints = await as(trainee, () => askQuestion(trainee, question, deps)).catch(
      (e: PhiAcknowledgementRequiredError) => e.flags.map((f) => f.fingerprint ?? ""),
    );
    expect(Array.isArray(fingerprints)).toBe(true);

    // One acknowledgement covers both the model call and the stored gap.
    const result = await as(trainee, () => askQuestion(trainee, question, deps), fingerprints as string[]);
    expect(result.kind).toBe("not_covered");
  });

  it("never answers when the model's citations cannot be verified", async () => {
    // A model that cites a real document but invents the quote, twice.
    const fabricating: LlmDriver = {
      name: "mock",
      model: "fabricating",
      async generate(request) {
        const id = /<document id="([^"]+)"/.exec(request.prompt)?.[1] ?? "x";
        return {
          model: "fabricating",
          text: JSON.stringify({
            status: "answered",
            answer: "Duty hours are capped at 80 per week.",
            citations: [{ documentId: id, quote: "Duty hours are capped at eighty per week." }],
          }),
        };
      },
    };
    const result = await as(trainee, () =>
      askQuestion(trainee, "What are the duty hour rules?", { driver: fabricating, audit: async () => undefined }),
    );
    expect(result.kind).toBe("unavailable");
  });
});

describe.skipIf(!hasDb)("tutor mode", () => {
  it("asks one question, starting from the aim's most fundamental missing element", async () => {
    const { question } = await as(trainee, () => tutorTurn(trainee, { projectId: badProject, history: [] }, deps));
    expect((question.match(/\?/g) ?? []).length).toBe(1);
    expect(question.trim().endsWith("?")).toBe(true);
    expect(question).toMatch(/from what value to what value/);
  });

  it("moves on as the conversation progresses, never writing the aim", async () => {
    const history: Array<{ role: "tutor" | "trainee"; text: string }> = [];
    for (let i = 0; i < 6; i += 1) {
      const { question } = await as(trainee, () => tutorTurn(trainee, { projectId: badProject, history }, deps));
      expect(looksLikeAimStatement(question), question).toBe(false);
      history.push({ role: "tutor", text: question }, { role: "trainee", text: "I am not sure yet." });
    }
    expect(new Set(history.filter((t) => t.role === "tutor").map((t) => t.text)).size).toBe(6);
  });

  it("refuses to coach on a project whose working record the user cannot read", async () => {
    await expect(
      as(surgeryTrainee, () => tutorTurn(surgeryTrainee, { projectId: discharge, history: [] }, deps)),
    ).rejects.toThrow(/do not have access/);
  });

  it("scans the trainee's replies before they reach the model", async () => {
    await expect(
      as(trainee, () =>
        tutorTurn(
          trainee,
          { projectId: null, history: [{ role: "trainee", text: "The patient's SSN is 123-45-6789." }] },
          deps,
        ),
      ),
    ).rejects.toBeInstanceOf(PhiBlockedError);
  });
});

describe.skipIf(!hasDb)("devil's advocate", () => {
  it("argues the deliberately bad project's real weaknesses, most serious first", async () => {
    const { risks } = await as(trainee, () => runDevilsAdvocate(trainee, badProject, deps));
    expect(risks.map((r) => r.category)).toEqual([
      "no_clinical_owner",
      "data_unavailable",
      "effect_too_small",
      "no_balancing_measure",
      "aim_incomplete",
      "untestable_at_trainee_scale",
    ]);
    for (const risk of risks) expect(risk.mitigation.length).toBeGreaterThan(20);
  });

  it("names data as the risk for the stalled project waiting on its extract", async () => {
    const { risks } = await as(trainee, () => runDevilsAdvocate(trainee, sepsis, deps));
    expect(risks[0]?.category).toBe("data_unavailable");
    // Numbers reach the user only as computed values, substituted after the guard.
    expect(risks[0]?.argument).toMatch(/There are 0 outcome data points/);
  });

  it("finds the cycle with no prediction on the strong project", async () => {
    const { risks } = await as(trainee, () => runDevilsAdvocate(trainee, discharge, deps));
    expect(risks.map((r) => r.category)).toContain("no_prediction");
    expect(risks.find((r) => r.category === "no_prediction")?.argument).toMatch(/^1 cycles have no written prediction/);
  });

  it("falls back to sustainability when the record gives it nothing else", async () => {
    const chair = await db.user.findUniqueOrThrow({ where: { email: "chair@example.edu" } });
    const { risks } = await as(chair, () => runDevilsAdvocate(chair, labs, deps));
    expect(risks.map((r) => r.category)).toEqual(["sustainability"]);
  });
});
