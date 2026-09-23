import { describe, expect, it } from "vitest";
import { buildTree, layoutDiagram, validPlacement, wrap, type DriverRow } from "@/lib/projects/drivers";
import { currentState } from "@/lib/projects/handoff";
import { reviewIntake, type IntakeSnapshot } from "@/lib/projects/intake";
import { handoffOverdue, stallDecision } from "@/lib/jobs/stall";
import { cohortYearFor } from "@/lib/projects/service";

const DAY = 86_400_000;
const now = new Date("2026-09-23T12:00:00Z");

/** The seeded deliberately bad project (addition C6), as intake sees it. */
const bad: IntakeSnapshot = {
  title: "Improve handoff communication",
  problemStatement: "Handoffs are inconsistent and we think patient safety could be better.",
  clinicalOwner: null,
  coachId: null,
  sponsor: null,
  analystContact: null,
  clerDomain: null,
  equityStratificationPlan: null,
  aim: {
    text: "Improve resident handoff communication in the ICU to enhance patient safety this academic year.",
    baselineValue: null,
    baselinePeriod: null,
    target: null,
    deadline: null,
    population: null,
  },
  measures: [{ name: "Handoffs using the standard template", type: "process", definition: { numerator: "Handoffs documented with the template.", denominator: "All handoffs.", dataSource: "Not yet identified" } }],
};

const good: IntakeSnapshot = {
  title: "Discharge summary completion within 48 hours",
  problemStatement:
    "Discharge summaries on the Hospitalist service are frequently signed days after the patient leaves, so the primary care clinician has no document at the first visit.",
  clinicalOwner: "Dr. H. Vasquez, Hospitalist Medical Director",
  coachId: "coach",
  sponsor: null,
  analystContact: null,
  clerDomain: "care_transitions",
  equityStratificationPlan: "Stratify by preferred language.",
  aim: {
    text: "Reduce the proportion of discharge summaries signed more than 48 hours after discharge on the Hospitalist service at University Hospital from 34% (baseline, 1 October 2024 – 30 September 2025) to 15% by 30 June 2027.",
    baselineValue: 34.2,
    baselinePeriod: "1 October 2024 – 30 September 2025",
    target: 15,
    deadline: new Date("2027-06-30T00:00:00Z"),
    population: "Adult patients discharged from the Hospitalist service at University Hospital",
  },
  measures: [
    {
      name: "Summaries signed >48h",
      type: "outcome",
      definition: {
        numerator: "Discharge summaries signed more than 48 hours after discharge.",
        denominator: "All discharge summaries for Hospitalist discharges in the month.",
        dataSource: "DSR-114",
      },
    },
    { name: "Documentation time", type: "balancing", definition: { numerator: "n/a", denominator: "n/a", dataSource: "EHR audit" } },
  ],
};

describe("intake submission rules", () => {
  it("blocks the deliberately bad project with a specific explanation for each gap", () => {
    const review = reviewIntake(bad);
    expect(review.canSubmit).toBe(false);
    const ids = review.blockers.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["balancing", "clinical_owner", "aim"]));

    const balancing = review.blockers.find((b) => b.id === "balancing")!;
    expect(balancing.step).toBe("measures");
    expect(balancing.explanation).toMatch(/checks that improving one thing has not made something else worse/);
    const owner = review.blockers.find((b) => b.id === "clinical_owner")!;
    expect(owner.step).toBe("people");
    expect(owner.explanation).toMatch(/keeps a successful change in place after you rotate off/);
    // The aim blocker names each missing element rather than saying "invalid".
    const aim = review.blockers.find((b) => b.id === "aim")!;
    expect(aim.title).toBe("The aim is missing all five elements");
    expect(aim.explanation).toMatch(/^Missing: direction and magnitude; baseline value; population; deadline; measure definition\./);
  });

  it("lets a complete project through, with warnings only as advice", () => {
    const review = reviewIntake(good);
    expect(review.blockers).toEqual([]);
    expect(review.canSubmit).toBe(true);
    expect(review.aim?.passed).toBe(true);
  });

  it("blocks on the balancing measure alone, and on the clinical owner alone", () => {
    const noBalancing = reviewIntake({ ...good, measures: good.measures.filter((m) => m.type !== "balancing") });
    expect(noBalancing.blockers.map((b) => b.id)).toEqual(["balancing"]);
    const noOwner = reviewIntake({ ...good, clinicalOwner: "  " });
    expect(noOwner.blockers.map((b) => b.id)).toEqual(["clinical_owner"]);
  });
});

describe("stall rule", () => {
  it("flips an active project after 42 idle days, not before", () => {
    expect(stallDecision({ status: "active", lastActivity: new Date(now.getTime() - 43 * DAY) }, now)).toEqual({
      stall: true,
      reason: "No PDSA entry or data point in 43 days.",
    });
    expect(stallDecision({ status: "active", lastActivity: new Date(now.getTime() - 42 * DAY) }, now).stall).toBe(false);
    expect(stallDecision({ status: "complete", lastActivity: new Date(now.getTime() - 400 * DAY) }, now).stall).toBe(false);
  });

  it("treats a handoff unaccepted for 14 days as a signal", () => {
    expect(handoffOverdue(new Date(now.getTime() - 14 * DAY), now)).toBe(14);
    expect(handoffOverdue(new Date(now.getTime() - 13 * DAY), now)).toBeNull();
  });
});

describe("driver diagrams", () => {
  const rows: DriverRow[] = [
    { id: "p2", parentId: null, kind: "primary", text: "Weekend cover", position: 1 },
    { id: "p1", parentId: null, kind: "primary", text: "Drafted while the team knows the patient", position: 0 },
    { id: "s1", parentId: "p1", kind: "secondary", text: "Drafted before departure", position: 0 },
    { id: "c1", parentId: "s1", kind: "change", text: "Draft in the 14:00 huddle", position: 0 },
    { id: "c2", parentId: "s1", kind: "change", text: "Pre-populate the hospital course from progress notes", position: 1 },
  ];

  it("builds the tree in position order", () => {
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id)).toEqual(["p1", "p2"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.id)).toEqual(["c1", "c2"]);
  });

  it("only allows aim → primary → secondary → change", () => {
    expect(validPlacement("primary", null)).toBe(true);
    expect(validPlacement("secondary", "primary")).toBe(true);
    expect(validPlacement("change", "secondary")).toBe(true);
    expect(validPlacement("change", "primary")).toBe(false);
    expect(validPlacement("secondary", null)).toBe(false);
  });

  it("lays out four columns with no overlapping boxes and a link to every node", () => {
    const layout = layoutDiagram("Reduce late summaries from 34% to 15% by 30 June 2027.", buildTree(rows));
    expect(layout.columns.map((c) => c.label)).toEqual(["Aim", "Primary drivers", "Secondary drivers", "Change ideas"]);
    expect(layout.links).toHaveLength(rows.length);
    const byColumn = new Map<number, typeof layout.boxes>();
    for (const b of layout.boxes) byColumn.set(b.x, [...(byColumn.get(b.x) ?? []), b]);
    for (const boxes of byColumn.values()) {
      const sorted = [...boxes].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.height);
    }
  });

  it("wraps long text rather than overflowing a box", () => {
    expect(wrap("Pre-populate the hospital course from the preceding week of progress notes").every((l) => l.length <= 26)).toBe(true);
  });
});

describe("handoff current state", () => {
  it("is computed from the record, including what is unfinished", () => {
    const lines = currentState(
      {
        status: "active",
        aim: "Reduce X from 34% to 15% by 30 June 2027.",
        lastActivityAt: new Date(now.getTime() - 3 * DAY),
        measures: [
          { name: "Signed late", type: "outcome", points: 24, lastPeriod: "Sep 2026" },
          { name: "Documentation time", type: "balancing", points: 0, lastPeriod: null },
        ],
        cycles: [
          { number: 1, completed: true, hasPrediction: true, actDecision: "adapt" },
          { number: 2, completed: false, hasPrediction: false, actDecision: null },
        ],
      },
      now,
    );
    expect(lines).toEqual([
      "Status: active. Last PDSA entry or data point 3 days ago.",
      "Current aim: Reduce X from 34% to 15% by 30 June 2027.",
      'Outcome measure "Signed late": 24 data points, latest Sep 2026.',
      'Balancing measure "Documentation time": no data points yet.',
      "PDSA: 1 cycle complete (cycle 1: adapt).",
      "Cycle 2 is open and has no prediction yet, so it cannot be closed.",
    ]);
  });
});

describe("cohort year", () => {
  it("starts a new academic year in July", () => {
    expect(cohortYearFor(new Date("2026-06-30T00:00:00Z"))).toBe(2025);
    expect(cohortYearFor(new Date("2026-07-01T00:00:00Z"))).toBe(2026);
  });
});
