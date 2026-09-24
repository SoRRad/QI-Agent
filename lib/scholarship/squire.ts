import { SHIFT_LENGTH, TREND_LENGTH, MINIMUM_RUN_CHART_POINTS, SIGMA_MULTIPLIER } from "@/lib/spc/constants";
import type { ChartKind } from "@/lib/spc";

/**
 * The SQUIRE 2.0 drafter (§6.5): assembles a manuscript draft from the
 * project record, the PDSA log and the charts, in SQUIRE section order.
 *
 * No language model writes any of it. Every sentence under a section is
 * either copied from the record, computed by the SPC engine, or a fixed
 * sentence describing the method the engine applies. Everything else is an
 * AUTHOR INPUT prompt saying what the section needs. That is how "never
 * invents results" holds by construction: there is nothing here that could
 * invent one. (ADR-0013 records why prose generation was left out.)
 *
 * Pure: the service loads the record and runs the engine; this arranges it.
 */

export const AUTHOR_MARK = "AUTHOR INPUT NEEDED";

export interface SquireRecord {
  project: {
    title: string;
    problemStatement: string;
    program: string;
    specialty: string;
    clinicalOwner: string | null;
    clerDomain: string | null;
    cohortYear: number | null;
    outcomeSummary: string | null;
  };
  /** Oldest first. `missing` names the five-element standard's gaps in that version, from the same check intake uses. */
  aims: Array<{ version: number; text: string; baseline: string | null; missing: string[] }>;
  drivers: Array<{ kind: "primary" | "secondary" | "change"; text: string; depth: number }>;
  measures: Array<{
    name: string;
    type: "outcome" | "process" | "balancing";
    chartType: ChartKind;
    definition: { numerator: string; denominator: string; inclusions: string; exclusions: string; dataSource: string; puller: string; cadence: string } | null;
    points: number;
    /** The engine's description of the run chart, and its findings. Null with no data. */
    chart: { description: string; findings: string[] } | null;
    annotations: Array<{ label: string; period: string | null }>;
  }>;
  cycles: Array<{ number: number; plan: string; prediction: string | null; studyResult: string | null; actDecision: string | null; completed: boolean }>;
  precedents: Array<{ title: string; program: string; cohortYear: number | null; status: string; outcomeSummary: string | null; endReason: string | null }>;
  screening: { outcome: string; date: string; citedPolicy: string | null } | null;
  sustainability: { changeOwner: string; cadence: string; reviewer: string } | null;
}

export interface SquireSection {
  number: number;
  part: "Title and abstract" | "Introduction" | "Methods" | "Results" | "Discussion" | "Other information";
  title: string;
  /** What SQUIRE asks for, in a line. */
  asks: string;
  /** Lines taken from the record or computed by the engine. */
  fromRecord: string[];
  /** What the author must add. Empty only when the record answers the item fully. */
  author: string[];
}

export interface SquireDraft {
  title: string;
  sections: SquireSection[];
}

const KIND_LABEL = { primary: "Primary driver", secondary: "Secondary driver", change: "Change idea" } as const;
const TYPE_LABEL = { outcome: "outcome", process: "process", balancing: "balancing" } as const;
const CHART_LABEL: Record<ChartKind, string> = { run: "run chart", xmr: "XmR chart", p: "p chart", u: "u chart", c: "c chart" };

/**
 * The analysis methods the engine applies, as fixed sentences. Numbers here
 * are the engine's own constants, so the text cannot drift from the code.
 */
export function analysisMethods(kinds: ReadonlySet<ChartKind>): string[] {
  const lines = [
    `Each measure was plotted on a run chart and analysed with the run chart rules described by Perla, Provost and Murray (2011): a shift of ${SHIFT_LENGTH} or more consecutive points on one side of the median; a trend of ${TREND_LENGTH} or more consecutive points all increasing or all decreasing; and too few or too many runs about the median. The rules were applied only to series of at least ${MINIMUM_RUN_CHART_POINTS} points.`,
  ];
  const control = [...kinds].filter((k) => k !== "run");
  if (control.length) {
    lines.push(
      `Measures suited to a control chart (${control.map((k) => CHART_LABEL[k]).join(", ")}) were also plotted with limits at ${SIGMA_MULTIPLIER} sigma, using the attribute and individuals chart formulas in Montgomery's Introduction to Statistical Quality Control; a point beyond a limit was treated as special cause.`,
    );
  }
  lines.push("Statistics were computed by the project's charting tool from the recorded numerators and denominators, not entered by hand.");
  return lines;
}

export function assembleSquire(r: SquireRecord): SquireDraft {
  const aim = r.aims.at(-1) ?? null;
  const withData = r.measures.filter((m) => m.points > 0);
  const completed = r.cycles.filter((c) => c.completed);
  const changeIdeas = r.drivers.filter((d) => d.kind === "change").map((d) => d.text);
  const annotations = r.measures.flatMap((m) => m.annotations.map((a) => `${a.label}${a.period ? ` (${a.period}, ${m.name})` : ` (${m.name})`}`));

  const s = (number: number, part: SquireSection["part"], title: string, asks: string, fromRecord: string[], author: string[]): SquireSection => ({
    number,
    part,
    title,
    asks,
    fromRecord,
    author,
  });

  const sections: SquireSection[] = [
    s(1, "Title and abstract", "Title", "Indicates this is an improvement study and names the aim.", [`Working title from the registry: ${r.project.title}.`], [
      "Write a title that says this is a quality improvement study and names what improved, for whom.",
    ]),
    s(2, "Title and abstract", "Abstract", "A structured summary in the target venue's headings.", [], [
      "Write the abstract last, in the abstract formatter for your target venue; it counts words against that venue's limit.",
    ]),

    s(3, "Introduction", "Problem description", "The local problem, and its size.", [r.project.problemStatement, ...(aim?.baseline ? [`Baseline recorded with the aim: ${aim.baseline}.`] : [])], [
      ...(aim?.baseline ? [] : ["Give the size of the problem with a local baseline figure and the period it covers."]),
      "Say why the problem matters to patients and to the service.",
    ]),
    s(
      4,
      "Introduction",
      "Available knowledge",
      "What is already known, including prior attempts.",
      r.precedents.length
        ? [
            "Earlier work on a similar problem in this institution's registry:",
            ...r.precedents.map(
              (p) =>
                `- ${p.title} (${p.program}${p.cohortYear ? `, ${p.cohortYear} cohort` : ""}, ${p.status}).${p.outcomeSummary ? ` Outcome recorded: ${p.outcomeSummary}` : ""}${p.endReason ? ` Why it ended: ${p.endReason}` : ""}`,
            ),
          ]
        : [],
      ["Summarise the published literature and relevant guidelines. The registry lists local attempts only; the drafter does not search the literature."],
    ),
    s(
      5,
      "Introduction",
      "Rationale",
      "The theory linking the intervention to the expected improvement.",
      r.drivers.length ? ["The team's driver diagram:", ...r.drivers.map((d) => `${"  ".repeat(d.depth)}- ${KIND_LABEL[d.kind]}: ${d.text}`)] : [],
      [
        ...(r.drivers.length ? [] : ["There is no driver diagram yet. Build one on the Drivers tab: it is the backbone of this section."]),
        "Explain the mechanism by which the changes were expected to improve the outcome, and the theory or framework behind it. Reviewers ask about this section more than any other.",
      ],
    ),
    s(
      6,
      "Introduction",
      "Specific aims",
      "The aim statement, with its five elements.",
      aim
        ? [aim.text, ...(r.aims.length > 1 ? [`The aim was revised during the project; this is version ${aim.version}. Version 1 read: ${r.aims[0]!.text}`] : [])]
        : [],
      !aim
        ? ["There is no aim statement yet. Write it on the Aim tab; it needs all five elements."]
        : aim.missing.length
          ? [`The aim is missing ${aim.missing.join("; ")}. Revise it on the Aim tab: reviewers read the aim first.`]
          : [],
    ),

    s(
      7,
      "Methods",
      "Context",
      "The setting, and what a reader needs to judge whether this would work where they are.",
      [
        `Setting: ${r.project.program} (${r.project.specialty}).`,
        ...(r.project.clinicalOwner ? [`Clinical owner of the process: ${r.project.clinicalOwner}.`] : []),
        ...(r.project.clerDomain ? [`CLER focus area: ${r.project.clerDomain}.`] : []),
        ...(r.project.cohortYear ? [`Led by the ${r.project.cohortYear} trainee cohort.`] : []),
      ],
      ["Describe the unit, staffing, workflow and culture — the contextual factors that helped or hindered, and that a reader elsewhere would need to know."],
    ),
    s(
      8,
      "Methods",
      "Intervention(s)",
      "The changes, in enough detail to reproduce, and the team.",
      [
        ...(changeIdeas.length ? ["Change ideas from the driver diagram:", ...changeIdeas.map((c) => `- ${c}`)] : []),
        ...(r.cycles.length ? ["As planned in the PDSA log:", ...r.cycles.map((c) => `- Cycle ${c.number}: ${c.plan}`)] : []),
      ],
      ["Describe each change in enough detail that another team could reproduce it, and name the team and their roles."],
    ),
    s(
      9,
      "Methods",
      "Study of the intervention(s)",
      "How you judged whether the intervention caused the change — distinct from the intervention itself.",
      [
        ...(r.cycles.length
          ? [
              `Changes were tested in ${r.cycles.length} PDSA ${r.cycles.length === 1 ? "cycle" : "cycles"}; ${r.cycles.filter((c) => c.prediction?.trim()).length} recorded a prediction before the test.`,
            ]
          : []),
        ...(annotations.length ? [`Changes were marked on the charts at: ${annotations.join("; ")}.`] : []),
      ],
      ["Explain how you judged whether the changes caused the observed improvement — for example, the timing of signals against the annotated changes — and what other explanations you considered."],
    ),
    s(
      10,
      "Methods",
      "Measures",
      "The measures, their operational definitions, and their validity and reliability.",
      r.measures.flatMap((m) =>
        m.definition
          ? [
              `${m.name} (${TYPE_LABEL[m.type]} measure, ${CHART_LABEL[m.chartType]}). Numerator: ${m.definition.numerator} Denominator: ${m.definition.denominator} Inclusions: ${m.definition.inclusions} Exclusions: ${m.definition.exclusions} Source: ${m.definition.dataSource}, collected by ${m.definition.puller}, ${m.definition.cadence}.`,
            ]
          : [`${m.name} (${TYPE_LABEL[m.type]} measure, ${CHART_LABEL[m.chartType]}): no operational definition is recorded.`],
      ),
      [
        ...(r.measures.length === 0 ? ["No measures are recorded. Add them on the Measures tab."] : []),
        ...r.measures.filter((m) => !m.definition).map((m) => `Write the operational definition for “${m.name}” in Charts before submitting.`),
        ...(r.measures.some((m) => m.type === "balancing") ? [] : ["There is no balancing measure; reviewers will ask what else might have got worse."]),
        "Comment on the validity and reliability of each measure, including how completely the data were captured.",
      ],
    ),
    s(11, "Methods", "Analysis", "The analysis methods, including the SPC rules.", r.measures.length ? analysisMethods(new Set(r.measures.map((m) => m.chartType))) : [], [
      "Add any analysis beyond statistical process control, and name any software used outside this tool.",
    ]),
    s(
      12,
      "Methods",
      "Ethical considerations",
      "Including the IRB or QI determination.",
      r.screening
        ? [
            `A QI-versus-research screening on ${r.screening.date} suggested: ${r.screening.outcome}. ${r.screening.citedPolicy ? `It cited the local policy “${r.screening.citedPolicy}”.` : "The institution's determination policy was not in the library at the time."} A screening is not a determination.`,
          ]
        : [],
      [
        ...(r.screening ? [] : ["Run the IRB / QI pre-check on the Scholarship tab."]),
        "State the formal determination: who made it, when, and its reference. Most venues will not accept the work without it.",
      ],
    ),

    s(
      13,
      "Results",
      "Results",
      "How the intervention evolved, the measures over time, unintended consequences and missing data.",
      withData.length === 0 && completed.length === 0
        ? []
        : [
            ...r.measures.flatMap((m) =>
              m.chart
                ? [`${m.name} (${TYPE_LABEL[m.type]} measure): ${m.chart.description}`]
                : [`${m.name} (${TYPE_LABEL[m.type]} measure): no data points are recorded.`],
            ),
            ...(completed.length
              ? [
                  "Completed PDSA cycles, prediction against result:",
                  ...completed.map((c) => `- Cycle ${c.number}${c.actDecision ? ` (${c.actDecision})` : ""}: predicted “${c.prediction ?? ""}” Found: “${c.studyResult ?? ""}”`),
                ]
              : []),
          ],
      withData.length === 0 && completed.length === 0
        ? ["No data points or completed PDSA cycles are recorded, so there are no results to report. This section stays empty until there are; nothing is written in its place."]
        : [
            "Describe how the intervention evolved over the cycles, any unintended consequences, and any missing data. Include the annotated charts (download them from each measure's page).",
          ],
    ),

    s(14, "Discussion", "Summary", "Key findings, and their relation to the rationale.", [], ["State the key findings and how they relate to the Rationale section."]),
    s(15, "Discussion", "Interpretation", "Mechanism, comparison with other work, and expected against observed outcomes.", [], [
      "Interpret the findings: the likely mechanism, how they compare with the published work under Available knowledge, and where observed outcomes differed from those expected.",
    ]),
    s(16, "Discussion", "Limitations", "Limits to internal validity and generalisability, and what was done about them.", [], [
      "Set out the limitations — confounders, data quality, single-site context — and what you did to reduce them.",
    ]),
    s(
      17,
      "Discussion",
      "Conclusions",
      "Usefulness, sustainability, and implications.",
      [
        ...(r.project.outcomeSummary ? [`Outcome recorded when the project was completed: ${r.project.outcomeSummary}`] : []),
        ...(r.sustainability ? [`Sustainability plan: the change is owned by ${r.sustainability.changeOwner} and reviewed by ${r.sustainability.reviewer}, ${r.sustainability.cadence}.`] : []),
      ],
      ["Say what the work means for practice here and elsewhere, and what comes next."],
    ),

    s(18, "Other information", "Funding", "Funding, and conflicts of interest.", [], ["Declare funding and any conflicts of interest for every author."]),
  ];

  return { title: r.project.title, sections };
}

export function squireMarkdown(draft: SquireDraft, generatedOn: string): string {
  const lines = [
    `# ${draft.title} — SQUIRE 2.0 draft`,
    "",
    `> Assembled on ${generatedOn} from the project record, the PDSA log and the charts, in SQUIRE 2.0 section order. No language model wrote any of it, and nothing here states a result that is not in the record. Every section marked **${AUTHOR_MARK}** needs your writing before submission.`,
  ];
  let part = "";
  for (const section of draft.sections) {
    if (section.part !== part) {
      part = section.part;
      lines.push("", `## ${part}`);
    }
    lines.push("", `### ${section.number}. ${section.title}`, "", `_${section.asks}_`);
    // Each record line is its own paragraph; list items stay together.
    section.fromRecord.forEach((line, i) => {
      const item = line.trimStart().startsWith("- ");
      const prevItem = i > 0 && section.fromRecord[i - 1]!.trimStart().startsWith("- ");
      lines.push(...(item && (prevItem || i > 0) ? [] : [""]), line);
    });
    for (const prompt of section.author) lines.push("", `> **${AUTHOR_MARK}:** ${prompt}`);
  }
  return lines.join("\n") + "\n";
}
