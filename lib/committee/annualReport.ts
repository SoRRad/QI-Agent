import type { ProgramCompletion } from "./curriculum";

/**
 * The annual report generator (§6.6): a GMEC-ready report for one academic
 * year, assembled from counts made in code and text copied from the record.
 * No model writes any of it, for the reason SQUIRE drafts are assembled
 * (ADR-0013): a report to the GMEC that invents a figure is worse than none.
 *
 * Where the record cannot say something for a past date — which projects were
 * active on 30 June, how many trainees a program had last autumn — the report
 * says what it is counting instead, rather than presenting a snapshot as history.
 */

export interface AcademicYear {
  /** "2025–26". */
  label: string;
  /** 1 July, 00:00 UTC. */
  start: Date;
  /** 1 July of the following year, exclusive. */
  end: Date;
}

/** The academic year (July to June) that starts in `startYear`. */
export function academicYear(startYear: number): AcademicYear {
  return {
    label: `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`,
    start: new Date(Date.UTC(startYear, 6, 1)),
    end: new Date(Date.UTC(startYear + 1, 6, 1)),
  };
}

/** The start year of the academic year containing `date`. */
export function academicYearOf(date: Date): number {
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** Default: the last completed academic year, which is what a GMEC report covers. */
export function defaultReportYear(today: Date): number {
  return academicYearOf(today) - 1;
}

export interface AnnualReportData {
  year: AcademicYear;
  generatedOn: Date;
  /** True when the year has not ended: the report is a year-to-date draft. */
  yearToDate: boolean;
  headline: {
    name: string;
    /** The SPC engine's description of the points up to the year's end. */
    reading: string | null;
    points: number;
    annotations: Array<{ period: string; label: string }>;
  } | null;
  registry: {
    submitted: number;
    completed: Array<{
      title: string;
      program: string;
      outcome: string | null;
    }>;
    archived: number;
    /** Now, not at year end: the record keeps no status history. */
    activeNow: number;
    stalledNow: number;
    byProgram: Array<{ program: string; submitted: number; completed: number }>;
  };
  pulse: Array<{
    quarter: string;
    responded: number;
    trainees: number;
    percent: number | null;
  }>;
  barriersClosed: Array<{
    label: string;
    decision: string | null;
    whatChanged: string | null;
  }>;
  scholarly: {
    events: Array<{
      title: string;
      type: string;
      date: string;
      submissions: string[];
    }>;
    abstractDrafts: number;
    irbScreenings: number;
  };
  curriculum: ProgramCompletion[];
  gaps: { resolvedInYear: number; openNow: number };
}

export interface ReportTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

/** A Markdown line, or a table. */
export type ReportBlock = string | ReportTable;

export interface ReportSection {
  heading: string;
  lines: ReportBlock[];
}

const AUTHOR = "AUTHOR INPUT NEEDED:";
const day = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const lastDay = (y: AcademicYear) => day(new Date(y.end.getTime() - 86_400_000));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function assembleAnnualReport(d: AnnualReportData): {
  title: string;
  subtitle: string;
  sections: ReportSection[];
} {
  const sections: ReportSection[] = [];

  sections.push({
    heading: "About this report",
    lines: [
      `Covers ${day(d.year.start)} to ${lastDay(d.year)}${d.yearToDate ? `, to date: the year has not ended, so this is a draft of the year so far` : ""}. Generated from QI Agent on ${day(d.generatedOn)}.`,
      "Every figure is counted from the record by the system. Every chart reading is the SPC engine's, using the rules on the chart. No part of this report was written by a language model.",
      `${AUTHOR} the chair's summary of the year, and the committee's priorities for the next.`,
    ],
  });

  sections.push({
    heading: "Headline measure",
    lines: d.headline
      ? [
          `**${d.headline.name}**`,
          d.headline.reading ?? "No data points recorded to the end of this year.",
          ...(d.headline.annotations.length
            ? ["Committee interventions this year:", ...d.headline.annotations.map((a) => `- ${a.period}: ${a.label}`)]
            : ["No committee intervention was annotated on the chart this year."]),
        ]
      : ["No headline measure is set. The chair sets one from the measure library."],
  });

  const r = d.registry;
  sections.push({
    heading: "Project registry",
    lines: [
      `${plural(r.submitted, "project")} submitted, ${r.completed.length} completed and ${r.archived} archived during the year.`,
      `Now, on ${day(d.generatedOn)}: ${r.activeNow} active and ${r.stalledNow} stalled. (The registry records when projects change status, not what every status was on a past date.)`,
      ...(r.byProgram.length
        ? [
            {
              caption: "Projects by program",
              headers: ["Program", "Submitted", "Completed"],
              rows: r.byProgram.map((p) => [p.program, String(p.submitted), String(p.completed)]),
            },
          ]
        : []),
      ...(r.completed.length ? ["", "Completed this year:", ...r.completed.map((p) => `- **${p.title}** (${p.program})${p.outcome ? ` — ${p.outcome}` : ""}`)] : []),
    ],
  });

  sections.push({
    heading: "Trainee pulse survey",
    lines: d.pulse.length
      ? [
          "Response rate by quarter: trainees who responded, against active trainees now (the record does not keep past rosters).",
          {
            caption: "Pulse response rate by quarter",
            headers: ["Quarter", "Responded", "Trainees", "Rate"],
            rows: d.pulse.map((p) => [p.quarter, String(p.responded), String(p.trainees), p.percent === null ? "—" : `${p.percent}%`]),
          },
          ...(d.pulse.length < 2 ? ["One quarter is not a trend. The dashboard plots the rate as a run chart once there are two."] : []),
        ]
      : ["No pulse survey ran in this year."],
  });

  sections.push({
    heading: "Barriers closed",
    lines: d.barriersClosed.length
      ? d.barriersClosed.map((b) => `- **${b.label}**${b.decision ? ` — Decision: ${b.decision}` : ""}${b.whatChanged ? ` What changed: ${b.whatChanged}` : ""}`)
      : ["No barrier was closed in this year."],
  });

  const s = d.scholarly;
  sections.push({
    heading: "Scholarly output",
    lines: [
      ...(s.events.length
        ? s.events.map((e) => `- ${e.title} (${e.type}, ${e.date})${e.submissions.length ? ` — ${plural(e.submissions.length, "submission")}: ${e.submissions.join("; ")}` : ""}`)
        : ["No committee event was held in this year."]),
      "",
      `${plural(s.abstractDrafts, "abstract draft")} and ${plural(s.irbScreenings, "IRB / QI screening")} were started in QI Agent during the year.`,
      `${AUTHOR} presentations and publications outside the institution. QI Agent records drafts, not acceptances.`,
    ],
  });

  sections.push({
    heading: "Curriculum completion",
    lines: d.curriculum.length
      ? [
          `Completion now, on ${day(d.generatedOn)}, of the items in the curriculum tracker.`,
          {
            caption: "Curriculum completion by program",
            headers: ["Program", "Trainees", "Completed", "Of", "Rate"],
            rows: d.curriculum.map((p) => [p.program, String(p.trainees), String(p.completed), String(p.possible), p.percent === null ? "—" : `${p.percent}%`]),
          },
        ]
      : ["No curriculum records have been imported."],
  });

  sections.push({
    heading: "Knowledge gaps",
    lines: [
      `${plural(d.gaps.resolvedInYear, "question")} Ask could not answer ${d.gaps.resolvedInYear === 1 ? "was" : "were"} resolved with a library document this year; ${d.gaps.openNow} remain open now.`,
    ],
  });

  return {
    title: `QI committee annual report — academic year ${d.year.label}`,
    subtitle: `For the Graduate Medical Education Committee · ${day(d.year.start)} to ${lastDay(d.year)}${d.yearToDate ? " (to date)" : ""}`,
    sections,
  };
}

const isItem = (line: string) => /^\s*- /.test(line);

/** Joins text lines as Markdown: a paragraph each, except consecutive list items, which stay one list. */
export function joinLines(lines: readonly string[]): string {
  return lines.filter((l) => l !== "").reduce((out, line, i, all) => (i === 0 ? line : `${out}${isItem(line) && isItem(all[i - 1]!) ? "\n" : "\n\n"}${line}`), "");
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

/** Consecutive text lines as one Markdown string; tables kept as tables. */
export function groupBlocks(lines: readonly ReportBlock[]): Array<string | ReportTable> {
  const out: Array<string[] | ReportTable> = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (typeof line === "string") {
      if (Array.isArray(last)) last.push(line);
      else out.push([line]);
    } else out.push(line);
  }
  return out.map((b) => (Array.isArray(b) ? joinLines(b) : b)).filter((b) => b !== "");
}

function tableMarkdown(t: ReportTable): string {
  return [`| ${t.headers.map(cell).join(" | ")} |`, `| ${t.headers.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

export function annualReportMarkdown(report: ReturnType<typeof assembleAnnualReport>): string {
  return (
    [
      `# ${report.title}`,
      `_${report.subtitle}_`,
      ...report.sections.flatMap((s) => [`## ${s.heading}`, ...groupBlocks(s.lines).map((b) => (typeof b === "string" ? b : tableMarkdown(b)))]),
    ].join("\n\n") + "\n"
  );
}
