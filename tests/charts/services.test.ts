import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { mockDriver } from "@/lib/llm/drivers/mock";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "@/lib/phi/errors";
import { runWithContext } from "@/lib/request-context";
import { addAnnotation, addPoints, DataEntryError, removeLatestPoint } from "@/lib/charts/dataService";
import { confirmRestatement, DefinitionError, draftDataRequest, restateDefinition, saveDefinition } from "@/lib/charts/definitionService";
import { deprecateMeasure, LibraryError, promoteMeasure } from "@/lib/charts/libraryService";
import { interpretChart, loadMeasure, MeasureAccessError } from "@/lib/charts/service";

/**
 * The chart services against the TEST database with the mock provider. Each
 * test works on measures it creates, on a seeded project, and removes them
 * afterwards; the seeded demo series is only read.
 */

const hasDb = !!process.env["DATABASE_URL_TEST"];
const deps = { driver: mockDriver(), audit: async () => undefined };
const created: string[] = [];

let trainee: User;
let otherProgramTrainee: User;
let coach: User;
let chair: User;
let projectId = "";
let dischargeMeasure = "";

const as = <T>(user: User, fn: () => Promise<T>, acknowledged: string[] = []) =>
  runWithContext({ userId: user.id, acknowledgedPhi: new Set(acknowledged) }, fn);

const definition = {
  numerator: "Handoffs using every element of the standard template.",
  denominator: "All observed evening handoffs on the medicine wards in the week.",
  inclusions: "Resident-to-resident evening handoffs.",
  exclusions: "None.",
  dataSource: "Direct observation audit sheet",
  puller: "Chief resident",
  cadence: "weekly" as const,
};

async function measure(chartType: "p" | "c" | "xmr" = "p", isLibrary = false) {
  const m = await db.measure.create({
    data: { name: `Test measure ${created.length + 1}`, type: "process", chartType, isLibrary, projectId: isLibrary ? null : projectId },
  });
  created.push(m.id);
  return m.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
  trainee = await user("resident1.medicine@example.edu");
  otherProgramTrainee = await user("resident1.surgery@example.edu");
  coach = await user("coach.medicine@example.edu");
  chair = await user("chair@example.edu");
  const project = await db.project.findFirstOrThrow({ where: { title: "Discharge summary completion within 48 hours" } });
  projectId = project.id;
  dischargeMeasure = (await db.measure.findFirstOrThrow({ where: { name: "Discharge summaries signed >48h after discharge" } })).id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db.measure.updateMany({ where: { basedOnId: { in: created } }, data: { basedOnId: null } });
  await db.measure.deleteMany({ where: { id: { in: created } } });
});

describe.skipIf(!hasDb)("studio access", () => {
  it("shows another program the definition but not the data", async () => {
    const own = await loadMeasure(trainee, dischargeMeasure);
    expect(own.canSeeData).toBe(true);
    expect(own.points).toHaveLength(24);

    const other = await loadMeasure(otherProgramTrainee, dischargeMeasure);
    expect(other.canSeeData).toBe(false);
    expect(other.canEdit).toBe(false);
    expect(other.points).toEqual([]);
    expect(other.measure.definitions[0]?.numerator).toMatch(/48 hours/);
    await expect(interpretChart(otherProgramTrainee, dischargeMeasure, {}, deps)).rejects.toBeInstanceOf(MeasureAccessError);
  });

  it("explains the seeded chart with the engine's numbers filled in", async () => {
    const text = await as(trainee, () => interpretChart(trainee, dischargeMeasure, {}, deps));
    expect(text).toMatch(/Discharge summaries signed >48h after discharge shows a shift: 12 consecutive points/);
    expect(text).not.toMatch(/\{\{/);
    const frozen = await as(trainee, () => interpretChart(trainee, dischargeMeasure, { view: "control", baseline: "12" }, deps));
    expect(frozen).toMatch(/points fall outside the control limits set by the baseline from Oct 2024 to Sep 2025/);
  });
});

describe.skipIf(!hasDb)("data entry", () => {
  it("adds points with values computed in TypeScript, in order", async () => {
    const id = await measure("p");
    const result = await as(trainee, () =>
      addPoints(trainee, id, [
        { period: "Jan 2026", numerator: "12", denominator: "40" },
        { period: "Feb 2026", numerator: "9", denominator: "45" },
      ]),
    );
    expect(result).toEqual({ ok: true, added: 2, first: "Jan 2026", last: "Feb 2026" });
    const points = await db.dataPoint.findMany({ where: { measureId: id }, orderBy: { periodIndex: "asc" } });
    expect(points.map((p) => [p.periodIndex, p.periodLabel, p.value, p.subgroupSize])).toEqual([
      [1, "Jan 2026", 30, 40],
      [2, "Feb 2026", 20, 45],
    ]);

    // All or nothing: one bad row and nothing is written.
    const rejected = await as(trainee, () =>
      addPoints(trainee, id, [
        { period: "Mar 2026", numerator: "5", denominator: "50" },
        { period: "Feb 2026", numerator: "5", denominator: "50" },
      ]),
    );
    expect(rejected.ok).toBe(false);
    expect(await db.dataPoint.count({ where: { measureId: id } })).toBe(2);
  });

  it("puts a period label through the PHI guard", async () => {
    const id = await measure("c");
    await expect(as(trainee, () => addPoints(trainee, id, [{ period: "MRN 12345678", numerator: "3" }]))).rejects.toBeInstanceOf(PhiBlockedError);
    await expect(as(trainee, () => addPoints(trainee, id, [{ period: "Week of 3 March 2026", numerator: "3" }]))).rejects.toBeInstanceOf(
      PhiAcknowledgementRequiredError,
    );
    expect(await db.dataPoint.count({ where: { measureId: id } })).toBe(0);
  });

  it("refuses data entry to another program, and to a library definition", async () => {
    const id = await measure("c");
    await expect(as(otherProgramTrainee, () => addPoints(otherProgramTrainee, id, [{ period: "Jan 2026", numerator: "3" }]))).rejects.toBeInstanceOf(
      MeasureAccessError,
    );
    const library = await measure("c", true);
    await expect(as(chair, () => addPoints(chair, library, [{ period: "Jan 2026", numerator: "3" }]))).rejects.toBeInstanceOf(MeasureAccessError);
  });

  it("removes only the latest point, and annotates only plotted periods", async () => {
    const id = await measure("xmr");
    await as(coach, () => addPoints(coach, id, [{ period: "Week 1", value: "41" }, { period: "Week 2", value: "38.5" }]));
    expect(await as(coach, () => removeLatestPoint(coach, id))).toBe("Week 2");
    expect(await db.dataPoint.count({ where: { measureId: id } })).toBe(1);

    await as(trainee, () => addAnnotation(trainee, id, { label: "Template launched", description: null, periodIndex: 1, date: new Date("2026-01-05T00:00:00Z") }));
    await expect(
      as(trainee, () => addAnnotation(trainee, id, { label: "Later change", description: null, periodIndex: 9, date: new Date("2026-02-01T00:00:00Z") })),
    ).rejects.toBeInstanceOf(DataEntryError);
  });
});

describe.skipIf(!hasDb)("operational definitions", () => {
  it("appends versions and refuses to save an unchanged one", async () => {
    const id = await measure("p");
    expect(await as(trainee, () => saveDefinition(trainee, id, definition))).toEqual({ version: 1 });
    await expect(as(trainee, () => saveDefinition(trainee, id, definition))).rejects.toBeInstanceOf(DefinitionError);
    expect(await as(trainee, () => saveDefinition(trainee, id, { ...definition, exclusions: "Handoffs during a code." }))).toEqual({ version: 2 });
    expect(await db.measureDefinition.count({ where: { measureId: id } })).toBe(2);
  });

  it("confirms exactly the restatement the server generated, once", async () => {
    const id = await measure("p");
    await as(trainee, () => saveDefinition(trainee, id, definition));
    const r = await as(trainee, () => restateDefinition(trainee, id, deps));
    expect(r.query).toMatch(/^For each week, start from all observed evening handoffs/);
    expect(r.confirmedAt).toBeNull();

    await expect(as(trainee, () => confirmRestatement(trainee, id, r.definitionId, "0".repeat(32)))).rejects.toThrow(/changed since you read it/);
    const confirmed = await as(trainee, () => confirmRestatement(trainee, id, r.definitionId, r.digest));
    expect(confirmed.query).toBe(r.query);

    const stored = await db.measureDefinition.findUniqueOrThrow({ where: { id: r.definitionId } });
    expect(stored.reproducibilityRestatement).toBe(r.query);
    expect(stored.reproducibilityConfirmedAt).not.toBeNull();
    // Asking again returns the confirmed evidence rather than regenerating it.
    expect((await as(trainee, () => restateDefinition(trainee, id, deps))).confirmedAt).not.toBeNull();
  });

  it("drafts a data request around dates computed in TypeScript", async () => {
    const id = await measure("p");
    await as(trainee, () => saveDefinition(trainee, id, definition));
    const { document, markdown } = await as(trainee, () =>
      draftDataRequest(trainee, id, { from: "2025-09", to: "2026-08" }, deps, new Date("2026-09-22T00:00:00Z")),
    );
    expect(document.range).toMatchObject({ fromText: "1 September 2025", toText: "31 August 2026", periods: 53, periodName: "weeks" });
    expect(document.columns.map((c) => c.name)).toEqual(["period_start", "period_end", "numerator", "denominator"]);
    expect(markdown).toContain("Aggregate counts only");
    await expect(
      as(trainee, () => draftDataRequest(trainee, id, { from: "2026-01", to: "2026-09" }, deps, new Date("2026-09-22T00:00:00Z"))),
    ).rejects.toThrow(/last complete month/);
  });
});

describe.skipIf(!hasDb)("measure library", () => {
  it("lets only the chair promote, and links the project measure to the library copy", async () => {
    const id = await measure("p");
    await as(trainee, () => saveDefinition(trainee, id, definition));
    await expect(as(trainee, () => promoteMeasure(trainee, id))).rejects.toBeInstanceOf(LibraryError);

    const library = await as(chair, () => promoteMeasure(chair, id));
    created.push(library.id);
    const copy = await db.measure.findUniqueOrThrow({ where: { id: library.id }, include: { definitions: true } });
    expect(copy.isLibrary).toBe(true);
    expect(copy.promotedById).toBe(chair.id);
    expect(copy.definitions[0]?.numerator).toBe(definition.numerator);
    expect((await db.measure.findUniqueOrThrow({ where: { id } })).basedOnId).toBe(library.id);
    await expect(as(chair, () => promoteMeasure(chair, id))).rejects.toThrow(/already built on/);
  });

  it("supersedes a library measure with a reason, and the project chart can see it", async () => {
    const old = await measure("p", true);
    const replacement = await measure("p", true);
    const project = await measure("p");
    await db.measure.update({ where: { id: project }, data: { basedOnId: old } });

    await expect(as(chair, () => deprecateMeasure(chair, { measureId: old, note: "too short", supersededById: null }))).rejects.toThrow(/at least 20/);
    await as(chair, () =>
      deprecateMeasure(chair, { measureId: old, note: "Observation stays now count as readmissions.", supersededById: replacement }),
    );
    const loaded = await loadMeasure(trainee, project);
    expect(loaded.measure.basedOn).toMatchObject({ deprecated: true, deprecationNote: "Observation stays now count as readmissions." });
    expect(loaded.measure.basedOn?.supersededBy?.id).toBe(replacement);
  });
});
