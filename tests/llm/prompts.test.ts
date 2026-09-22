import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/spc";
import type { Observation } from "@/lib/spc";
import { renderPlaceholders } from "@/lib/llm/guards/numeric";
import {
  ALL_PROMPTS,
  askAnswerPrompt,
  chartInterpretationPrompt,
  devilsAdvocatePrompt,
  interpretationValues,
  tutorPrompt,
} from "@/lib/llm/prompts";
import { loadLibraryDocs } from "@/lib/content";
import { validateAim } from "@/lib/aim/validate";
import { projectFacts } from "@/lib/projects/facts";
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

describe("every mock satisfies its own prompt's checks (Ask)", () => {
  const documents = loadLibraryDocs().map((d, i) => ({ id: `doc${i}`, title: d.title, isLocal: d.isLocal, body: d.body }));

  for (const question of [
    "What are the five required elements of an aim statement?",
    "Do I need an IRB determination before collecting data?",
    "What parking permit do residents get?",
  ]) {
    it(`ask.answer: "${question}"`, () => {
      const output = askAnswerPrompt.mock({ question, documents });
      expect(askAnswerPrompt.schema.safeParse(output).success).toBe(true);
      expect(askAnswerPrompt.refine?.(output, { question, documents })).toBeNull();
    });
  }

  it("ask.answer rejects a quote that is not in the cited document", () => {
    const output = {
      status: "answered" as const,
      answer: "x",
      citations: [{ documentId: "doc0", quote: "This sentence appears in no document at all." }],
    };
    expect(askAnswerPrompt.refine?.(output, { question: "q", documents })).toMatch(/does not appear/);
  });

  it("ask.answer rejects a citation to a document it was not given", () => {
    const output = {
      status: "answered" as const,
      answer: "x",
      citations: [{ documentId: "invented", quote: "Anything at all, really." }],
    };
    expect(askAnswerPrompt.refine?.(output, { question: "q", documents })).toMatch(/not provided/);
  });

  it("ask.tutor, across several turns", () => {
    const aimCheck = validateAim({ text: "Improve handoffs in the ICU this year." });
    const project = { title: "t", problemStatement: "p", aimText: "a", aimCheck };
    const history: Array<{ role: "tutor" | "trainee"; text: string }> = [];
    for (let i = 0; i < 8; i += 1) {
      const output = tutorPrompt.mock({ project, history });
      expect(tutorPrompt.refine?.(output, { project, history }), output.question).toBeNull();
      history.push({ role: "tutor", text: output.question }, { role: "trainee", text: "ok" });
    }
  });

  it("ask.tutor rejects a reply that writes the aim", () => {
    const input = { project: null, history: [] };
    expect(
      tutorPrompt.refine?.({ question: "Try this: reduce falls from 3.1 to 2.0 by June. Does that work?" }, input),
    ).toMatch(/aim statement/);
    expect(tutorPrompt.refine?.({ question: "What number? And by when?" }, input)).toMatch(/exactly one question/);
  });

  it("ask.devils_advocate, for a weak and a strong record", () => {
    const weak = projectFacts({
      title: "Weak",
      problemStatement: "p",
      clinicalOwner: null,
      coachId: null,
      aim: { text: "Improve things.", baselineValue: null, baselinePeriod: null, target: null, deadline: null, population: null },
      measures: [],
      pdsaCycles: [],
    });
    const strong = projectFacts({
      title: "Strong",
      problemStatement: "p",
      clinicalOwner: "Dr. Owner",
      coachId: "c",
      aim: {
        text: "Reduce X from 34% to 15% by 30 June 2030.",
        baselineValue: 34,
        baselinePeriod: "2024",
        target: 15,
        deadline: new Date("2030-06-30"),
        population: "Adult patients on the ward",
      },
      measures: [
        { name: "o", type: "outcome", dataPoints: 24, definition: { numerator: "n", denominator: "d", dataSource: "EDW", cadence: "monthly" } },
        { name: "b", type: "balancing", dataPoints: 24, definition: null },
      ],
      pdsaCycles: [{ prediction: "Up to about half.", completedAt: new Date() }],
    });
    for (const facts of [weak, strong]) {
      const input = { facts, problemStatement: "p", aimText: "a" };
      const output = devilsAdvocatePrompt.mock(input);
      expect(devilsAdvocatePrompt.schema.safeParse(output).success).toBe(true);
      expect(devilsAdvocatePrompt.refine?.(output, input)).toBeNull();
    }
  });
});
