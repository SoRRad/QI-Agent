import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { STALL_DAYS } from "@/lib/jobs/stall";
import { studioChart, toObservations, type StudioChart } from "@/lib/charts/studio";
import { MINIMUM_BASELINE_POINTS } from "@/lib/spc";
import type { ChartAnnotation } from "@/lib/charts/layout";
import { quarterLabel } from "@/lib/pulse/quarter";
import { surveyRates } from "@/lib/pulse/results";
import { STATUS_LABEL } from "@/lib/pulse/barriers";
import { tracker } from "../curriculum";
import { requireCommittee } from "./access";
import { loadTrackerInputs } from "./curriculum";

/**
 * The chair dashboard (§6.6, §7). It opens with the institution's headline
 * measure as an annotated run chart; every other institution-level measure is
 * a run chart too, never a bar or a stat card. The attention lists follow.
 */

const RUN = { view: "run", baseline: null, westernElectric: false } as const;
const HANDOFF_STALL_DAYS = 14;

export interface InstitutionChart {
  id: string;
  name: string;
  isHeadline: boolean;
  points: number;
  chart: StudioChart;
  annotations: ChartAnnotation[];
  /** Points in the frozen baseline, or null when the median is the whole series'. */
  baseline: number | null;
}

/**
 * An institution chart asks one question: did the committee's changes move
 * the measure? So its median is frozen on the periods before the first
 * committee intervention and extended across the rest, as the studio does on
 * request. A median over the whole series sits between the before and after
 * and flags the baseline itself as a "shift". With no annotation, or too few
 * points before it, the whole series is used.
 */
export function baselineFor(points: number, annotations: readonly ChartAnnotation[]): number | null {
  const first = annotations
    .map((a) => a.periodIndex)
    .filter((i): i is number => i !== null && i >= 1)
    .sort((a, b) => a - b)[0];
  if (first === undefined) return null;
  const length = first - 1;
  return length >= MINIMUM_BASELINE_POINTS && length < points ? length : null;
}

/** Institution-level measures with data, each as a run chart; the headline first. */
export async function institutionCharts(): Promise<InstitutionChart[]> {
  const measures = await db.measure.findMany({
    where: { isLibrary: true, deprecated: false, dataPoints: { some: {} } },
    orderBy: [{ isHeadline: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      chartType: true,
      isHeadline: true,
      dataPoints: {
        orderBy: { periodIndex: "asc" },
        select: {
          periodLabel: true,
          value: true,
          numerator: true,
          denominator: true,
        },
      },
      annotations: {
        orderBy: [{ periodIndex: "asc" }, { date: "asc" }],
        select: { label: true, periodIndex: true, description: true },
      },
    },
  });
  return measures.map((m) => {
    const baseline = baselineFor(m.dataPoints.length, m.annotations);
    return {
      id: m.id,
      name: m.name,
      isHeadline: m.isHeadline,
      points: m.dataPoints.length,
      chart: studioChart(m.chartType, toObservations(m.dataPoints), {
        ...RUN,
        baseline,
      }),
      annotations: m.annotations,
      baseline,
    };
  });
}

export interface PulseRatePoint {
  quarter: string;
  label: string;
  responded: number;
  trainees: number;
  percent: number | null;
}

/** The response rate for each survey that has opened, oldest first. */
export async function pulseRateSeries(): Promise<PulseRatePoint[]> {
  const surveys = await db.pulseSurvey.findMany({
    where: { status: { in: ["open", "closed"] } },
    orderBy: { quarter: "asc" },
    select: { id: true, quarter: true },
  });
  const rows: PulseRatePoint[] = [];
  for (const s of surveys) {
    const { total } = await surveyRates(s.id);
    rows.push({
      quarter: s.quarter,
      label: quarterLabel(s.quarter),
      responded: total.responded,
      trainees: total.trainees,
      percent: total.percent,
    });
  }
  return rows;
}

/** A run chart of the pulse response rate, once there are two quarters to plot. */
export function pulseRateChart(series: readonly PulseRatePoint[]): StudioChart | null {
  const plotted = series.filter((p) => p.trainees > 0);
  if (plotted.length < 2) return null;
  return studioChart(
    "p",
    toObservations(
      plotted.map((p) => ({
        periodLabel: p.quarter,
        value: (p.responded / p.trainees) * 100,
        numerator: p.responded,
        denominator: p.trainees,
      })),
    ),
    RUN,
  );
}

export async function dashboard(user: User) {
  requireCommittee(user);
  const now = Date.now();
  const staleBefore = new Date(now - STALL_DAYS * 86_400_000);
  const handoffBefore = new Date(now - HANDOFF_STALL_DAYS * 86_400_000);

  const [charts, pulse, barrierCounts, gaps, stalled, activeCount, idleCount] = await Promise.all([
    institutionCharts(),
    pulseRateSeries(),
    db.barrier.groupBy({ by: ["status"], _count: { _all: true } }),
    db.knowledgeGap.findMany({
      where: { status: "open" },
      orderBy: { askCount: "desc" },
      select: { id: true, question: true, askCount: true, gapSummary: true },
    }),
    db.project.findMany({
      where: {
        OR: [
          { status: "stalled" },
          // A handoff unaccepted for 14 days is a stall signal (addition C1).
          {
            status: "active",
            handoffs: {
              some: { acceptedAt: null, createdAt: { lt: handoffBefore } },
            },
          },
        ],
      },
      orderBy: { stalledAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        stalledAt: true,
        stallReason: true,
        program: { select: { specialty: true } },
        owner: { select: { name: true } },
        coach: { select: { name: true } },
        handoffs: {
          where: { acceptedAt: null },
          take: 1,
          select: { createdAt: true, toUser: { select: { name: true } } },
        },
      },
    }),
    db.project.count({ where: { status: "active" } }),
    db.project.count({
      where: { status: "active", lastActivityAt: { lt: staleBefore } },
    }),
  ]);

  const barriers = (Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((status) => ({
    status,
    label: STATUS_LABEL[status],
    count: barrierCounts.find((b) => b.status === status)?._count._all ?? 0,
  }));

  // Curriculum records are chair-only (Q4): coaches see the rest of the page.
  const curriculum = user.role === "chair" ? tracker(...(await loadTrackerInputs())).programs : null;

  return {
    headline: charts.find((c) => c.isHeadline) ?? null,
    others: charts.filter((c) => !c.isHeadline),
    pulse,
    pulseChart: pulseRateChart(pulse),
    barriers,
    gaps,
    stalled,
    activeCount,
    idleCount,
    curriculum,
    stallDays: STALL_DAYS,
    handoffStallDays: HANDOFF_STALL_DAYS,
  };
}
