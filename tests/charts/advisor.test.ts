import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { advise, advisorQuery, parseAnswers, QUESTIONS, type AdvisorAnswers } from "@/lib/charts/advisor";

/**
 * The advisor is a decision tree with zero language model calls in its path
 * (phase 4 exit criterion). Every leaf is asserted here.
 */

function leaf(answers: AdvisorAnswers) {
  const step = advise(answers);
  if (step.kind !== "recommendation") throw new Error(`expected a recommendation, got question ${step.question.id}`);
  return step.recommendation;
}

describe("chart-type advisor", () => {
  it("asks what is being recorded first", () => {
    const step = advise({});
    expect(step.kind).toBe("question");
    expect(step.kind === "question" && step.question.id).toBe("data");
  });

  it.each([
    [{ data: "classification", rare: "no", constant: "no", history: "12plus" }, "p", "p"],
    [{ data: "classification", rare: "no", constant: "yes", history: "12plus" }, "p", "p"],
    [{ data: "classification", rare: "no", constant: "no", history: "under12" }, "p", "run"],
    [{ data: "events", rare: "no", exposure: "varies", history: "12plus" }, "u", "u"],
    [{ data: "events", rare: "no", exposure: "constant", history: "12plus" }, "c", "c"],
    [{ data: "measurement", subgroup: "one", history: "12plus" }, "xmr", "xmr"],
    [{ data: "measurement", subgroup: "one", history: "under12" }, "xmr", "run"],
    [{ data: "classification", rare: "yes" }, "g", "run"],
    [{ data: "events", rare: "yes" }, "t", "run"],
    [{ data: "measurement", subgroup: "several" }, "xbar_s", "xmr"],
  ] as Array<[AdvisorAnswers, string, string]>)("%o → %s (use %s now)", (answers, chart, useNow) => {
    const r = leaf(answers);
    expect(r.chart).toBe(chart);
    expect(r.useNow).toBe(useNow);
    expect(r.supported).toBe(!["g", "t", "xbar_s"].includes(chart));
    // Every answer on the path contributed a reason.
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("explains stepped limits when the denominator varies", () => {
    expect(leaf({ data: "classification", rare: "no", constant: "no", history: "12plus" }).reasons.join(" ")).toMatch(/limits will step/);
  });

  it("says a run chart comes first on a short series, and names the chart to move to", () => {
    const r = leaf({ data: "events", rare: "no", exposure: "varies", history: "under12" });
    expect(r.caveats[0]).toMatch(/Start with a run chart now.*u chart/);
  });

  it("ignores answers to questions that are off the path", () => {
    // A stale `exposure` answer from an earlier "events" path must not matter.
    const step = advise({ data: "classification", exposure: "varies" });
    expect(step.kind === "question" && step.question.id).toBe("rare");
    expect(step.path).toEqual(["data", "rare"]);
    expect(advisorQuery({ data: "classification", exposure: "varies" }, step.path)).toBe("?data=classification");
  });

  it("drops unrecognised values rather than guessing", () => {
    expect(parseAnswers({ data: "vibes", history: "12plus", extra: "x" })).toEqual({ history: "12plus" });
    expect(parseAnswers({ data: ["events", "measurement"] })).toEqual({ data: "events" });
  });

  it("offers at least two options for every question", () => {
    for (const q of Object.values(QUESTIONS)) expect(q.options.length).toBeGreaterThanOrEqual(2);
  });

  it("imports no language model and makes no network call", () => {
    const source = readFileSync("lib/charts/advisor.ts", "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/spc"]);
    expect(source).not.toMatch(/fetch\(|runPrompt|createLlm/);
  });
});
