import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { touchActivity } from "@/lib/projects/service";
import { recordUsage } from "@/lib/usage";
import { importRows, type Cells, type ImportRow } from "./importRows";
import { MeasureAccessError, requireMeasureEdit } from "./service";

/**
 * Writing data points and annotations. Every free-text field — the period
 * label, an annotation's label and description — passes the PHI guard inside
 * the database client on the way in.
 */

export class DataEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataEntryError";
  }
}

export const MAX_POINTS_PER_UPLOAD = 500;

export type AddPointsResult = { ok: true; added: number; first: string; last: string } | { ok: false; rows: ImportRow[] };

export async function addPoints(user: User, measureId: string, cells: readonly Cells[]): Promise<AddPointsResult> {
  const { measure, points } = await requireMeasureEdit(user, measureId);
  if (measure.isLibrary) throw new MeasureAccessError("A library definition has no data of its own; add points to a project measure.");
  if (cells.length === 0) throw new DataEntryError("There are no rows to add.");
  if (cells.length > MAX_POINTS_PER_UPLOAD) throw new DataEntryError(`Add at most ${MAX_POINTS_PER_UPLOAD} points at a time.`);

  const cadence = measure.definitions[0]?.cadence ?? null;
  const rows = importRows(cells, measure.chartType, cadence, new Set(points.map((p) => p.periodLabel)));
  if (rows.some((r) => r.error)) return { ok: false, rows };

  const start = (points.at(-1)?.periodIndex ?? 0) + 1;
  try {
    await db.dataPoint.createMany({
      data: rows.map((r, i) => ({
        measureId,
        periodIndex: start + i,
        periodLabel: r.label,
        value: r.point!.value,
        numerator: r.point!.numerator,
        denominator: r.point!.denominator,
        subgroupSize: r.point!.subgroupSize,
        enteredById: user.id,
      })),
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new DataEntryError("Someone else added points to this measure at the same moment. Reload the page and try again.");
    }
    throw error;
  }

  const first = rows[0]!.label;
  const last = rows.at(-1)!.label;
  await audit({
    userId: user.id,
    action: "datapoint.created",
    entity: "Measure",
    entityId: measureId,
    metadata: { count: rows.length, firstPeriodIndex: start },
  });
  // A data point is project activity: it resets the stall clock (§6.2).
  if (measure.project) await touchActivity(measure.project.id, user.id);
  if (points.length === 0) {
    await recordUsage("chart_created", { id: user.id, role: user.role, programId: user.programId }, { entityId: measureId });
  }
  return { ok: true, added: rows.length, first, last };
}

/** Removes the most recent point: the correction for a mistyped entry. */
export async function removeLatestPoint(user: User, measureId: string): Promise<string> {
  const { measure, points } = await requireMeasureEdit(user, measureId);
  if (measure.isLibrary) throw new MeasureAccessError();
  const latest = points.at(-1);
  if (!latest) throw new DataEntryError("There are no points to remove.");
  await db.dataPoint.delete({ where: { measureId_periodIndex: { measureId, periodIndex: latest.periodIndex } } });
  await audit({
    userId: user.id,
    action: "datapoint.deleted",
    entity: "Measure",
    entityId: measureId,
    metadata: { periodIndex: latest.periodIndex },
  });
  return latest.periodLabel;
}

export interface AnnotationInput {
  label: string;
  description: string | null;
  periodIndex: number | null;
  date: Date;
}

export async function addAnnotation(user: User, measureId: string, input: AnnotationInput): Promise<void> {
  const { measure, points } = await requireMeasureEdit(user, measureId);
  if (measure.isLibrary) throw new MeasureAccessError();
  if (input.periodIndex !== null && !points.some((p) => p.periodIndex === input.periodIndex)) {
    throw new DataEntryError("Choose a period that is on the chart.");
  }
  const created = await db.annotation.create({
    data: { measureId, label: input.label, description: input.description, periodIndex: input.periodIndex, date: input.date },
  });
  await audit({ userId: user.id, action: "annotation.created", entity: "Annotation", entityId: created.id, metadata: { measureId } });
}
