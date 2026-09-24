import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { PhiBlockedError } from "@/lib/phi/errors";
import { ProjectPermissionError, ProjectRuleError } from "@/lib/projects/service";
import { assembleSquire } from "@/lib/scholarship/squire";
import { IRB_POLICY_SLUG, runPrecheck, saveAbstract, squireRecord, venueProfile } from "@/lib/scholarship/service";
import { runWithContext } from "@/lib/request-context";

/**
 * Scholarship against the seeded test database. The deliberately bad project
 * has no data points: it is the exit criterion's "project with no data".
 */

const hasDb = !!process.env["DATABASE_URL_TEST"];

let trainee: User;
let surgeon: User;
let flagshipId: string;
let badId: string;
const created = { prechecks: [] as string[], abstracts: [] as Array<{ projectId: string; venueId: string }> };

const as = <T>(user: User, fn: () => Promise<T>) => runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, fn);

const answers = {
  purpose: "local",
  assignment: "no",
  acceptedPractice: "yes",
  risk: "no",
  extraData: "no",
  identifiableOut: "no",
  funding: "no",
  dissemination: "yes",
};

beforeAll(async () => {
  if (!hasDb) return;
  trainee = await db.user.findUniqueOrThrow({ where: { email: "resident1.medicine@example.edu" } });
  surgeon = await db.user.findUniqueOrThrow({ where: { email: "resident1.surgery@example.edu" } });
  flagshipId = (await db.project.findFirstOrThrow({ where: { title: "Discharge summary completion within 48 hours" } })).id;
  badId = (await db.project.findFirstOrThrow({ where: { title: "Improve handoff communication" } })).id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db.irbPrecheck.deleteMany({ where: { id: { in: created.prechecks } } });
  for (const a of created.abstracts) await db.abstractDraft.deleteMany({ where: a });
});

describe.skipIf(!hasDb)("SQUIRE draft from the record", () => {
  it("writes no results for the project with no data points, and marks what the author must add", async () => {
    const record = await as(trainee, () => squireRecord(trainee, badId));
    expect(record.measures.every((m) => m.points === 0)).toBe(true);
    const draft = assembleSquire(record);
    const results = draft.sections.find((s) => s.title === "Results")!;
    expect(results.fromRecord).toEqual([]);
    expect(results.author[0]).toMatch(/no results to report/);
    expect(draft.sections.find((s) => s.title === "Specific aims")!.author.join(" ")).toMatch(/The aim is missing/);
    // Available knowledge finds the archived I-PASS precedent in the registry.
    expect(draft.sections.find((s) => s.title === "Available knowledge")!.fromRecord.join(" ")).toMatch(/Standardised evening handoff using I-PASS/);
  });

  it("reports the flagship's results in the engine's words, with its PDSA predictions against results", async () => {
    const draft = assembleSquire(await as(trainee, () => squireRecord(trainee, flagshipId)));
    const results = draft.sections.find((s) => s.title === "Results")!.fromRecord.join("\n");
    expect(results).toMatch(/Run chart of 24 points from Oct 2024 to Sep 2026\. Median 26\.7%\./);
    expect(results).toMatch(/Cycle 2 \(adopt\): predicted/);
    expect(draft.sections.find((s) => s.title === "Ethical considerations")!.fromRecord.join(" ")).toMatch(/looks like quality improvement/);
  });

  it("is the owning program's", async () => {
    await expect(as(surgeon, () => squireRecord(surgeon, flagshipId))).rejects.toBeInstanceOf(ProjectPermissionError);
    await expect(as(surgeon, () => venueProfile(surgeon, flagshipId))).rejects.toBeInstanceOf(ProjectPermissionError);
  });
});

describe.skipIf(!hasDb)("IRB / QI screening (exit criterion: cites a LibraryDoc or declares the gap)", () => {
  it("declares the gap while the local policy is a placeholder", async () => {
    const id = await as(trainee, () => runPrecheck(trainee, flagshipId, answers));
    created.prechecks.push(id);
    const row = await db.irbPrecheck.findUniqueOrThrow({ where: { id } });
    expect(row.outcome).toBe("likely_qi");
    expect(row.policyDocId).toBeNull();
    expect(row.memo).toMatch(/\*\*Gap:\*\* the institution's QI-versus-research determination policy has not been supplied/);
    expect(row.memo).toContain("Dr. J. Oyelaran");
  });

  it("cites the policy by title and version once the institution supplies it", async () => {
    const doc = await db.libraryDoc.findUniqueOrThrow({ where: { slug: IRB_POLICY_SLUG } });
    await db.libraryDoc.update({ where: { id: doc.id }, data: { isLocal: false } });
    try {
      const id = await as(trainee, () => runPrecheck(trainee, flagshipId, { ...answers, purpose: "both" }));
      created.prechecks.push(id);
      const row = await db.irbPrecheck.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ outcome: "ambiguous", policyDocId: doc.id, policyDocVersion: doc.version });
      expect(row.memo).toContain(`**${doc.title}**, version ${doc.version}`);
      expect(row.memo).not.toMatch(/Gap:/);
    } finally {
      await db.libraryDoc.update({ where: { id: doc.id }, data: { isLocal: doc.isLocal } });
    }
  });

  it("refuses an incomplete screening, and keeps each screening unedited", async () => {
    await expect(as(trainee, () => runPrecheck(trainee, flagshipId, { ...answers, extraData: "yes" }))).rejects.toThrow(/From whom\?/);
    await expect(as(surgeon, () => runPrecheck(surgeon, flagshipId, answers))).rejects.toBeInstanceOf(ProjectPermissionError);
    const id = created.prechecks[0]!;
    await expect(db.irbPrecheck.update({ where: { id }, data: { outcome: "likely_research" } })).rejects.toThrow(/cannot be edited/);
  });
});

describe.skipIf(!hasDb)("abstract drafts", () => {
  const venueId = "ihi-forum";

  it("saves over the limit and reports the count, but only under the venue's headings", async () => {
    const sections = ["Background", "Methods", "Results", "Conclusions"].map((heading) => ({ heading, text: "word ".repeat(100) }));
    const count = await as(trainee, () => saveAbstract(trainee, flagshipId, venueId, { title: "Drafting in the huddle", sections }));
    created.abstracts.push({ projectId: flagshipId, venueId });
    expect(count).toMatchObject({ total: 400, limit: 350, over: 50 });
    await expect(as(trainee, () => saveAbstract(trainee, flagshipId, venueId, { title: null, sections: sections.slice(1) }))).rejects.toBeInstanceOf(ProjectRuleError);
    await expect(as(trainee, () => saveAbstract(trainee, flagshipId, "no-such-venue", { title: null, sections }))).rejects.toThrow(/not in the venue list/);
  });

  it("passes every section through the PHI guard", async () => {
    const sections = ["Background", "Methods", "Results", "Conclusions"].map((heading) => ({ heading, text: heading === "Results" ? "One case, MRN 00123456, was excluded." : "Text." }));
    await expect(as(trainee, () => saveAbstract(trainee, flagshipId, venueId, { title: null, sections }))).rejects.toBeInstanceOf(PhiBlockedError);
  });
});
