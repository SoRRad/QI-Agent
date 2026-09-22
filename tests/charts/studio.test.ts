import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeChart, pointReadout, readoutSentence } from "@/lib/charts/describe";
import { layoutChart } from "@/lib/charts/layout";
import { CHART_COLORS } from "@/lib/charts/palette";
import { parseNumber, pointValue } from "@/lib/charts/points";
import { provenance } from "@/lib/charts/provenance";
import { baselineChoices, parseStudioParams, studioChart, studioQuery, toObservations } from "@/lib/charts/studio";
import { DISCHARGE_SERIES } from "@/prisma/demo-data";

const stored = DISCHARGE_SERIES.map((p) => ({
  periodLabel: p.label,
  value: (p.num / p.den) * 100,
  numerator: p.num,
  denominator: p.den,
}));
const observations = toObservations(stored);
const annotations = [
  { label: "Discharge summary in the afternoon huddle", periodIndex: 13 },
  { label: "Weekend cross-cover template", periodIndex: 17 },
];

describe("studio params", () => {
  it("defaults to a whole-series run chart and ignores nonsense", () => {
    expect(parseStudioParams({}, "p", 24)).toEqual({ view: "run", baseline: null, westernElectric: false });
    expect(parseStudioParams({ view: "pie", baseline: "abc", we: "on" }, "p", 24)).toEqual({
      view: "run",
      baseline: null,
      westernElectric: false,
    });
    expect(parseStudioParams({ baseline: "24" }, "p", 24).baseline).toBeNull();
    expect(parseStudioParams({ baseline: "1" }, "p", 24).baseline).toBeNull();
  });

  it("offers a control view only for measures that have one", () => {
    expect(parseStudioParams({ view: "control" }, "run", 24).view).toBe("run");
    expect(parseStudioParams({ view: "control", we: "on", baseline: "12" }, "p", 24)).toEqual({
      view: "control",
      baseline: 12,
      westernElectric: true,
    });
  });

  it("round-trips through the query string", () => {
    const params = { view: "control" as const, baseline: 12, westernElectric: true };
    expect(studioQuery(params)).toBe("?view=control&baseline=12&we=on");
    const back = parseStudioParams(Object.fromEntries(new URLSearchParams(studioQuery(params))), "p", 24);
    expect(back).toEqual(params);
    expect(studioQuery({ view: "run", baseline: null, westernElectric: false })).toBe("");
  });
});

describe("studioChart on the seeded discharge series", () => {
  it("fires the shift in the default view", () => {
    const { kind, unit, analysis } = studioChart("p", observations, parseStudioParams({}, "p", 24));
    expect(kind).toBe("run");
    expect(unit).toBe("%");
    expect(analysis.violations.filter((v) => v.rule === "shift")).toHaveLength(2);
    expect(describeChart(analysis, unit)).toMatch(/Signals: Shift from Oct 2024 to Sep 2025; Shift from Oct 2025 to Sep 2026/);
  });

  it("shows the teaching case: a whole-series p chart misses what a frozen baseline catches", () => {
    const whole = studioChart("p", observations, { view: "control", baseline: null, westernElectric: false });
    const frozen = studioChart("p", observations, { view: "control", baseline: 12, westernElectric: false });
    expect(whole.analysis.violations).toHaveLength(0);
    expect(frozen.analysis.violations.filter((v) => v.rule === "point_beyond_limits").length).toBeGreaterThanOrEqual(10);
  });

  it("finds the eight-on-one-side pattern when Western Electric rules are on", () => {
    const on = studioChart("p", observations, { view: "control", baseline: null, westernElectric: true });
    expect(on.analysis.violations.some((v) => v.rule === "we_eight_on_one_side")).toBe(true);
  });

  it("offers baselines at each annotated change", () => {
    expect(baselineChoices(annotations, 24)).toEqual([
      { length: 12, label: annotations[0]!.label, annotationNumber: 1 },
      { length: 16, label: annotations[1]!.label, annotationNumber: 2 },
    ]);
    // An annotation at period 1 has nothing before it.
    expect(baselineChoices([{ label: "x", periodIndex: 1 }], 24)).toEqual([]);
  });
});

describe("readouts", () => {
  it("reads a point the same way for the tooltip and the screen reader", () => {
    const { unit, analysis } = studioChart("p", observations, { view: "control", baseline: 12, westernElectric: false });
    // Oct 2025 (22.4%) is just inside the lower limit; Nov 2025 is beyond it.
    expect(pointReadout(analysis, unit, 12)?.rules).toEqual([]);
    const r = pointReadout(analysis, unit, 13);
    expect(r).toMatchObject({ period: "Nov 2025", value: "20.0%", counts: "23 of 115", centre: "Baseline mean 34.3%" });
    expect(r?.rules).toEqual(["Beyond a control limit"]);
    expect(readoutSentence(r!, { index: 13, total: 24 })).toBe(
      `Nov 2025: 20.0% (23 of 115). Baseline mean 34.3%. Limits ${r!.limits}. Special cause: Beyond a control limit. Point 14 of 24.`,
    );
  });

  it("lays the frozen baseline out as a band ending after the last baseline point", () => {
    const { unit, analysis } = studioChart("p", observations, { view: "run", baseline: 12, westernElectric: false });
    const layout = layoutChart({ analysis, unit, annotations, width: 800 });
    expect(layout.centre.frozenUntilX).toBeCloseTo(layout.points[11]!.x + layout.step / 2, 6);
    expect(layout.centre.label).toMatch(/^Baseline median/);
    expect(layout.points.filter((p) => p.kind === "pattern").map((p) => p.index)).toContain(23);
  });
});

describe("provenance", () => {
  it("names the function, the file and the series length for every number", () => {
    const { unit, analysis } = studioChart("p", observations, { view: "run", baseline: null, westernElectric: false });
    const rows = provenance(analysis, { measureChartType: "p", unit, westernElectric: false });
    expect(rows.map((r) => r.quantity)).toEqual(["Plotted values", "Median", "Shift and trend", "Runs expected"]);
    expect(rows[1]).toMatchObject({ computedBy: "median(values)", file: "lib/spc/median.ts", over: "all 24 points", value: "26.7%" });
    expect(rows[3]?.computedBy).toBe("runsCriticalValues(24)");
  });

  it("describes a frozen p chart's baseline and limits", () => {
    const { unit, analysis } = studioChart("p", observations, { view: "control", baseline: 12, westernElectric: false });
    const rows = provenance(analysis, { measureChartType: "p", unit, westernElectric: false });
    const centre = rows.find((r) => r.quantity === "Baseline centre line");
    expect(centre?.over).toBe("first 12 of 24 points (Oct 2024 – Sep 2025)");
    expect(centre?.value).toBe("34.3%");
    expect(rows.find((r) => r.quantity === "Control limits")?.value).toBe("stepped: one pair per point");
  });
});

describe("pointValue", () => {
  it("computes each chart type's value in TypeScript", () => {
    expect(pointValue("p", { numerator: 39, denominator: 112 })).toEqual({
      ok: true,
      point: { value: (39 / 112) * 100, numerator: 39, denominator: 112, subgroupSize: 112 },
    });
    expect(pointValue("u", { numerator: 1042, denominator: 452 })).toMatchObject({ ok: true, point: { value: 1042 / 452 } });
    expect(pointValue("c", { numerator: 7 })).toMatchObject({ ok: true, point: { value: 7, numerator: 7 } });
    expect(pointValue("xmr", { value: 41.5 })).toMatchObject({ ok: true, point: { value: 41.5, numerator: null } });
  });

  it("refuses impossible points with a reason", () => {
    expect(pointValue("p", { numerator: 12, denominator: 10 })).toMatchObject({ ok: false, error: expect.stringMatching(/larger than the denominator/) });
    expect(pointValue("p", { numerator: 1.5, denominator: 10 })).toMatchObject({ ok: false });
    expect(pointValue("p", { numerator: 0, denominator: 0 })).toMatchObject({ ok: false, error: expect.stringMatching(/zero/) });
    expect(pointValue("u", { numerator: 3, denominator: 0 })).toMatchObject({ ok: false });
    expect(pointValue("c", { numerator: -1 })).toMatchObject({ ok: false });
    expect(pointValue("run", { value: Number.NaN })).toMatchObject({ ok: false });
  });

  it("parses numbers people type, and rejects ones it would have to guess at", () => {
    expect(parseNumber(" 1,240 ")).toBe(1240);
    expect(parseNumber("0.25")).toBe(0.25);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("12%")).toBeNaN();
    expect(parseNumber("1,24")).toBeNaN();
  });
});

describe("chart palette", () => {
  it("matches the design tokens in globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const [name, hex] of Object.entries(CHART_COLORS)) {
      const token = name === "sunken" ? "surface-sunken" : name;
      expect(css, `--color-${token}`).toContain(`--color-${token}: ${hex};`);
    }
  });
});
