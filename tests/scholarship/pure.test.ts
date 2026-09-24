import { describe, expect, it } from "vitest";
import raw from "@/content/venues.json";
import { sourceNumbersGuard } from "@/lib/llm/guards/sourceNumbers";
import { countAbstract, countWords } from "@/lib/scholarship/abstract";
import { draftMemo, parseIrbAnswers, screen, type Answers, type MemoProject, type PolicyDoc } from "@/lib/scholarship/irb";
import { analysisMethods, assembleSquire, AUTHOR_MARK, squireMarkdown, type SquireRecord } from "@/lib/scholarship/squire";
import { abstractHeadings, matchVenues, nextDeadline, VENUES, venueById, venuesFileSchema, type ProjectProfile } from "@/lib/scholarship/venues";

const today = new Date("2026-09-24T12:00:00Z");

describe("the venue list", () => {
  it("validates, with unique ids", () => {
    expect(() => venuesFileSchema.parse(raw)).not.toThrow();
    const ids = VENUES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects a malformed edit", () => {
    const broken = structuredClone(raw) as { meetings: Array<Record<string, unknown>> };
    broken.meetings[0]!["deadlineMonth"] = 13;
    expect(() => venuesFileSchema.parse(broken)).toThrow();
  });

  it("counts months to the usual deadline month, this month being zero", () => {
    expect(nextDeadline(venueById("acgme-annual")!, today)).toEqual({ label: "Usually in September 2026", monthsAway: 0 });
    expect(nextDeadline(venueById("institutional-gme-symposium")!, today)).toEqual({ label: "Usually in March 2027", monthsAway: 6 });
    expect(nextDeadline(venueById("jgme")!, today).monthsAway).toBeNull();
  });

  it("uses the venue's headings, and says when it falls back to the common four", () => {
    expect(abstractHeadings(venueById("acgme-annual")!)).toEqual({ headings: ["Background", "Methods", "Results", "Discussion"], fromVenue: true });
    expect(abstractHeadings(venueById("jgme")!).fromVenue).toBe(false);
    expect(abstractHeadings(venueById("aamc-regional")!).headings).toEqual(["Abstract"]);
  });
});

describe("the venue matcher", () => {
  const inProgress: ProjectProfile = { status: "active", specialty: "Internal Medicine", clerDomain: "care_transitions", dataPoints: 8, completedCycles: 1 };

  it("excludes a paediatric venue for an adult project, and ranks it last", () => {
    const matches = matchVenues(inProgress, today);
    expect(matches.find((m) => m.venue.id === "pediatric-quality-safety")?.fit).toBe("excluded");
    expect(matches.at(-1)?.venue.id).toBe("pediatric-quality-safety");
    expect(matchVenues({ ...inProgress, specialty: "Pediatrics" }, today).find((m) => m.venue.id === "pediatric-quality-safety")?.fit).not.toBe("excluded");
  });

  it("says an improvement-report journal is a stretch until the project is finished", () => {
    const bmjoq = (p: ProjectProfile) => matchVenues(p, today).find((m) => m.venue.id === "bmj-open-quality")!;
    expect(bmjoq(inProgress).fit).toBe("stretch");
    expect(bmjoq({ ...inProgress, status: "complete" }).fit).toBe("fits");
  });

  it("puts fitting venues first, nearest deadline first among them", () => {
    const fits = matchVenues(inProgress, today).filter((m) => m.fit === "fits");
    const months = fits.map((m) => m.deadline.monthsAway ?? 99);
    expect(months).toEqual([...months].sort((a, b) => a - b));
    expect(fits[0]?.venue.id).toBe("acgme-annual");
  });

  it("reads an unknown scope tag as 'check', rather than guessing", () => {
    const [m] = matchVenues(inProgress, today, [{ ...venueById("jgme")!, scope: ["something new"] }]);
    expect(m?.fit).toBe("check");
  });
});

describe("the word counter", () => {
  it("counts runs between spaces, ignoring bare punctuation", () => {
    expect(countWords("Signed-late fell from 34% to 17% — p-chart, 24 months.")).toBe(9);
    expect(countWords("  ")).toBe(0);
  });

  it("totals sections against the limit and names empty ones", () => {
    const count = countAbstract(
      [
        { heading: "Background", text: "one two three" },
        { heading: "Results", text: "" },
      ],
      2,
    );
    expect(count).toMatchObject({ total: 3, over: 1, empty: ["Results"] });
  });
});

const qiAnswers: Answers = {
  purpose: "local",
  assignment: "no",
  acceptedPractice: "yes",
  risk: "no",
  extraData: "no",
  identifiableOut: "no",
  funding: "no",
  dissemination: "yes",
};

describe("the IRB / QI screening", () => {
  it("reads a plain local improvement project as likely QI", () => {
    expect(screen(qiAnswers).outcome).toBe("likely_qi");
  });

  it("reads randomisation, a research grant or a generalisable purpose as likely research", () => {
    expect(screen({ ...qiAnswers, assignment: "yes" }).outcome).toBe("likely_research");
    expect(screen({ ...qiAnswers, funding: "yes" }).outcome).toBe("likely_research");
    expect(screen({ ...qiAnswers, purpose: "generalizable" }).outcome).toBe("likely_research");
  });

  it("flags ambiguity instead of guessing, and names the answer responsible", () => {
    const cases: Array<[Partial<Answers>, RegExp]> = [
      [{ purpose: "both" }, /Which purpose is primary/],
      [{ risk: "unsure" }, /Added risk to patients was answered “not sure”/],
      [{ acceptedPractice: "no" }, /new or experimental/],
      [{ extraData: "yes", extraDataFrom: "trainees" }, /educational research/],
      [{ identifiableOut: "yes" }, /needs review for privacy/],
    ];
    for (const [change, reason] of cases) {
      const s = screen({ ...qiAnswers, ...change });
      expect(s.outcome).toBe("ambiguous");
      expect(s.ambiguities.join(" ")).toMatch(reason);
    }
  });

  it("asks the follow-up only when it applies", () => {
    const base = Object.fromEntries(Object.entries(qiAnswers).map(([k, v]) => [k, v as string]));
    expect(parseIrbAnswers(base).ok).toBe(true);
    const missing = parseIrbAnswers({ ...base, extraData: "yes" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.missing.id).toBe("extraDataFrom");
    expect(parseIrbAnswers({ ...base, purpose: "made-up" }).ok).toBe(false);
  });
});

describe("the screening memo (exit criterion: cites a LibraryDoc or declares the gap)", () => {
  const project: MemoProject = {
    title: "Discharge summaries",
    program: "Internal Medicine Residency",
    lead: "Dr. J. Oyelaran",
    coach: "Dr. S. Lindqvist",
    aim: "Reduce late summaries from 34% to 15% by 30 June 2027.",
    measures: [{ name: "Signed >48h", dataSource: "DSR-114" }],
    changeIdeas: ["Draft in the 14:00 huddle"],
    cycles: 3,
  };
  const placeholder: PolicyDoc = {
    slug: "local-irb-determination",
    title: "IRB / QI Determination Policy",
    version: 1,
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    isLocal: true,
    localFieldsRequired: ["Name and contact for the office that issues QI-versus-research determinations", "The named signatory"],
  };
  const memo = (policy: PolicyDoc | null, answers = qiAnswers) =>
    draftMemo({ project, answers, screening: screen(answers), policy, preparedBy: "Dr. J. Oyelaran", date: today });

  it("cites the local policy by title and version once the institution has supplied it", () => {
    const m = memo({ ...placeholder, isLocal: false, version: 3 });
    expect(m.cited).toEqual({ slug: "local-irb-determination", version: 3 });
    expect(m.text).toContain("**IRB / QI Determination Policy**, version 3");
    expect(m.text).toContain("/ask/library/local-irb-determination");
    expect(m.text).not.toMatch(/Gap:/);
  });

  it("declares the gap, and what the institution must supply, while the policy is a placeholder", () => {
    const m = memo(placeholder);
    expect(m.cited).toBeNull();
    expect(m.text).toMatch(/\*\*Gap:\*\* the institution's QI-versus-research determination policy has not been supplied/);
    expect(m.text).toContain("- The named signatory");
    expect(m.text).toMatch(/not yet named in the library/);
  });

  it("declares the gap when there is no policy document at all", () => {
    const m = memo(null);
    expect(m.cited).toBeNull();
    expect(m.text).toMatch(/There is no determination policy document in the library/);
  });

  it("always says it is a screening, not a determination, and never resolves an ambiguity", () => {
    for (const m of [memo(placeholder), memo(null, { ...qiAnswers, purpose: "both" })]) expect(m.text).toMatch(/This is a screening, not a determination/);
    expect(memo(placeholder, { ...qiAnswers, purpose: "both" }).text).toMatch(/Do not resolve the ambiguity yourself/);
  });
});

// ---------------------------------------------------------------- SQUIRE

/** Every line a section says, record and prompts alike: where an invented result would have to appear. Headings carry only section numbers. */
const content = (d: ReturnType<typeof assembleSquire>) => d.sections.flatMap((s) => [...s.fromRecord, ...s.author]).join("\n");

const noData: SquireRecord = {
  project: {
    title: "Improve handoff communication",
    problemStatement: "Handoffs are inconsistent and we think patient safety could be better.",
    program: "Internal Medicine Residency",
    specialty: "Internal Medicine",
    clinicalOwner: null,
    clerDomain: null,
    cohortYear: 2026,
    outcomeSummary: null,
  },
  aims: [{ version: 1, text: "Improve resident handoff communication in the ICU this academic year.", baseline: null, missing: ["direction and magnitude", "baseline value", "deadline"] }],
  drivers: [],
  measures: [{ name: "Handoffs using the template", type: "process", chartType: "p", definition: null, points: 0, chart: null, annotations: [] }],
  cycles: [],
  precedents: [],
  screening: null,
  sustainability: null,
};

describe("the SQUIRE drafter (exit criterion: marks author input, invents no results)", () => {
  const draft = assembleSquire(noData);

  it("has every SQUIRE section, in order", () => {
    expect(draft.sections.map((s) => s.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("writes nothing under Results for a project with no data, and says why", () => {
    const results = draft.sections.find((s) => s.title === "Results")!;
    expect(results.fromRecord).toEqual([]);
    expect(results.author.join(" ")).toMatch(/no results to report/);
  });

  it("marks every section that is not fully answered by the record", () => {
    for (const s of draft.sections) {
      expect(s.fromRecord.length + s.author.length, `section ${s.number}`).toBeGreaterThan(0);
      if (s.fromRecord.length === 0) expect(s.author.length, `section ${s.number}`).toBeGreaterThan(0);
    }
    // Discussion is always the author's.
    for (const n of [14, 15, 16]) expect(draft.sections[n - 1]!.fromRecord).toEqual([]);
    const md = squireMarkdown(draft, "24 September 2026");
    expect(md.split(`**${AUTHOR_MARK}:**`).length - 1).toBe(draft.sections.reduce((n, s) => n + s.author.length, 0));
  });

  it("names the aim's missing elements and the missing definition", () => {
    expect(draft.sections[5]!.author.join(" ")).toMatch(/missing direction and magnitude; baseline value; deadline/);
    expect(draft.sections[9]!.author.join(" ")).toMatch(/Write the operational definition for “Handoffs using the template”/);
  });

  it("contains no number that is not in the record or the engine's stated method", () => {
    const source = JSON.stringify(noData) + analysisMethods(new Set(["run", "p"])).join(" ");
    expect(sourceNumbersGuard(content(draft), source)).toBeNull();
    // Author prompts carry no numbers at all.
    for (const s of draft.sections) for (const prompt of s.author) expect(prompt, `section ${s.number}`).not.toMatch(/\d/);
  });

  it("reports results only as the record and the engine state them", () => {
    const withData: SquireRecord = {
      ...noData,
      measures: [
        {
          ...noData.measures[0]!,
          points: 12,
          chart: { description: "Run chart of 12 points from Oct 2025 to Sep 2026. Median 41.2%. No special-cause signals.", findings: [] },
        },
      ],
      cycles: [{ number: 1, plan: "Template on one team.", prediction: "Use will rise to half.", studyResult: "Use rose to 44%.", actDecision: "adapt", completed: true }],
    };
    const d = assembleSquire(withData);
    const results = d.sections.find((s) => s.title === "Results")!;
    expect(results.fromRecord.join(" ")).toContain("Median 41.2%");
    expect(results.fromRecord.join(" ")).toContain("Found: “Use rose to 44%.”");
    const source = JSON.stringify(withData) + analysisMethods(new Set(["run", "p"])).join(" ");
    expect(sourceNumbersGuard(content(d), source)).toBeNull();
  });
});
