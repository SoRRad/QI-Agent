"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { addAnnotation, addPoints, DataEntryError, MAX_POINTS_PER_UPLOAD, removeLatestPoint } from "@/lib/charts/dataService";
import { acknowledged, failureFor, type Failure, type PhiFeedback } from "@/lib/charts/errors";
import type { ImportRow } from "@/lib/charts/importRows";
import { runWithContext } from "@/lib/request-context";

/**
 * Data entry. Uploads send only the mapped cells — never the file — and the
 * server recomputes and revalidates every row from them.
 */

function explain(error: unknown): Failure | PhiFeedback {
  if (error instanceof DataEntryError) return { status: "error", message: error.message };
  return failureFor(error, "charts.data");
}

function refresh(measureId: string) {
  revalidatePath(`/charts/measures/${measureId}`);
  revalidatePath(`/charts/measures/${measureId}/data`);
  revalidatePath("/charts");
}

export type PointsState =
  | { status: "idle" }
  | { status: "done"; added: number; first: string; last: string }
  | { status: "rejected"; rows: ImportRow[] }
  | Failure
  | PhiFeedback;

const cell = z.string().max(100).optional();
const cellsSchema = z
  .array(z.object({ period: z.string().max(200), numerator: cell, denominator: cell, value: cell }))
  .min(1, "There are no rows to add.")
  .max(MAX_POINTS_PER_UPLOAD, `Add at most ${MAX_POINTS_PER_UPLOAD} points at a time.`);

export async function addPointsAction(_previous: PointsState, formData: FormData): Promise<PointsState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("cells") ?? "[]"));
  } catch {
    return { status: "error", message: "The rows could not be read. Choose the file again." };
  }
  const parsed = cellsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "The rows could not be read." };

  try {
    const result = await runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () =>
      addPoints(user, measureId, parsed.data),
    );
    if (!result.ok) return { status: "rejected", rows: result.rows };
    refresh(measureId);
    return { status: "done", added: result.added, first: result.first, last: result.last };
  } catch (error) {
    return explain(error);
  }
}

export type SimpleState = { status: "idle" } | { status: "done"; message: string } | Failure | PhiFeedback;

export async function removeLatestPointAction(_previous: SimpleState, formData: FormData): Promise<SimpleState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  try {
    const label = await runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, () => removeLatestPoint(user, measureId));
    refresh(measureId);
    return { status: "done", message: `Removed ${label}.` };
  } catch (error) {
    return explain(error);
  }
}

const annotationSchema = z.object({
  label: z.string().trim().min(3, "Name the change in a few words.").max(120, "Keep the name under 120 characters."),
  description: z.string().trim().max(1000, "Keep the description under 1,000 characters."),
  periodIndex: z.coerce.number().int().positive().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date the change was made."),
});

export async function addAnnotationAction(_previous: SimpleState, formData: FormData): Promise<SimpleState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  const parsed = annotationSchema.safeParse({
    label: formData.get("label") ?? "",
    description: formData.get("description") ?? "",
    periodIndex: formData.get("periodIndex") ? formData.get("periodIndex") : null,
    date: formData.get("date") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const date = new Date(`${parsed.data.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { status: "error", message: "Give the date the change was made." };

  try {
    await runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () =>
      addAnnotation(user, measureId, {
        label: parsed.data.label,
        description: parsed.data.description || null,
        periodIndex: parsed.data.periodIndex,
        date,
      }),
    );
    refresh(measureId);
    return { status: "done", message: `Marked “${parsed.data.label}” on the chart.` };
  } catch (error) {
    return explain(error);
  }
}
