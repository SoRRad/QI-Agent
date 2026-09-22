import { describe, expect, it } from "vitest";
import { formatValue, layoutChart, niceTicks } from "@/lib/charts/layout";
import { analyse } from "@/lib/spc";
import type { Observation } from "@/lib/spc";
import { DISCHARGE_SERIES } from "@/prisma/demo-data";

const discharge: Observation[] = DISCHARGE_SERIES.map((p) => ({
  label: p.label,
  value: (p.num / p.den) * 100,
  numerator: p.num,
  denominator: p.den,
}));
const annotations = [{ label: "Huddle", periodIndex: 13 }, { label: "Template", periodIndex: 17 }];

describe("niceTicks", () => {
  it("returns round numbers covering the range", () => {
    expect(niceTicks(13.2, 38.7, 5)).toEqual([10, 15, 20, 25, 30, 35, 40]);
    expect(niceTicks(0.08, 0.32, 4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });
});

describe("formatValue", () => {
  it("matches decimals to the scale", () => {
    expect(formatValue(26.749, "%", 5)).toBe("27%");
    expect(formatValue(26.749, "%", 0.5)).toBe("26.7%");
    expect(formatValue(2.3141, "", 0.01)).toBe("2.31");
  });
});

describe("layoutChart", () => {
  it("keeps every point, the centre line and every limit inside the plot", () => {
    const layout = layoutChart({ analysis: analyse("p", discharge, { multiplier: 100 }), unit: "%", annotations, width: 800 });
    const { top, bottom } = layout.plot;
    for (const p of layout.points) {
      expect(p.y).toBeGreaterThanOrEqual(top - 0.5);
      expect(p.y).toBeLessThanOrEqual(bottom + 0.5);
    }
    expect(layout.centre.y).toBeGreaterThan(top);
    expect(layout.centre.y).toBeLessThan(bottom);
  });

  it("draws stepped limits when subgroup sizes vary, and flat ones when they do not", () => {
    const stepped = layoutChart({ analysis: analyse("p", discharge, { multiplier: 100 }), unit: "%", annotations: [], width: 800 });
    expect(stepped.upper?.stepped).toBe(true);
    expect(stepped.upper?.label).toBe("UCL (varies)");
    // One horizontal segment per subgroup.
    expect((stepped.upper?.path.match(/H/g) ?? []).length).toBe(24);

    const flat = layoutChart({
      analysis: analyse("c", Array.from({ length: 12 }, (_, i) => ({ label: `m${i}`, value: [14, 18, 16, 16, 15, 17, 16, 16, 13, 19, 16, 16][i]! }))),
      unit: "",
      annotations: [],
      width: 800,
    });
    expect(flat.upper?.stepped).toBe(false);
    expect(flat.upper?.label).toBe("UCL 28");
  });

  it("brackets the shifts and the trend in lanes that never overlap", () => {
    const layout = layoutChart({ analysis: analyse("run", discharge), unit: "%", annotations, width: 800 });
    expect(layout.brackets.map((b) => b.rule).sort()).toEqual(["shift", "shift", "trend"]);
    for (const a of layout.brackets) {
      for (const b of layout.brackets) {
        if (a === b || a.lane !== b.lane) continue;
        expect(a.x2 < b.x1 || b.x2 < a.x1, `${a.rule}/${b.rule} overlap in lane ${a.lane}`).toBe(true);
      }
    }
  });

  it("does not draw a bracket for the runs rule, which is about the whole series", () => {
    const layout = layoutChart({ analysis: analyse("run", discharge), unit: "%", annotations: [], width: 800 });
    expect(layout.brackets.some((b) => b.rule === "too_few_runs")).toBe(false);
  });

  it("marks points beyond the limits as special cause", () => {
    const analysis = analyse("p", discharge, { multiplier: 100, centreLine: 458 / 1337 });
    const layout = layoutChart({ analysis, unit: "%", annotations: [], width: 800 });
    expect(layout.points.filter((p) => p.kind === "special").map((p) => p.index)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });

  it("places annotations at their period", () => {
    const layout = layoutChart({ analysis: analyse("run", discharge), unit: "%", annotations, width: 800 });
    expect(layout.annotations.map((a) => a.period)).toEqual(["Oct 2025", "Feb 2026"]);
    expect(layout.annotations[0]?.x).toBeCloseTo(layout.points[12]!.x, 6);
  });

  it("thins x labels at 375px so they cannot collide", () => {
    const narrow = layoutChart({ analysis: analyse("run", discharge), unit: "%", annotations: [], width: 343 });
    const wide = layoutChart({ analysis: analyse("run", discharge), unit: "%", annotations: [], width: 1100 });
    expect(narrow.compact).toBe(true);
    expect(narrow.xLabels.length).toBeLessThan(wide.xLabels.length);
    for (let i = 1; i < narrow.xLabels.length; i += 1) {
      expect(narrow.xLabels[i]!.x - narrow.xLabels[i - 1]!.x).toBeGreaterThanOrEqual(50);
    }
  });

  it("keeps a percent axis inside 0–100%", () => {
    const layout = layoutChart({ analysis: analyse("p", discharge, { multiplier: 100 }), unit: "%", annotations: [], width: 800 });
    expect(Math.min(...layout.yTicks.map((t) => t.value))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...layout.yTicks.map((t) => t.value))).toBeLessThanOrEqual(100);
  });
});
