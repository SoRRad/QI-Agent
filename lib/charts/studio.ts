import {
  analyse,
  analyseAgainstBaseline,
  MINIMUM_BASELINE_POINTS,
  type ChartKind,
  type Observation,
  type SpcAnalysis,
} from "@/lib/spc";
import { unitFor } from "./describe";

/**
 * The SPC studio's model, as pure functions of stored rows and URL state.
 *
 * The studio's controls are links, not client state: every view of a chart
 * has a URL, so a coach can send a trainee "the frozen-baseline p chart" and
 * both see the same thing, and the page works before JavaScript loads.
 */

export type StudioView = "run" | "control";

export interface StudioParams {
  view: StudioView;
  /** Freeze the centre line from the first N points; null for the whole series. */
  baseline: number | null;
  westernElectric: boolean;
}

export interface StoredPoint {
  periodLabel: string;
  value: number;
  numerator: number | null;
  denominator: number | null;
}

type Search = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Anything unrecognised falls back to the default rather than erroring. */
export function parseStudioParams(search: Search, chartType: ChartKind, points: number): StudioParams {
  const view: StudioView = chartType !== "run" && first(search["view"]) === "control" ? "control" : "run";
  const raw = Number(first(search["baseline"]));
  const baseline =
    Number.isInteger(raw) && raw >= MINIMUM_BASELINE_POINTS && raw < points ? raw : null;
  return { view, baseline, westernElectric: view === "control" && first(search["we"]) === "on" };
}

/** The query string for a set of params, omitting defaults. */
export function studioQuery(params: StudioParams): string {
  const q = new URLSearchParams();
  if (params.view === "control") q.set("view", "control");
  if (params.baseline !== null) q.set("baseline", String(params.baseline));
  if (params.westernElectric && params.view === "control") q.set("we", "on");
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function toObservations(points: readonly StoredPoint[]): Observation[] {
  return points.map((p) => ({
    label: p.periodLabel,
    value: p.value,
    ...(p.numerator !== null ? { numerator: p.numerator } : {}),
    ...(p.denominator !== null ? { denominator: p.denominator } : {}),
  }));
}

export interface StudioChart {
  kind: ChartKind;
  unit: string;
  analysis: SpcAnalysis;
}

/**
 * Runs the engine for the requested view.
 *
 * The run view plots the stored values (a p measure's are already percent).
 * The control view hands numerators and denominators to the control chart,
 * which re-derives each value itself, so the chart and the stored value cannot
 * disagree.
 */
export function studioChart(chartType: ChartKind, observations: Observation[], params: StudioParams): StudioChart {
  const kind: ChartKind = params.view === "run" ? "run" : chartType;
  const unit = unitFor(kind, chartType);
  const options = {
    multiplier: kind === "p" ? 100 : 1,
    westernElectric: params.westernElectric,
    detectAstronomicalPoints: kind === "run",
  };
  const analysis =
    params.baseline !== null
      ? analyseAgainstBaseline(kind, observations, params.baseline, options)
      : analyse(kind, observations, options);
  return { kind, unit, analysis };
}

export interface BaselineChoice {
  length: number;
  /** "Before ① Discharge summary in the afternoon huddle" */
  label: string;
  annotationNumber: number;
}

/**
 * Baselines worth offering: the points before each annotated change. A team
 * freezes the baseline at the moment they changed something, so the choices
 * come from the annotations rather than a number field.
 */
export function baselineChoices(
  annotations: ReadonlyArray<{ label: string; periodIndex: number | null }>,
  points: number,
): BaselineChoice[] {
  const seen = new Set<number>();
  const choices: BaselineChoice[] = [];
  annotations
    .filter((a) => a.periodIndex !== null && a.periodIndex >= 1 && a.periodIndex <= points)
    .forEach((a, i) => {
      const length = (a.periodIndex as number) - 1;
      if (length < MINIMUM_BASELINE_POINTS || length >= points || seen.has(length)) return;
      seen.add(length);
      choices.push({ length, label: a.label, annotationNumber: i + 1 });
    });
  return choices;
}
