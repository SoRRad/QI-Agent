import { describe, expect, it } from "vitest";
import { definitionSchema, missingFields } from "@/lib/charts/definition";
import { defaultRange, outputColumns, requestMarkdown, resolveRange } from "@/lib/charts/dataRequest";
import { sourceNumbersGuard } from "@/lib/llm/guards/sourceNumbers";
import { runPrompt } from "@/lib/llm/run";
import { mockDriver } from "@/lib/llm/drivers/mock";
import { dataRequestPrompt, definitionRestatementPrompt } from "@/lib/llm/prompts";

const complete = {
  numerator: "Discharge summaries with a signature timestamp more than 48 hours after the recorded discharge time.",
  denominator: "All discharge summaries for Hospitalist discharges in the calendar month.",
  inclusions: "Adult inpatients discharged from the Hospitalist service.",
  exclusions: "Deaths; transfers to another acute facility.",
  dataSource: "EHR documentation report DSR-114",
  puller: "Decision Support analyst",
  cadence: "monthly",
};

describe("operational definition", () => {
  it("accepts a complete definition", () => {
    expect(definitionSchema.safeParse(complete).success).toBe(true);
    expect(missingFields(complete)).toEqual([]);
  });

  it("refuses to save until all seven parts are present", () => {
    for (const field of Object.keys(complete) as Array<keyof typeof complete>) {
      const draft = { ...complete, [field]: field === "cadence" ? "" : "  " };
      const parsed = definitionSchema.safeParse(draft);
      expect(parsed.success, field).toBe(false);
      expect(missingFields(draft)).toEqual([field]);
    }
    expect(missingFields({})).toHaveLength(7);
  });

  it("does not accept a made-up cadence", () => {
    expect(definitionSchema.safeParse({ ...complete, cadence: "fortnightly-ish" }).success).toBe(false);
  });
});

describe("source-numbers guard", () => {
  const source = "Potassium below 3.0 or above 5.5, identified more than 24 hours late. Reviewed 1,240 charts.";

  it("allows repeating a number from the source, exactly", () => {
    expect(sourceNumbersGuard("Count potassium results below 3.0 found more than 24 hours late.", source)).toBeNull();
    expect(sourceNumbersGuard("Across the 1240 charts reviewed.", source)).toBeNull();
  });

  it("rejects a number the source does not contain", () => {
    expect(sourceNumbersGuard("Count results below 3.5.", source)).toMatch(/3\.5/);
    expect(sourceNumbersGuard("Within 48 hours.", source)).toMatch(/48/);
  });

  it("rejects a number written as a word unless the source used that word", () => {
    expect(sourceNumbersGuard("Within two days.", source)).toMatch(/two/);
    expect(sourceNumbersGuard("Within two days.", "Two days after discharge.")).toBeNull();
  });
});

describe("data request dates, computed in TypeScript", () => {
  const today = new Date("2026-09-22T12:00:00Z");

  it("defaults to the last 24 complete months", () => {
    expect(defaultRange(today)).toEqual({ from: "2024-09", to: "2026-08" });
  });

  it("describes the range and counts its periods", () => {
    const r = resolveRange({ from: "2024-10", to: "2026-08" }, "monthly", today);
    expect(r).toEqual({ ok: true, range: { fromText: "1 October 2024", toText: "31 August 2026", months: 23, periods: 23, periodName: "months" } });
    const q = resolveRange({ from: "2025-01", to: "2025-12" }, "quarterly", today);
    expect(q.ok && q.range.periods).toBe(4);
    const leap = resolveRange({ from: "2024-02", to: "2024-02" }, "monthly", today);
    expect(leap.ok && leap.range.toText).toBe("29 February 2024");
  });

  it("refuses ranges that are backwards, too long, or not finished yet", () => {
    expect(resolveRange({ from: "2026-01", to: "2025-01" }, "monthly", today)).toMatchObject({ ok: false });
    expect(resolveRange({ from: "2010-01", to: "2026-08" }, "monthly", today)).toMatchObject({ ok: false });
    expect(resolveRange({ from: "2026-01", to: "2026-09" }, "monthly", today)).toMatchObject({ ok: false, error: expect.stringMatching(/last complete month/) });
    expect(resolveRange({ from: "2026-13", to: "2026-09" }, "monthly", today)).toMatchObject({ ok: false });
  });

  it("asks for aggregate columns that the CSV upload can map", () => {
    expect(outputColumns("p", "monthly").map((c) => c.name)).toEqual(["period_start", "period_end", "numerator", "denominator"]);
    expect(outputColumns("u", "monthly").map((c) => c.name)).toEqual(["period_start", "period_end", "events", "exposure"]);
    expect(outputColumns("xmr", "weekly").map((c) => c.name)).toEqual(["period_start", "period_end", "value", "cases"]);
  });
});

describe("chart prompts on the mock provider", () => {
  const deps = { driver: mockDriver(), audit: async () => undefined };
  const restatementInput = { measureName: "Discharge summaries signed >48h after discharge", chartType: "p", ...complete };

  it("restates a definition without adding a number, and passes the PHI scanner clean", async () => {
    const output = await runPrompt(definitionRestatementPrompt, restatementInput, { userId: null }, deps);
    expect(output.query).toMatch(/^For each calendar month, start from all discharge summaries/);
    expect(output.query).toContain("more than 48 hours");
    expect(definitionRestatementPrompt.refine?.(output, restatementInput)).toBeNull();
  });

  it("rejects a restatement that invents a threshold or names someone", () => {
    const bad = { query: "For each calendar month, count summaries signed more than 72 hours after discharge, divided by the total.", ambiguities: [] };
    expect(definitionRestatementPrompt.refine?.(bad, restatementInput)).toMatch(/72/);
    const named = { query: "For each calendar month, patient John Smith's summaries are counted when signed more than 48 hours late.", ambiguities: [] };
    expect(definitionRestatementPrompt.refine?.(named, restatementInput)).toMatch(/identify/);
  });

  it("drafts a data request whose numbers all come from the definition or the dates", async () => {
    const input = {
      ...restatementInput,
      problemStatement: "Late discharge summaries delay follow-up.",
      aimText: "Reduce late summaries from 34% to 15% by 30 June 2027.",
      rangeText: "1 October 2024 to 31 August 2026 (23 months)",
    };
    const output = await runPrompt(dataRequestPrompt, input, { userId: null }, deps);
    expect(output.clinicalQuestion.split(/(?<=[.?!])\s+/)).toHaveLength(1);
    expect(dataRequestPrompt.refine?.({ ...output, filters: ["Only discharges after 2019"] }, input)).toMatch(/2019/);
    expect(dataRequestPrompt.refine?.({ ...output, fields: [...output.fields, { name: "MRN", purpose: "to link" }] }, input)).toMatch(/identifier/);

    const markdown = requestMarkdown({
      measureName: input.measureName,
      requestedBy: "Resident, Internal Medicine",
      clinicalQuestion: output.clinicalQuestion,
      range: { fromText: "1 October 2024", toText: "31 August 2026", months: 23, periods: 23, periodName: "months" },
      cadence: "monthly",
      columns: outputColumns("p", "monthly"),
      definition: { ...complete },
      systems: output.systems,
      fields: output.fields,
      filters: output.filters,
      questions: output.questions,
    });
    expect(markdown).toContain("**Date range.** 1 October 2024 to 31 August 2026: 23 months.");
    expect(markdown).toContain("`numerator` — Count of cases meeting the numerator definition");
    expect(markdown).toMatch(/Aggregate counts only/);
  });
});
