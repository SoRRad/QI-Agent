import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATE_EXEMPT_FIELDS, NAME_EXEMPT_FIELDS, scanWriteData } from "@/lib/phi/guard";

/**
 * The guard walks a Prisma write payload and scans every string in it. The
 * default is to SCAN — a field added to the schema later is covered without
 * anyone remembering to register it.
 */

const rulesAt = (flags: ReturnType<typeof scanWriteData>) =>
  flags.map((f) => `${f.tier}:${f.rule}@${f.path}`);

describe("what the guard scans", () => {
  it("scans top-level string fields", () => {
    const flags = scanWriteData("PdsaCycle", { plan: "call 555-867-5309", number: 1 });
    expect(rulesAt(flags)).toEqual(["block:phone@plan"]);
  });

  it("scans nested relation writes", () => {
    const flags = scanWriteData("Measure", {
      name: "Readmissions",
      definitions: {
        create: { version: 1, numerator: "MRN 00123456", denominator: "all discharges" },
      },
    });
    expect(rulesAt(flags)).toEqual(["block:identifier_digits@definitions.create.numerator"]);
  });

  it("scans createMany arrays", () => {
    const flags = scanWriteData("DataPoint", {
      data: [{ periodLabel: "Oct 2024" }, { notes: "patient Maria Gonzalez" }],
    });
    expect(rulesAt(flags)).toEqual(["warn:name_after_title@data.1.notes"]);
  });

  it("scans `set` operations on scalar updates", () => {
    const flags = scanWriteData("Project", { obstacleNotes: { set: "SSN 123-45-6789" } });
    expect(rulesAt(flags)).toEqual(["block:ssn@obstacleNotes.set"]);
  });

  it("scans string arrays", () => {
    const flags = scanWriteData("Handoff", { nextActions: ["write the prediction", "bed 14 audit"] });
    expect(rulesAt(flags)).toEqual(["warn:room_bed@nextActions.1"]);
  });

  it("scans strings inside JSON values", () => {
    const flags = scanWriteData("JudgeScore", { rubricScores: { notes: "call 555-867-5309" } });
    expect(rulesAt(flags)).toEqual(["block:phone@rubricScores.notes"]);
  });

  it("scans a field it has never heard of, because the default is to scan", () => {
    const flags = scanWriteData("SomeFutureModel", { someNewField: "SSN 123-45-6789" });
    expect(rulesAt(flags)).toEqual(["block:ssn@someNewField"]);
  });
});

describe("what the guard skips", () => {
  it("skips identifiers and foreign keys", () => {
    // A 10-digit ACGME program ID is an identifier of a PROGRAM, and a cuid
    // foreign key is not prose.
    expect(scanWriteData("Program", { acgmeId: "1401200001", id: "123456789012" })).toEqual([]);
    expect(scanWriteData("Project", { programId: "123456789" })).toEqual([]);
  });

  it("skips where-filters and relation links", () => {
    expect(
      scanWriteData("Project", {
        coach: { connect: { email: "555-867-5309@example.edu" } },
        measures: { update: { where: { name: "123-45-6789" }, data: { name: "Readmissions" } } },
      }),
    ).toEqual([]);
  });

  it("skips dates, numbers and booleans", () => {
    expect(scanWriteData("PdsaCycle", { completedAt: new Date(), number: 123456789, active: true })).toEqual([]);
  });
});

describe("field exemptions", () => {
  it("skips name patterns for structured staff-name fields", () => {
    expect(scanWriteData("Project", { clinicalOwner: "Dr. Hannah Vasquez, Medical Director" })).toEqual([]);
  });

  it("still scans the free-text sibling of a name-exempt field", () => {
    const flags = scanWriteData("Project", {
      clinicalOwner: "Dr. Hannah Vasquez",
      obstacleNotes: "Dr. Hannah Vasquez asked about Mr. John Smith",
    });
    expect(rulesAt(flags)).toEqual([
      "warn:name_after_title@obstacleNotes",
      "warn:name_after_title@obstacleNotes",
    ]);
  });

  it("lets an aim statement carry its required calendar deadline", () => {
    const aim =
      "Reduce late summaries from 34% (baseline, 1 October 2024 – 30 September 2025) to 15% by 30 June 2027.";
    expect(scanWriteData("AimStatement", { text: aim, baselinePeriod: "1 October 2024 – 30 September 2025" })).toEqual([]);
    // The same sentence in a PDSA note is a warning.
    expect(scanWriteData("PdsaCycle", { plan: aim }).length).toBe(3);
  });
});

describe("fingerprints", () => {
  it("identify a flag without containing its text", () => {
    const [flag] = scanWriteData("PdsaCycle", { plan: "seen on 14 March 2025" });
    expect(flag?.fingerprint).toMatch(/^[0-9a-f]{24}$/);
    expect(flag?.fingerprint).not.toContain("March");
  });

  it("change when the flagged text changes", () => {
    const [a] = scanWriteData("PdsaCycle", { plan: "seen on 14 March 2025" });
    const [b] = scanWriteData("PdsaCycle", { plan: "seen on 15 March 2025" });
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });

  it("are stable for the same text in the same place", () => {
    const [a] = scanWriteData("PdsaCycle", { plan: "seen on 14 March 2025" });
    const [b] = scanWriteData("PdsaCycle", { plan: "seen on 14 March 2025" });
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });
});

/**
 * Exemptions are keyed by field NAME. That is only safe while each exempt
 * name means the same thing everywhere it appears, so this test parses the
 * schema and fails if a model not listed here gains a field with an exempt
 * name. A failure is a prompt for a decision, not something to paper over.
 */
describe("exempt field names match the schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const models = new Map<string, Set<string>>();
  for (const block of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name = "", body = ""] = block;
    const fields = new Set<string>();
    for (const line of body.split("\n")) {
      const field = /^\s{2}(\w+)\s+\w/.exec(line)?.[1];
      if (field) fields.add(field);
    }
    models.set(name, fields);
  }

  const modelsWith = (field: string) =>
    [...models.entries()].filter(([, fields]) => fields.has(field)).map(([model]) => model).sort();

  for (const [field, expected] of Object.entries({ ...NAME_EXEMPT_FIELDS, ...DATE_EXEMPT_FIELDS })) {
    it(`"${field}" appears only on ${expected.join(", ")}`, () => {
      expect(modelsWith(field)).toEqual([...expected].sort());
    });
  }
});
