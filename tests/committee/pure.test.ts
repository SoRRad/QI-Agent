import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { formatValue } from "@/lib/charts/layout";
import { academicYear, academicYearOf, annualReportMarkdown, assembleAnnualReport, defaultReportYear, type AnnualReportData } from "@/lib/committee/annualReport";
import { clerGaps, QUESTION_BANK } from "@/lib/committee/cler";
import { suggestCoaches } from "@/lib/committee/coaches";
import { curriculumCsv, parseCurriculumImport, tracker } from "@/lib/committee/curriculum";
import { buildKit, kitMarkdown, parseKit, serialiseKit } from "@/lib/committee/eventKit";
import { aggregate, rankLabel, resultsCsv, type SubmissionScores } from "@/lib/committee/judging";
import { buildFacts, SUBCOMPETENCIES, type MilestoneRecord } from "@/lib/committee/milestones";
import { MAX_TOTAL, RUBRIC, weightedTotal } from "@/lib/committee/rubric";
import { baselineFor } from "@/lib/committee/services/dashboard";
import { clerQuestionsPrompt, milestoneDraftPrompt } from "@/lib/llm/prompts";

/** Phase 8's pure parts: judging, curriculum, coaches, kits, CLER, milestones, the annual report. */

const scores = (...s: number[]) => Object.fromEntries(RUBRIC.map((c, i) => [c.id, s[i]!]));

describe("rubric", () => {
  it("weights to an integer total out of 60, and refuses an incomplete or out-of-range sheet", () => {
    expect(MAX_TOTAL).toBe(60);
    expect(weightedTotal(scores(5, 5, 5, 5, 5, 5))).toBe(60);
    expect(weightedTotal(scores(5, 4, 5, 5, 4, 4))).toBe(55);
    expect(weightedTotal({ ...scores(5, 5, 5, 5, 5, 5), results: 6 })).toBeNull();
    expect(weightedTotal({ problem_aim: 5 })).toBeNull();
    expect(weightedTotal({ ...scores(5, 5, 5, 5, 5, 5), method: 4.5 })).toBeNull();
  });
});

describe("judging aggregation", () => {
  const sub = (id: string, assigned: number, ...sheets: number[][]): SubmissionScores => ({
    submissionId: id,
    title: id,
    program: "P",
    presenters: "",
    assignedJudges: assigned,
    scores: sheets.map((s) => scores(...s)),
  });

  it("shares a rank between exact ties and skips the next (1, 1, 3), without inventing an order", () => {
    const rows = aggregate([
      sub("b-labs", 2, [5, 5, 4, 5, 4, 4], [4, 4, 5, 5, 4, 5]), // 55 + 54
      sub("a-discharge", 2, [5, 4, 5, 5, 4, 4], [4, 5, 4, 5, 4, 5]), // 55 + 54
      sub("c-other", 1, [4, 4, 4, 4, 4, 4]), // 48
    ]);
    expect(rows.map((r) => [r.title, r.rank, r.tied])).toEqual([
      ["a-discharge", 1, true],
      ["b-labs", 1, true],
      ["c-other", 3, false],
    ]);
    expect(rows.map(rankLabel)).toEqual(["=1", "=1", "3"]);
    expect(rows[0]!.mean).toBe(54.5);
  });

  it("compares means exactly, so equal means from different judge counts tie and near-misses do not", () => {
    // 108/2 = 54 and 162/3 = 54: a genuine tie.
    const tie = aggregate([sub("x", 2, [5, 4, 5, 5, 4, 4], [4, 4, 5, 5, 4, 4]), sub("y", 3, [5, 4, 5, 5, 4, 4], [4, 4, 5, 5, 4, 4], [4, 5, 4, 5, 4, 5])]);
    expect(tie.map((r) => r.mean)).toEqual([54, 54]);
    expect(tie.every((r) => r.tied && r.rank === 1)).toBe(true);
    // 55 vs 163/3 = 54.33…: not a tie, whatever rounding would say.
    const near = aggregate([sub("x", 1, [5, 4, 5, 5, 4, 4]), sub("y", 3, [5, 4, 5, 5, 4, 4], [4, 4, 5, 5, 4, 4], [5, 4, 5, 5, 4, 4])]);
    expect(near.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("does not rank a submission until every assigned judge has scored", () => {
    const rows = aggregate([sub("done", 1, [3, 3, 3, 3, 3, 3]), sub("waiting", 2, [5, 5, 5, 5, 5, 5]), sub("nobody", 0)]);
    expect(rows.map((r) => [r.title, r.status, r.rank])).toEqual([
      ["done", "complete", 1],
      ["nobody", "unassigned", null],
      ["waiting", "awaiting_scores", null],
    ]);
    expect(rankLabel(rows[2]!)).toBe("Awaiting scores (1 of 2)");
  });

  it("exports the rank as a number with the tie flagged, never as a formula", () => {
    const csv = resultsCsv(aggregate([sub("A", 1, [5, 5, 5, 5, 5, 5]), sub("B", 1, [5, 5, 5, 5, 5, 5])]));
    const parsed = parseCsv(csv);
    expect(parsed.headers.slice(0, 3)).toEqual(["rank", "tied", "title"]);
    expect(parsed.headers).toContain("mean_total_of_60");
    expect(parsed.rows.map((r) => r.slice(0, 3))).toEqual([
      ["1", "yes", "A"],
      ["1", "yes", "B"],
    ]);
    expect(csv).not.toMatch(/(^|,)=/m);
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting and neutralises cells a spreadsheet would run", () => {
    const csv = toCsv([
      ["a,b", 'say "hi"', "line\nbreak"],
      ['=HYPERLINK("x")', "+1", "-2.5"],
      ["@SUM(A1)", "-x", "plain"],
    ]);
    expect(csv.split("\r\n")[0]).toBe('"a,b","say ""hi""","line\nbreak"'.replace("\n", "\n"));
    const rows = parseCsv(csv);
    expect(rows.headers).toEqual(["a,b", 'say "hi"', "line\nbreak"]);
    expect(rows.rows[0]).toEqual([`'=HYPERLINK("x")`, "'+1", "-2.5"]);
    expect(rows.rows[1]).toEqual(["'@SUM(A1)", "'-x", "plain"]);
  });
});

describe("curriculum", () => {
  const trainees = [
    { id: "u1", email: "a@example.edu" },
    { id: "u2", email: "b@example.edu" },
  ];
  const today = new Date("2026-09-25T00:00:00Z");

  it("imports a clean file", () => {
    const result = parseCurriculumImport("email,item,completed_on\nA@example.edu,Run chart workshop,2026-03-02\nb@example.edu,Run chart workshop,\n", trainees, today);
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          line: 2,
          userId: "u1",
          email: "a@example.edu",
          item: "Run chart workshop",
          completedOn: new Date("2026-03-02T00:00:00Z"),
        },
        {
          line: 3,
          userId: "u2",
          email: "b@example.edu",
          item: "Run chart workshop",
          completedOn: null,
        },
      ],
    });
  });

  it("refuses the whole file for any bad row, and lists every problem by line", () => {
    const result = parseCurriculumImport(
      [
        "email,item,completed_on",
        "a@example.edu,Run chart workshop,2026-03-02",
        "nobody@example.edu,Run chart workshop,",
        "a@example.edu,PDSA workshop,2026-02-30",
        "b@example.edu,PDSA workshop,2027-01-01",
        "a@example.edu,run chart workshop,",
        "b@example.edu,QI Fundamentals module,02/03/2026",
      ].join("\n"),
      trainees,
      today,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      "Line 3: nobody@example.edu is not an active trainee.",
      "Line 4: completed_on must be a date written YYYY-MM-DD, or blank.",
      "Line 5: completed_on 2027-01-01 is in the future.",
      'Line 6: a@example.edu already has a row for "run chart workshop" in this file.',
      "Line 7: completed_on must be a date written YYYY-MM-DD, or blank.",
    ]);
  });

  it("names missing columns", () => {
    expect(parseCurriculumImport("email,module\nx,y", trainees, today)).toEqual({
      ok: false,
      errors: ["The file needs the columns email, item, completed_on; missing: item, completed_on."],
    });
  });

  it("counts completion by program against every item, and exports rows the import reads back", () => {
    const t = tracker(
      [
        {
          id: "u1",
          name: "Dr. A",
          email: "a@example.edu",
          program: "Medicine",
        },
        {
          id: "u2",
          name: "Dr. B",
          email: "b@example.edu",
          program: "Medicine",
        },
        { id: "u3", name: "Dr. C", email: "c@example.edu", program: "Surgery" },
      ],
      [
        {
          userId: "u1",
          item: "Run chart workshop",
          completedAt: new Date("2026-01-05T00:00:00Z"),
        },
        { userId: "u1", item: "PDSA workshop", completedAt: null },
        {
          userId: "u2",
          item: "PDSA workshop",
          completedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    );
    expect(t.items).toEqual(["PDSA workshop", "Run chart workshop"]);
    expect(t.programs).toEqual([
      {
        program: "Medicine",
        trainees: 2,
        completed: 2,
        possible: 4,
        percent: 50,
      },
      {
        program: "Surgery",
        trainees: 1,
        completed: 0,
        possible: 2,
        percent: 0,
      },
    ]);
    const csv = curriculumCsv(t);
    const back = parseCurriculumImport(csv, [...trainees, { id: "u3", email: "c@example.edu" }], today);
    expect(back.ok).toBe(true);
    if (back.ok)
      expect(back.rows.filter((r) => r.completedOn).map((r) => [r.userId, r.item])).toEqual([
        ["u1", "Run chart workshop"],
        ["u2", "PDSA workshop"],
      ]);
  });
});

describe("coach matching", () => {
  it("orders by expertise, program and load, and says why", () => {
    const suggestions = suggestCoaches(
      {
        programId: "med",
        clerDomain: "care_transitions",
        currentCoachId: "c3",
      },
      [
        {
          id: "c1",
          name: "Busy expert",
          programId: "med",
          program: "Medicine",
          expertise: ["care_transitions"],
          load: 3,
        },
        {
          id: "c2",
          name: "Free expert",
          programId: "surg",
          program: "Surgery",
          expertise: ["care_transitions"],
          load: 0,
        },
        {
          id: "c3",
          name: "Same program",
          programId: "med",
          program: "Medicine",
          expertise: [],
          load: 1,
        },
      ],
    );
    expect(suggestions.map((s) => [s.name, s.score])).toEqual([
      ["Free expert", 3],
      ["Busy expert", 2],
      ["Same program", 1],
    ]);
    expect(suggestions[1]!.reasons).toEqual(["Experienced in care transitions (+3)", "Coaches in Medicine (+2)", "Already coaching 3 active projects (−3)"]);
    expect(suggestions.find((s) => s.isCurrent)?.name).toBe("Same program");
  });
});

describe("CLER gaps", () => {
  it("reads each focus area from the interviewer's ratings", () => {
    const gaps = clerGaps([
      { domain: "patient_safety", rating: "clear" },
      { domain: "supervision", rating: "unable" },
      { domain: "supervision", rating: "clear" },
      { domain: "health_care_quality", rating: "partial" },
      { domain: "well_being", rating: null },
    ]);
    expect(Object.fromEntries(gaps.map((g) => [g.domain, g.reading]))).toEqual({
      patient_safety: "clear",
      health_care_quality: "partial",
      care_transitions: "not_asked",
      supervision: "gap",
      well_being: "unanswered",
      professionalism: "not_asked",
    });
    expect(gaps.find((g) => g.domain === "supervision")).toMatchObject({
      asked: 2,
      answered: 2,
      counts: { clear: 1, partial: 0, unable: 1 },
    });
  });

  it("drafts questions that pass their own checks, and refuses a set missing a focus area or carrying a number", () => {
    const input = {
      setting: "medicine wards",
      audience: "residents and fellows",
    };
    const mock = clerQuestionsPrompt.mock(input);
    expect(clerQuestionsPrompt.schema.safeParse(mock).success).toBe(true);
    expect(clerQuestionsPrompt.refine!(mock, input)).toBeNull();
    expect(mock.questions).toHaveLength(Object.values(QUESTION_BANK).flat().length);
    const noWellBeing = {
      questions: mock.questions.filter((q) => q.domain !== "well_being"),
    };
    expect(clerQuestionsPrompt.refine!(noWellBeing, input)).toMatch(/Well-being/);
    const withNumber = {
      questions: [
        ...mock.questions.slice(1),
        {
          domain: "patient_safety" as const,
          question: "How many incident reports did you file in the last 3 months?",
        },
      ],
    };
    expect(clerQuestionsPrompt.refine!(withNumber, input)).toMatch(/number/);
  });
});

describe("event kits", () => {
  const event = {
    title: "Autumn Symposium",
    type: "symposium" as const,
    date: new Date("2026-11-12T13:00:00Z"),
    quarter: "2026-Q4",
    agenda: null,
  };
  const subs = [
    {
      title: "Discharge summaries",
      program: "Medicine",
      presenters: "Dr. J. Oyelaran",
    },
  ];

  it("gives a symposium all five sections, with the rubric the judges score on", () => {
    const kit = buildKit(event, subs);
    expect(kit.map((s) => s.id)).toEqual(["agenda", "invitation", "slides", "rubric", "feedback"]);
    expect(kit.find((s) => s.id === "rubric")!.body).toContain(`The maximum total is ${MAX_TOTAL}`);
    for (const c of RUBRIC) expect(kit.find((s) => s.id === "rubric")!.body).toContain(c.anchor);
    expect(kit.find((s) => s.id === "agenda")!.body).toContain("1. Discharge summaries — Dr. J. Oyelaran (Medicine)");
    expect(kit.find((s) => s.id === "invitation")!.body).toContain("Thursday, 12 November 2026");
  });

  it("invents no time or room: the organiser fills those", () => {
    const text = buildKit(event, subs)
      .map((s) => s.body)
      .join("\n");
    expect(text).toContain("[organiser to fill: room, start and finish times]");
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  });

  it("gives other events no rubric, and round-trips through storage", () => {
    const kit = buildKit({ ...event, type: "committee_meeting" }, []);
    expect(kit.map((s) => s.id)).not.toContain("rubric");
    const stored = serialiseKit(kit);
    expect(parseKit(stored).map((s) => s.heading)).toEqual(kit.map((s) => s.heading));
    expect(parseKit(stored)[0]!.body).toBe(kit[0]!.body);
    expect(kitMarkdown("Meeting", stored)).toMatch(/^# Meeting — event kit\n\n## Agenda\n/);
    expect(parseKit("not a kit")).toEqual([]);
  });
});

describe("milestone mapper", () => {
  const record: MilestoneRecord = {
    role: {
      isLead: true,
      handedOver: false,
      tookOver: false,
      presented: ["Autumn Symposium"],
    },
    aim: "Reduce summaries signed after 48 hours from 34% to 20% by 30 June 2027.",
    measures: [
      {
        type: "outcome",
        name: "Late summaries",
        chart: "p chart",
        points: 24,
        reading: "Run chart of 24 points. Median 26.7%.",
        reproducible: true,
      },
      {
        type: "balancing",
        name: "Documentation time",
        chart: "run chart",
        points: 0,
        reading: null,
        reproducible: false,
      },
    ],
    pdsa: [
      {
        number: 1,
        plan: "Draft in the huddle",
        prediction: "Late summaries fall",
        studyResult: "They fell",
        actDecision: "adapt",
      },
    ],
    sustainability: { cadence: "quarterly", hasOwner: true },
    clerDomainLabel: "Care transitions",
    patientSafety: false,
  };
  const facts = buildFacts(record);
  const input = { facts, subcompetencies: SUBCOMPETENCIES };

  it("builds keyed facts in a fixed order, with number-free labels", () => {
    expect(facts.map((f) => f.key)).toEqual(facts.map((_, i) => `F${i + 1}`));
    expect(facts.map((f) => f.kind)).toEqual(["role", "aim", "measures", "data", "definition", "pdsa", "pdsa", "sustainability", "focus", "dissemination"]);
    for (const f of facts) expect(f.label).not.toMatch(/\d/);
  });

  it("the mock draft passes its own checks, and cites what it rests on", () => {
    const draft = milestoneDraftPrompt.mock(input);
    expect(milestoneDraftPrompt.schema.safeParse(draft).success).toBe(true);
    expect(milestoneDraftPrompt.refine!(draft, input)).toBeNull();
    expect(draft.entries.map((e) => e.code)).toEqual(["SBP2", "SBP4", "PBLI1", "PBLI2"]);
  });

  it("refuses level language, invented numbers, names, and uncited or unknown facts", () => {
    const ok = {
      code: "SBP2",
      evidence: "The resident led a project with a written aim and tested changes in PDSA cycles.",
      factKeys: ["F1", "F2"],
    };
    const refine = (entry: typeof ok) => milestoneDraftPrompt.refine!({ entries: [entry] }, input);
    expect(refine(ok)).toBeNull();
    expect(refine({ ...ok, evidence: `${ok.evidence} This is proficient work.` })).toMatch(/rating language/);
    expect(refine({ ...ok, evidence: `${ok.evidence} Consistent with level 3.` })).toMatch(/rating language/);
    expect(
      refine({
        ...ok,
        evidence: "The resident reduced late summaries by 40% over the project.",
      }),
    ).toMatch(/numbers that are not in/);
    // 34% is in the aim, which F2 is; citing only F1 does not license it.
    expect(
      refine({
        ...ok,
        evidence: "The resident set out to bring the rate down from 34% with a clear aim.",
        factKeys: ["F2"],
      }),
    ).toBeNull();
    expect(
      refine({
        ...ok,
        evidence: "The resident set out to bring the rate down from 34% with a clear aim.",
        factKeys: ["F1"],
      }),
    ).toMatch(/numbers/);
    expect(
      refine({
        ...ok,
        evidence: "Dr. Oyelaran led a project with a written aim and tested changes.",
      }),
    ).toMatch(/names someone/);
    expect(refine({ ...ok, factKeys: ["F99"] })).toMatch(/do not exist/);
    expect(refine({ ...ok, code: "ICS1" })).toMatch(/not in the list/);
  });
});

describe("annual report", () => {
  it("runs July to June, and defaults to the last completed year", () => {
    expect(academicYear(2025)).toEqual({
      label: "2025–26",
      start: new Date("2025-07-01T00:00:00Z"),
      end: new Date("2026-07-01T00:00:00Z"),
    });
    expect(academicYearOf(new Date("2026-06-30T12:00:00Z"))).toBe(2025);
    expect(academicYearOf(new Date("2026-07-01T00:00:00Z"))).toBe(2026);
    expect(defaultReportYear(new Date("2026-09-25T00:00:00Z"))).toBe(2025);
  });

  const data: AnnualReportData = {
    year: academicYear(2025),
    generatedOn: new Date("2026-09-25T00:00:00Z"),
    yearToDate: false,
    headline: {
      name: "Late summaries",
      reading: "Run chart of 21 points. Baseline median 30.9%.",
      points: 21,
      annotations: [{ period: "Nov 2025", label: "Huddle drafting adopted" }],
    },
    registry: {
      submitted: 2,
      completed: [{ title: "Labs", program: "Surgery", outcome: null }],
      archived: 0,
      activeNow: 1,
      stalledNow: 1,
      byProgram: [{ program: "Surgery", submitted: 1, completed: 1 }],
    },
    pulse: [{ quarter: "2026-Q1", responded: 12, trainees: 23, percent: 52 }],
    barriersClosed: [
      {
        label: "No analyst time",
        decision: "Named liaison",
        whatChanged: "A named analyst answers requests.",
      },
    ],
    scholarly: { events: [], abstractDrafts: 1, irbScreenings: 2 },
    curriculum: [
      {
        program: "Surgery",
        trainees: 9,
        completed: 2,
        possible: 36,
        percent: 6,
      },
    ],
    gaps: { resolvedInYear: 0, openNow: 2 },
  };

  it("uses only the figures it is given, and marks what the chair must write", () => {
    const md = annualReportMarkdown(assembleAnnualReport(data));
    const given = JSON.stringify(data);
    for (const n of md.match(/\d+(?:\.\d+)?/g) ?? []) {
      // Dates and the year label come from the year; every other number from the data.
      expect(given.includes(n) || ["1", "30", "2025", "26", "2026", "25"].includes(n)).toBe(true);
    }
    expect(md).toContain("| Surgery | 9 | 2 | 36 | 6% |");
    expect(md).toContain("AUTHOR INPUT NEEDED: the chair's summary");
    expect(md).toContain("One quarter is not a trend.");
    expect(md).toContain("- **No analyst time** — Decision: Named liaison What changed: A named analyst answers requests.");
  });
});

describe("institution charts", () => {
  it("freeze the median before the first committee intervention, when there is enough before it", () => {
    expect(
      baselineFor(24, [
        { label: "b", periodIndex: 23 },
        { label: "a", periodIndex: 14 },
      ]),
    ).toBe(13);
    expect(baselineFor(24, [])).toBeNull();
    expect(baselineFor(24, [{ label: "early", periodIndex: 2 }])).toBeNull();
    expect(baselineFor(24, [{ label: "unanchored", periodIndex: null }])).toBeNull();
  });

  it("label an axis tick with the decimals its step needs", () => {
    expect(formatValue(32.5, "%", 2.5)).toBe("32.5%");
    expect(formatValue(30, "%", 2.5)).toBe("30.0%");
    expect(formatValue(30, "%", 5)).toBe("30%");
  });
});
