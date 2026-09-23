import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { cellsFromRows, guessMapping, importRows, nextPeriodLabel, periodLabel } from "@/lib/charts/importRows";

describe("parseCsv", () => {
  it("parses the file a data request asks for", () => {
    const csv = "period_start,period_end,numerator,denominator\r\n2025-10-01,2025-10-31,24,107\r\n2025-11-01,2025-11-30,23,115\r\n";
    expect(parseCsv(csv)).toEqual({
      headers: ["period_start", "period_end", "numerator", "denominator"],
      rows: [
        ["2025-10-01", "2025-10-31", "24", "107"],
        ["2025-11-01", "2025-11-30", "23", "115"],
      ],
      delimiter: ",",
      warnings: [],
      error: null,
    });
  });

  it("handles quotes, embedded commas and newlines, doubled quotes and a BOM", () => {
    const csv = '﻿month,note,count\n"Oct 2025","huddle, then ""template""",4\n"Nov 2025","two\nlines",5\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(["month", "note", "count"]);
    expect(result.rows).toEqual([
      ["Oct 2025", 'huddle, then "template"', "4"],
      ["Nov 2025", "two\nlines", "5"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("month;events\nOct 2025;4\n").rows).toEqual([["Oct 2025", "4"]]);
    expect(parseCsv("month\tevents\nOct 2025\t4").delimiter).toBe("\t");
  });

  it("skips blank lines, pads short rows and warns about long ones", () => {
    const result = parseCsv("a,b\n1\n\n2,3,4\n");
    expect(result.rows).toEqual([["1", ""], ["2", "3"]]);
    expect(result.warnings).toHaveLength(1);
  });

  it("reports an unterminated quote and an empty file", () => {
    expect(parseCsv('a,b\n"open,1\n').error).toMatch(/quotation mark/);
    expect(parseCsv("").error).toMatch(/empty/);
  });

  it("refuses more rows than the limit", () => {
    const csv = ["a", ...Array.from({ length: 6 }, (_, i) => String(i))].join("\n");
    expect(parseCsv(csv, 5).error).toMatch(/more than 5 rows/);
  });
});

describe("importRows", () => {
  it("guesses a mapping from the data request's column names", () => {
    expect(guessMapping(["period_start", "period_end", "numerator", "denominator"], "p")).toEqual({ period: 0, numerator: 2, denominator: 3 });
    expect(guessMapping(["Month", "Events", "Patient days"], "u")).toEqual({ period: 0, numerator: 1, denominator: 2 });
    expect(guessMapping(["week", "median"], "xmr")).toEqual({ period: 0, value: 1 });
  });

  it("labels ISO periods the way the charts do", () => {
    expect(periodLabel("2025-10-01", "monthly")).toBe("Oct 2025");
    expect(periodLabel("2025-10", "quarterly")).toBe("Q4 2025");
    expect(periodLabel("2025-10-01", "annual")).toBe("2025");
    expect(periodLabel("  Week  3 ", "weekly")).toBe("Week 3");
    expect(nextPeriodLabel("Dec 2025", "monthly")).toBe("Jan 2026");
    expect(nextPeriodLabel("Q4 2025", "quarterly")).toBe("Q1 2026");
    expect(nextPeriodLabel("Week 3", "weekly")).toBeNull();
  });

  it("computes values in TypeScript and refuses duplicates and impossible rows", () => {
    const { rows } = parseCsv(
      [
        "period_start,numerator,denominator",
        "2025-10-01,24,107",
        "2025-11-01,23,115",
        "2025-11-01,20,100",
        "2025-12-01,19,",
        "2026-01-01,130,122",
        '2026-02-01,"1,240",1300',
        "Sep 2025,40,100",
      ].join("\n"),
    );
    const result = importRows(cellsFromRows(rows, { period: 0, numerator: 1, denominator: 2 }), "p", "monthly", new Set(["Sep 2025"]));
    expect(result.map((r) => [r.label, r.error === null])).toEqual([
      ["Oct 2025", true],
      ["Nov 2025", true],
      ["Nov 2025", false],
      ["Dec 2025", false],
      ["Jan 2026", false],
      ["Feb 2026", true],
      ["Sep 2025", false],
    ]);
    expect(result[0]?.point?.value).toBeCloseTo((24 / 107) * 100, 12);
    expect(result[2]?.error).toMatch(/appears twice \(also row 3\)/);
    expect(result[4]?.error).toMatch(/larger than the denominator/);
    expect(result[5]?.point).toMatchObject({ numerator: 1240, denominator: 1300 });
    expect(result[6]?.error).toMatch(/already on the chart/);
  });
});
