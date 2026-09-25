import { audit } from "@/lib/audit";
import { describeChart } from "@/lib/charts/describe";
import { studioChart, toObservations } from "@/lib/charts/studio";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { surveyRates } from "@/lib/pulse/results";
import { academicYear, annualReportMarkdown, assembleAnnualReport, type AnnualReportData } from "../annualReport";
import { EVENT_TYPE_LABEL } from "../eventKit";
import { tracker } from "../curriculum";
import { requireChair } from "./access";
import { loadTrackerInputs } from "./curriculum";
import { baselineFor } from "./dashboard";

/**
 * Gathers the annual report's figures for one academic year. Chair-only: it
 * includes curriculum completion, which is.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2024" → 1 October 2024 UTC; null for a label that is not a month. */
export function monthStart(label: string): Date | null {
  const m = /^([A-Z][a-z]{2})\s+(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!);
  return month < 0 ? null : new Date(Date.UTC(Number(m[2]), month, 1));
}

const day = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export async function annualReportData(user: User, startYear: number, now = new Date()): Promise<AnnualReportData> {
  requireChair(user, "The annual report");
  const year = academicYear(startYear);
  const inYear = { gte: year.start, lt: year.end };

  const [headline, submitted, completed, archived, activeNow, stalledNow, programs, surveys, barriers, events, abstractDrafts, irbScreenings, resolvedGaps, openGaps] =
    await Promise.all([
      db.measure.findFirst({
        where: { isHeadline: true },
        select: {
          name: true,
          chartType: true,
          dataPoints: {
            orderBy: { periodIndex: "asc" },
            select: {
              periodIndex: true,
              periodLabel: true,
              value: true,
              numerator: true,
              denominator: true,
            },
          },
          annotations: {
            orderBy: { date: "asc" },
            select: { label: true, periodIndex: true, date: true },
          },
        },
      }),
      db.project.findMany({
        where: { submittedAt: inYear },
        select: { program: { select: { name: true } } },
      }),
      db.project.findMany({
        where: { completedAt: inYear },
        orderBy: { completedAt: "asc" },
        select: {
          title: true,
          outcomeSummary: true,
          program: { select: { name: true } },
        },
      }),
      db.project.count({ where: { archivedAt: inYear } }),
      db.project.count({ where: { status: "active" } }),
      db.project.count({ where: { status: "stalled" } }),
      db.program.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      db.pulseSurvey.findMany({
        where: { openedAt: inYear },
        orderBy: { quarter: "asc" },
        select: { id: true, quarter: true },
      }),
      db.barrier.findMany({
        where: { closedAt: inYear },
        orderBy: { closedAt: "asc" },
        select: { themeLabel: true, decision: true, whatChanged: true },
      }),
      db.event.findMany({
        where: { date: inYear },
        orderBy: { date: "asc" },
        select: {
          title: true,
          type: true,
          date: true,
          submissions: { select: { project: { select: { title: true } } } },
        },
      }),
      db.abstractDraft.count({ where: { createdAt: inYear } }),
      db.irbPrecheck.count({ where: { createdAt: inYear } }),
      db.knowledgeGap.count({ where: { status: "resolved", updatedAt: inYear } }),
      db.knowledgeGap.count({ where: { status: "open" } }),
    ]);

  let headlineData: AnnualReportData["headline"] = null;
  if (headline) {
    const upToYearEnd = headline.dataPoints.filter((p) => {
      const start = monthStart(p.periodLabel);
      return start === null || start < year.end;
    });
    // Read as the dashboard reads it: median frozen before the first intervention.
    const baseline = baselineFor(upToYearEnd.length, headline.annotations);
    const chart = upToYearEnd.length
      ? studioChart(headline.chartType, toObservations(upToYearEnd), {
          view: "run",
          baseline,
          westernElectric: false,
        })
      : null;
    headlineData = {
      name: headline.name,
      reading: chart ? describeChart(chart.analysis, chart.unit) : null,
      points: upToYearEnd.length,
      annotations: headline.annotations
        .filter((a) => a.date >= year.start && a.date < year.end)
        .map((a) => ({
          period: headline.dataPoints.find((p) => p.periodIndex === a.periodIndex)?.periodLabel ?? day(a.date),
          label: a.label,
        })),
    };
  }

  const pulse: AnnualReportData["pulse"] = [];
  for (const s of surveys) {
    const { total } = await surveyRates(s.id);
    pulse.push({
      quarter: s.quarter,
      responded: total.responded,
      trainees: total.trainees,
      percent: total.percent,
    });
  }

  return {
    year,
    generatedOn: now,
    yearToDate: now < year.end,
    headline: headlineData,
    registry: {
      submitted: submitted.length,
      completed: completed.map((p) => ({
        title: p.title,
        program: p.program.name,
        outcome: p.outcomeSummary,
      })),
      archived,
      activeNow,
      stalledNow,
      byProgram: programs.map((p) => ({
        program: p.name,
        submitted: submitted.filter((s) => s.program.name === p.name).length,
        completed: completed.filter((c) => c.program.name === p.name).length,
      })),
    },
    pulse,
    barriersClosed: barriers.map((b) => ({
      label: b.themeLabel,
      decision: b.decision,
      whatChanged: b.whatChanged,
    })),
    scholarly: {
      events: events.map((e) => ({
        title: e.title ?? "Untitled event",
        type: EVENT_TYPE_LABEL[e.type].toLowerCase(),
        date: day(e.date),
        submissions: e.submissions.map((s) => s.project.title),
      })),
      abstractDrafts,
      irbScreenings,
    },
    curriculum: tracker(...(await loadTrackerInputs())).programs,
    gaps: { resolvedInYear: resolvedGaps, openNow: openGaps },
  };
}

export async function annualReport(user: User, startYear: number, now = new Date()) {
  return assembleAnnualReport(await annualReportData(user, startYear, now));
}

export async function annualReportDownload(user: User, startYear: number, now = new Date()): Promise<{ filename: string; markdown: string }> {
  const report = await annualReport(user, startYear, now);
  await audit({
    userId: user.id,
    action: "export.generated",
    entity: "AnnualReport",
    metadata: { kind: "annual_report_md", startYear },
  });
  return {
    filename: `qi-committee-annual-report-${academicYear(startYear).label.replace("–", "-")}.md`,
    markdown: annualReportMarkdown(report),
  };
}
