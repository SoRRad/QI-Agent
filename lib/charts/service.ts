import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { canRead } from "@/lib/auth/scope";
import { runPrompt } from "@/lib/llm/run";
import type { LlmDependencies } from "@/lib/llm";
import { renderPlaceholders } from "@/lib/llm/guards/numeric";
import { chartInterpretationPrompt, interpretationValues } from "@/lib/llm/prompts";
import { parseStudioParams, studioChart, toObservations } from "./studio";

/**
 * Loading a measure for the studio, with the sensitivity policy applied.
 *
 * The measure and its definition are cross-program (Q4): anyone can see what
 * another program measures and how. Its data points and annotations belong to
 * the owning program, its coach and the chair. A library measure has no owning
 * project, so only the chair may change it.
 */

export class MeasureNotFoundError extends Error {
  constructor() {
    super("That measure does not exist.");
    this.name = "MeasureNotFoundError";
  }
}

export class MeasureAccessError extends Error {
  constructor(message = "Only the owning program, its coach and the chair can change this measure.") {
    super(message);
    this.name = "MeasureAccessError";
  }
}

export async function loadMeasure(user: User, measureId: string) {
  const measure = await db.measure.findUnique({
    where: { id: measureId },
    select: {
      id: true,
      name: true,
      type: true,
      chartType: true,
      isLibrary: true,
      promotedAt: true,
      deprecated: true,
      deprecatedAt: true,
      deprecationNote: true,
      supersededBy: { select: { id: true, name: true } },
      basedOn: {
        select: {
          id: true,
          name: true,
          deprecated: true,
          deprecatedAt: true,
          deprecationNote: true,
          supersededBy: { select: { id: true, name: true } },
        },
      },
      _count: { select: { derivedMeasures: true } },
      project: { select: { id: true, title: true, programId: true, coachId: true, status: true } },
      definitions: { orderBy: { version: "desc" } },
    },
  });
  if (!measure) throw new MeasureNotFoundError();

  const resource = { programId: measure.project?.programId ?? null, coachId: measure.project?.coachId ?? null };
  const canSeeData = !measure.isLibrary && canRead(user, "DataPoint", undefined, resource);
  const canEdit = user.role === "chair" || (!measure.isLibrary && canSeeData);

  const [points, annotations] = canSeeData
    ? await Promise.all([
        db.dataPoint.findMany({
          where: { measureId },
          orderBy: { periodIndex: "asc" },
          select: { periodIndex: true, periodLabel: true, value: true, numerator: true, denominator: true },
        }),
        db.annotation.findMany({
          where: { measureId },
          orderBy: [{ periodIndex: "asc" }, { date: "asc" }],
          select: { id: true, label: true, description: true, periodIndex: true, date: true },
        }),
      ])
    : [[], []];

  return { measure, points, annotations, canSeeData, canEdit };
}

export type LoadedMeasure = Awaited<ReturnType<typeof loadMeasure>>;

/** A measure's name for a page title. Names are cross-program, so no access check is needed. */
export async function measureName(measureId: string): Promise<string> {
  const measure = await db.measure.findUnique({ where: { id: measureId }, select: { name: true } });
  return measure?.name ?? "Measure";
}

/** Throws unless the user may change this measure's data or definition. */
export async function requireMeasureEdit(user: User, measureId: string): Promise<LoadedMeasure> {
  const loaded = await loadMeasure(user, measureId);
  if (!loaded.canEdit) {
    throw new MeasureAccessError(
      loaded.measure.isLibrary
        ? "Only the chair can change a library measure."
        : "Only the owning program, its coach and the chair can change this measure.",
    );
  }
  return loaded;
}

/**
 * "Explain this chart". The model receives the computed analysis as
 * placeholders — never the series — and its prose is filled from values
 * TypeScript formatted, after the numeric guard has passed.
 */
export async function interpretChart(
  user: User,
  measureId: string,
  search: Record<string, string>,
  deps: LlmDependencies = {},
): Promise<string> {
  const { measure, points, annotations, canSeeData } = await loadMeasure(user, measureId);
  if (!canSeeData) throw new MeasureAccessError("You can see this measure's definition, but not its data.");
  if (points.length === 0) return "There are no data points to interpret yet.";
  const params = parseStudioParams(search, measure.chartType, points.length);

  const { unit, analysis } = studioChart(measure.chartType, toObservations(points), params);
  const input = {
    measureName: measure.name,
    unit,
    analysis,
    annotations: annotations.map((a) => ({ label: a.label, periodIndex: a.periodIndex })),
  };
  const output = await runPrompt(chartInterpretationPrompt, input, { userId: user.id }, deps);
  return renderPlaceholders(output.interpretation, interpretationValues(input));
}
