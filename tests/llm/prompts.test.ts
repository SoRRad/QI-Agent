import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/spc";
import type { Observation } from "@/lib/spc";
import { renderPlaceholders } from "@/lib/llm/guards/numeric";
import { ALL_PROMPTS, chartInterpretationPrompt, interpretationValues } from "@/lib/llm/prompts";
import { runPrompt } from "@/lib/llm/run";
import { DISCHARGE_SERIES } from "@/prisma/demo-data";
import { mockDriver } from "@/lib/llm/drivers/mock";

/**
 * Prompts are reviewed by non-engineers, so every one must be described in
 * docs/PROMPTS.md. And every mock must pass its own prompt's real checks,
 * otherwise the demo shows behaviour the real provider path would reject.
 */

describe("prompt registry", () => {
  const doc = readFileSync(join(process.cwd(), "docs", "PROMPTS.md"), "utf8");

  it("has at least one prompt", () => {
    expect(ALL_PROMPTS.length).toBeGreaterThan(0);
  });

  for (const prompt of ALL_PROMPTS) {
    it(`documents ${prompt.id} in docs/PROMPTS.md`, () => {
      expect(doc).toContain(`\`${prompt.id}\``);
    });
  }

  it("uses unique ids", () => {
    const ids = ALL_PROMPTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

const observations: Observation[] = DISCHARGE_SERIES.map((p) => ({
  label: p.label,
  value: (p.num / p.den) * 100,
  numerator: p.num,
  denominator: p.den,
}));

const input = {
  measureName: "Discharge summaries signed >48h after discharge",
  unit: "%",
  analysis: analyse("run", observations),
  annotations: [{ label: "Discharge summary in the afternoon huddle", periodIndex: 13 }],
};

describe("chart interpretation on the seeded demo series", () => {
  it("never shows the model the data series", () => {
    const rendered = chartInterpretationPrompt.render(input);
    // The raw monthly values are absent; only computed results appear.
    expect(rendered).not.toContain("34.82");
    expect(rendered).not.toMatch(/"value"/);
    expect(rendered).toContain("Rules that fired:");
  });

  it("offers every value as a placeholder, formatted in TypeScript", () => {
    const values = interpretationValues(input);
    expect(values["centre_line"]).toBe("26.7%");
    expect(values["measure"]).toBe(input.measureName);
    expect(values["a0_period"]).toBe("Oct 2025");
  });

  it("produces a mock that passes the numeric guard and renders the engine's numbers", async () => {
    const output = await runPrompt(chartInterpretationPrompt, input, { userId: null }, {
      driver: mockDriver(),
      audit: async () => undefined,
    });

    // Raw output carries placeholders, not numbers. (Placeholder KEYS such as
    // {{v1_points}} contain digits by design; the prose around them may not.)
    expect(output.interpretation.replace(/\{\{[a-z0-9_]+\}\}/g, "")).not.toMatch(/\d/);
    expect(output.interpretation).toContain("{{");

    const rendered = renderPlaceholders(output.interpretation, interpretationValues(input));
    expect(rendered).toContain("12 consecutive points");
    expect(rendered).toContain("Oct 2025");
    expect(rendered).not.toContain("{{");
  });

  it("rejects a reply that restates a number, even a correct one", () => {
    const problem = chartInterpretationPrompt.refine?.(
      { interpretation: "The median is 26.7%, and there is a shift." },
      input,
    );
    expect(problem).toMatch(/digits/);
  });
});

describe("every mock satisfies its own prompt's checks", () => {
  it("chart interpretation, with and without signals", () => {
    const quiet = { ...input, analysis: analyse("run", observations.slice(0, 11)), annotations: [] };
    for (const case_ of [input, quiet]) {
      const output = chartInterpretationPrompt.mock(case_);
      expect(chartInterpretationPrompt.schema.safeParse(output).success).toBe(true);
      expect(chartInterpretationPrompt.refine?.(output, case_)).toBeNull();
    }
  });
});
