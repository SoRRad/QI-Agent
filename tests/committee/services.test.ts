import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { Prisma, type User } from "@/lib/generated/prisma/client";
import { mockDriver } from "@/lib/llm/drivers/mock";
import { PhiBlockedError } from "@/lib/phi/errors";
import { runWithContext } from "@/lib/request-context";
import { parseCsv } from "@/lib/csv";
import { RUBRIC } from "@/lib/committee/rubric";
import { DRAFT_LABEL } from "@/lib/committee/milestones";
import { CommitteeAccessError, CommitteeRuleError } from "@/lib/committee/services/access";
import { clerMock, createClerMock, recordClerResponse } from "@/lib/committee/services/cler";
import { assignCoach, coachBoard } from "@/lib/committee/services/coaches";
import { curriculumExport, curriculumTracker, importCurriculum } from "@/lib/committee/services/curriculum";
import { dashboard } from "@/lib/committee/services/dashboard";
import { assignJudge, generateKit, judgingBoard, judgingExport, myAssignments, submitScore, unassignJudge } from "@/lib/committee/services/events";
import { draftMilestones, milestoneDrafts, milestoneFacts } from "@/lib/committee/services/milestones";
import { annualReport } from "@/lib/committee/services/report";

/**
 * Phase 8 against the seeded test database. Exit criteria: the dashboard
 * opens with an annotated run chart; institution measures appear only as run
 * charts; milestone output is marked as a draft requiring PD review; the
 * judging export handles the seeded tie.
 */

const hasDb = !!process.env["DATABASE_URL_TEST"];
const llm = { driver: mockDriver(), audit: async () => undefined };

let chair: User;
let coachMed: User;
let coachSurg: User;
let trainee: User;
let symposiumId: string;
let dischargeId: string;
let sepsisSubmissionId: string;
const created = { events: [] as string[], curriculum: [] as string[] };

const as = <T>(user: User, fn: () => Promise<T>, acknowledged: string[] = []) => runWithContext({ userId: user.id, acknowledgedPhi: new Set(acknowledged) }, fn);
const sheet = (...s: number[]) => Object.fromEntries(RUBRIC.map((c, i) => [c.id, String(s[i])]));

beforeAll(async () => {
  if (!hasDb) return;
  const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
  [chair, coachMed, coachSurg, trainee] = await Promise.all([
    user("chair@example.edu"),
    user("coach.medicine@example.edu"),
    user("coach.surgery@example.edu"),
    user("resident1.medicine@example.edu"),
  ]);
  symposiumId = (await db.event.findFirstOrThrow({ where: { type: "symposium" } })).id;
  dischargeId = (
    await db.project.findFirstOrThrow({
      where: { title: "Discharge summary completion within 48 hours" },
    })
  ).id;
  sepsisSubmissionId = (
    await db.submission.findFirstOrThrow({
      where: {
        eventId: symposiumId,
        project: { title: { startsWith: "Time to first antibiotic" } },
      },
    })
  ).id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db.event.deleteMany({ where: { id: { in: created.events } } });
  await db.curriculumRecord.deleteMany({
    where: { id: { in: created.curriculum } },
  });
  await db.judgeScore.deleteMany({
    where: { submissionId: sepsisSubmissionId, judgeId: coachSurg.id },
  });
  await db.milestoneMap.deleteMany({ where: { projectId: dischargeId } });
  await db.event
    .update({
      where: { id: symposiumId },
      data: { kit: Prisma.DbNull, kitGeneratedAt: null },
    })
    .catch(() => undefined);
});

describe.skipIf(!hasDb)("chair dashboard (exit criteria)", () => {
  it("opens with the headline measure as an annotated run chart, median frozen before the first intervention", async () => {
    const d = await dashboard(chair);
    expect(d.headline).not.toBeNull();
    expect(d.headline!.name).toMatch(/^Discharge summaries signed more than 48 hours after discharge/);
    expect(d.headline!.chart.kind).toBe("run");
    expect(d.headline!.annotations.map((a) => a.periodIndex)).toEqual([14, 23]);
    expect(d.headline!.baseline).toBe(13);
    expect(d.headline!.chart.analysis.violations.map((v) => v.rule)).toContain("shift");
  });

  it("plots every institution-level measure as a run chart, never anything else", async () => {
    const d = await dashboard(chair);
    for (const chart of [d.headline!, ...d.others]) expect(chart.chart.kind).toBe("run");
    // The pulse rate waits for a second quarter rather than plotting one point.
    expect(d.pulseChart).toBeNull();
    expect(d.pulse).toHaveLength(1);
  });

  it("is the committee's; curriculum completion on it is the chair's", async () => {
    expect((await dashboard(coachMed)).curriculum).toBeNull();
    expect((await dashboard(chair)).curriculum!.length).toBeGreaterThan(0);
    await expect(dashboard(trainee)).rejects.toBeInstanceOf(CommitteeAccessError);
  });
});

describe.skipIf(!hasDb)("judging (exit criterion: the export handles the seeded tie)", () => {
  it("ranks the seeded tie as a shared first place, and holds back the submission a judge has not scored", async () => {
    const { results } = await judgingBoard(chair, symposiumId);
    expect(results.map((r) => [r.rank, r.tied, r.status])).toEqual([
      [1, true, "complete"],
      [1, true, "complete"],
      [null, false, "awaiting_scores"],
    ]);
    const { csv, filename } = await judgingExport(chair, symposiumId);
    expect(filename).toBe("autumn-gme-quality-improvement-symposium-results.csv");
    const rows = parseCsv(csv).rows;
    expect(rows.map((r) => r.slice(0, 2))).toEqual([
      ["1", "yes"],
      ["1", "yes"],
      ["", "no"],
    ]);
    expect(rows[0]![8]).toBe("54.50");
  });

  it("never assigns a judge a project they coach, and takes scores only from assigned judges", async () => {
    const discharge = await db.submission.findFirstOrThrow({
      where: { eventId: symposiumId, projectId: dischargeId },
    });
    await expect(assignJudge(chair, discharge.id, coachMed.id)).rejects.toThrow(/coaches this project/);
    await expect(submitScore(coachMed, discharge.id, sheet(5, 5, 5, 5, 5, 5))).rejects.toBeInstanceOf(CommitteeAccessError);
    await expect(assignJudge(coachMed, discharge.id, coachSurg.id)).rejects.toBeInstanceOf(CommitteeAccessError);
    await expect(judgingBoard(coachMed, symposiumId)).rejects.toBeInstanceOf(CommitteeAccessError);
  });

  it("ranks the last submission once its last judge scores, and then keeps the scored assignment", async () => {
    const mine = await myAssignments(coachSurg);
    expect(mine.map((a) => a.submissionId)).toContain(sepsisSubmissionId);
    await expect(
      submitScore(coachSurg, sepsisSubmissionId, {
        ...sheet(3, 3, 3, 3, 3, 3),
        results: "7",
      }),
    ).rejects.toBeInstanceOf(CommitteeRuleError);
    expect(await submitScore(coachSurg, sepsisSubmissionId, sheet(3, 3, 3, 3, 3, 3))).toBe(36);
    const { results } = await judgingBoard(chair, symposiumId);
    expect(results.map((r) => r.rank)).toEqual([1, 1, 3]);
    await expect(unassignJudge(chair, sepsisSubmissionId, coachSurg.id)).rejects.toThrow(/already scored/);
  });

  it("generates the event kit from the record, as a stored snapshot", async () => {
    await as(chair, () => generateKit(chair, symposiumId));
    const event = await db.event.findUniqueOrThrow({
      where: { id: symposiumId },
    });
    expect(event.kitGeneratedAt).not.toBeNull();
    expect((event.kit as string[]).map((s) => s.split("\n")[0])).toEqual(["## Agenda", "## Invitation", "## Slide skeleton", "## Judging rubric", "## Feedback form"]);
    await expect(generateKit(coachMed, symposiumId)).rejects.toBeInstanceOf(CommitteeAccessError);
  });
});

describe.skipIf(!hasDb)("curriculum", () => {
  it("imports all or nothing, never clears a completion, and exports what it tracks", async () => {
    const before = await db.curriculumRecord.count();
    await expect(
      as(chair, () =>
        importCurriculum(chair, "email,item,completed_on\nresident1.medicine@example.edu,Sustainability workshop,2026-05-01\nnobody@example.edu,Sustainability workshop,\n"),
      ),
    ).rejects.toThrow(/Nothing was imported. Line 3/);
    expect(await db.curriculumRecord.count()).toBe(before);

    const summary = await as(chair, () =>
      importCurriculum(
        chair,
        // The flagship lead has "QI Fundamentals module" complete in the seed: a blank here must not undo it.
        "email,item,completed_on\nresident1.medicine@example.edu,Sustainability workshop,2026-05-01\nresident2.medicine@example.edu,Sustainability workshop,\nresident1.medicine@example.edu,QI Fundamentals module,\n",
      ),
    );
    created.curriculum.push(
      ...(
        await db.curriculumRecord.findMany({
          where: { item: "Sustainability workshop" },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    expect(summary).toEqual({
      rows: 3,
      created: 2,
      completed: 1,
      unchanged: 1,
    });
    const kept = await db.curriculumRecord.findFirstOrThrow({
      where: { userId: trainee.id, item: "QI Fundamentals module" },
    });
    expect(kept.completedAt).not.toBeNull();

    const t = await curriculumTracker(chair);
    expect(t.items).toContain("Sustainability workshop");
    expect(await as(chair, () => curriculumExport(chair))).toMatch(/^program,trainee,email,item,completed_on\r\n/);
    await expect(curriculumTracker(coachMed)).rejects.toBeInstanceOf(CommitteeAccessError);
  });
});

describe.skipIf(!hasDb)("milestone mapper (exit criterion: output marked as draft requiring PD review)", () => {
  it("drafts from keyed facts, stores every entry as a draft, and is the chair's and the project's coach's", async () => {
    const facts = await milestoneFacts(chair, dischargeId, trainee.id);
    expect(facts[0]).toMatchObject({ key: "F1", kind: "role" });
    expect(facts.some((f) => f.kind === "data" && /Run chart of 24 points/.test(f.text))).toBe(true);

    const n = await as(chair, () => draftMilestones(chair, dischargeId, trainee.id, llm));
    expect(n).toBeGreaterThan(0);
    const drafts = await milestoneDrafts(coachMed, dischargeId);
    expect(drafts).toHaveLength(n);
    for (const d of drafts) {
      expect(d.status).toBe(DRAFT_LABEL);
      expect(d.pdReviewedAt).toBeNull();
      expect(d.evidenceText).toMatch(/Drawn from the record:/);
      expect(d.evidenceText).not.toMatch(/\blevel\b/i);
    }
    await expect(milestoneDrafts(coachSurg, dischargeId)).rejects.toBeInstanceOf(CommitteeAccessError);
    await expect(milestoneFacts(chair, dischargeId, coachMed.id)).rejects.toBeInstanceOf(CommitteeRuleError);
  });
});

describe.skipIf(!hasDb)("CLER mock", () => {
  it("drafts questions across all six focus areas, records answers by role, and refuses PHI", async () => {
    const id = await as(chair, () =>
      createClerMock(
        chair,
        {
          title: "Mock walkaround test",
          date: "2026-10-05",
          setting: "surgical wards",
        },
        llm,
      ),
    );
    created.events.push(id);
    const { event, gaps } = await clerMock(coachMed, id);
    expect(new Set(event.clerQuestions.map((q) => q.domain)).size).toBe(6);
    expect(gaps.every((g) => g.reading === "unanswered")).toBe(true);

    const q = event.clerQuestions.find((x) => x.domain === "supervision")!;
    await as(coachMed, () =>
      recordClerResponse(coachMed, q.id, {
        respondent: "PGY-1 resident",
        response: "I would ask my senior first.",
        rating: "unable",
        notes: "",
      }),
    );
    expect((await clerMock(chair, id)).gaps.find((g) => g.domain === "supervision")!.reading).toBe("gap");

    await expect(
      as(coachMed, () =>
        recordClerResponse(coachMed, q.id, {
          respondent: "PGY-1 resident",
          response: "The patient with MRN 00123456 was the example.",
          rating: "partial",
          notes: "",
        }),
      ),
    ).rejects.toBeInstanceOf(PhiBlockedError);
    await expect(createClerMock(coachMed, { title: "Not mine", date: "2026-10-05", setting: "wards" }, llm)).rejects.toBeInstanceOf(CommitteeAccessError);
  });
});

describe.skipIf(!hasDb)("coach matching", () => {
  it("suggests coaches with reasons, and only the chair assigns", async () => {
    const board = await coachBoard(coachMed);
    const project = board.projects.find((p) => p.suggestions.length > 0)!;
    expect(project.suggestions[0]!.reasons.length).toBeGreaterThan(0);
    await expect(assignCoach(coachMed, project.id, coachSurg.id)).rejects.toBeInstanceOf(CommitteeAccessError);
  });
});

describe.skipIf(!hasDb)("annual report", () => {
  it("reads the headline as the dashboard does, and is the chair's", async () => {
    const report = await annualReport(chair, 2025, new Date("2026-09-25T00:00:00Z"));
    expect(report.title).toBe("QI committee annual report — academic year 2025–26");
    const headline = report.sections.find((s) => s.heading === "Headline measure")!.lines.join("\n");
    expect(headline).toMatch(/Baseline median 30\.9%, frozen from Oct 2024 to Oct 2025/);
    expect(headline).toMatch(/Nov 2025: Committee: huddle drafting adopted/);
    expect(headline).not.toMatch(/GMEC: named analyst liaison/); // Aug 2026 is next year's
    await expect(annualReport(coachMed, 2025)).rejects.toBeInstanceOf(CommitteeAccessError);
  });
});
