import { describe, expect, it } from "vitest";
import { numericGuard, renderPlaceholders } from "@/lib/llm/guards/numeric";

/**
 * The numeric guard: the model may not write a number at all. It refers to
 * values by placeholder; TypeScript fills them in. So the narration's numbers
 * are the chart's numbers by construction, and there is nothing to compare.
 */

const KEYS = new Set(["measure", "centre_line", "v0_points", "v0_first"]);

describe("numericGuard", () => {
  it("accepts prose that refers to values only through placeholders", () => {
    expect(
      numericGuard("{{measure}} shifted: {{v0_points}} points below {{centre_line}} from {{v0_first}}.", KEYS),
    ).toBeNull();
  });

  it("accepts ordinary words that are not numbers", () => {
    expect(numericGuard("Points on one side of the median, starting with the first.", KEYS)).toBeNull();
    expect(numericGuard("The second half of the series looks different.", KEYS)).toBeNull();
  });

  it("rejects a number in digits, however it got there", () => {
    for (const text of [
      "The median is 26.75%.",
      "{{v0_points}} points, or about 12.",
      "It dropped after Oct 2025.",
      "Summaries signed >48h late.",
      "A 50% reduction.",
    ]) {
      expect(numericGuard(text, KEYS), text).toMatch(/digits/);
    }
  });

  it("rejects a number written as a word", () => {
    for (const text of [
      "twelve consecutive points",
      "roughly half ... no, about thirty percent",
      "the rate doubled",
      "a hundred discharges",
      "it halved",
    ]) {
      expect(numericGuard(text, KEYS), text).toMatch(/as a word/);
    }
  });

  it("rejects a placeholder it was not given", () => {
    expect(numericGuard("{{p_value}} shows significance", KEYS)).toMatch(/do not exist.*\{\{p_value\}\}/);
  });
});

describe("renderPlaceholders", () => {
  it("substitutes the computed values", () => {
    expect(
      renderPlaceholders("{{v0_points}} points below {{centre_line}}", { v0_points: "12", centre_line: "26.7%" }),
    ).toBe("12 points below 26.7%");
  });
});
