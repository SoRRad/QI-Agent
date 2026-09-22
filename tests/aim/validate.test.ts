import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAim } from "@/lib/aim/validate";

/**
 * The validator is tested against the committee's OWN document. The passing
 * and failing examples in content/library/aim-statement-standard.md are
 * extracted from the markdown and run through validateAim. If someone edits
 * the examples, this test says whether the validator still agrees with them.
 */

const doc = readFileSync(join(process.cwd(), "content", "library", "aim-statement-standard.md"), "utf8");

function blockquoteAfter(heading: string): string {
  const section = doc.slice(doc.indexOf(heading));
  const lines: string[] = [];
  let started = false;
  for (const line of section.split("\n").slice(1)) {
    if (line.startsWith(">")) {
      started = true;
      lines.push(line.replace(/^>\s?/, ""));
    } else if (started) {
      break;
    }
  }
  return lines.join(" ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

describe("the examples in the committee's aim statement document", () => {
  const passing = blockquoteAfter("## A passing example");
  const failing = blockquoteAfter("## A failing example");

  it("extracts both examples", () => {
    expect(passing).toMatch(/^Reduce the proportion/);
    expect(failing).toMatch(/^Improve resident handoff/);
  });

  it("passes the passing example on all five elements", () => {
    const result = validateAim({ text: passing });
    expect(result.elements.filter((e) => !e.met).map((e) => `${e.element}: ${e.reason}`)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("fails the failing example on all five elements, as the document annotates it", () => {
    const result = validateAim({ text: failing });
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual([
      "direction_magnitude",
      "baseline",
      "population",
      "deadline",
      "measure_definition",
    ]);
  });

  it("explains each failure in terms a trainee can act on", () => {
    const reasons = Object.fromEntries(validateAim({ text: failing }).elements.map((e) => [e.element, e.reason]));
    expect(reasons["direction_magnitude"]).toMatch(/"Improve" carries no number/);
    expect(reasons["population"]).toMatch(/names a place, not who is being counted/);
    expect(reasons["deadline"]).toMatch(/relative .*this academic year/);
  });
});

describe("individual elements", () => {
  it("treats 'patient safety' as a goal, not a population", () => {
    expect(validateAim({ text: "Improve patient safety in the ICU." }).missing).toContain("population");
    expect(validateAim({ text: "Reduce falls among patients on the geriatrics unit." }).missing).not.toContain("population");
  });

  it("requires a day in the deadline, as the document's example does", () => {
    expect(validateAim({ text: "Reach 90% by 30 June 2027." }).missing).not.toContain("deadline");
    expect(validateAim({ text: "Reach 90% by June 30, 2027." }).missing).not.toContain("deadline");
    expect(validateAim({ text: "Reach 90% this academic year." }).missing).toContain("deadline");
  });

  it("does not accept a baseline value without its period", () => {
    const result = validateAim({ text: "x", baselineValue: 34 });
    expect(result.elements.find((e) => e.element === "baseline")?.reason).toMatch(/no period/);
  });

  it("prefers structured fields over prose", () => {
    const result = validateAim({
      text: "Reduce late discharge summaries.",
      target: 15,
      baselineValue: 34.2,
      baselinePeriod: "1 October 2024 – 30 September 2025",
      population: "Adult patients discharged from the Hospitalist service",
      deadline: new Date("2027-06-30"),
      measure: { numerator: "Summaries signed >48h after discharge", denominator: "All summaries" },
    });
    expect(result.passed).toBe(true);
  });
});
