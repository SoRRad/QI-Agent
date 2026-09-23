"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import type { DataRequestDocument } from "@/lib/charts/dataRequest";
import { definitionSchema } from "@/lib/charts/definition";
import {
  confirmRestatement,
  DefinitionError,
  draftDataRequest,
  restateDefinition,
  saveDefinition,
} from "@/lib/charts/definitionService";
import { acknowledged, failureFor, type Failure, type PhiFeedback } from "@/lib/charts/errors";
import { LlmOutputError, LlmRefusalError } from "@/lib/llm";
import { runWithContext } from "@/lib/request-context";
import { recordUsage } from "@/lib/usage";

/**
 * Operational definition builder, reproducibility check and data request.
 * Everything that writes goes through the PHI guard inside the database
 * client; the model-written restatement must pass that scan with no flags.
 */

function explain(error: unknown, feature: string): Failure | PhiFeedback {
  if (error instanceof DefinitionError) return { status: "error", message: error.message };
  return failureFor(error, feature);
}

const unavailable = (error: unknown) => error instanceof LlmOutputError || error instanceof LlmRefusalError;

// ---------------------------------------------------------------- save

export type DefinitionState =
  | { status: "idle" }
  | { status: "saved"; version: number }
  | { status: "invalid"; fieldErrors: Record<string, string> }
  | Failure
  | PhiFeedback;

export async function saveDefinitionAction(_previous: DefinitionState, formData: FormData): Promise<DefinitionState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  const parsed = definitionSchema.safeParse({
    numerator: formData.get("numerator") ?? "",
    denominator: formData.get("denominator") ?? "",
    inclusions: formData.get("inclusions") ?? "",
    exclusions: formData.get("exclusions") ?? "",
    dataSource: formData.get("dataSource") ?? "",
    puller: formData.get("puller") ?? "",
    cadence: formData.get("cadence") ?? "",
  });
  if (!parsed.success) {
    // Refused: the builder does not save an incomplete definition, whatever
    // the browser sent.
    return {
      status: "invalid",
      fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
    };
  }

  try {
    const { version } = await runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () =>
      saveDefinition(user, measureId, parsed.data),
    );
    revalidatePath(`/charts/measures/${measureId}`);
    revalidatePath(`/charts/measures/${measureId}/definition`);
    return { status: "saved", version };
  } catch (error) {
    return explain(error, "measure.definition");
  }
}

// ---------------------------------------------------------------- reproducibility

export type RestateState =
  | { status: "idle" }
  | { status: "ready"; definitionId: string; version: number; query: string; ambiguities: string[]; digest: string }
  | { status: "confirmed"; version: number; query: string; confirmedAt: string }
  | { status: "unavailable" }
  | Failure;

export async function restateAction(_previous: RestateState, formData: FormData): Promise<RestateState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  try {
    const r = await runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, () => restateDefinition(user, measureId));
    if (r.confirmedAt) return { status: "confirmed", version: r.version, query: r.query, confirmedAt: r.confirmedAt.toISOString() };
    return { status: "ready", definitionId: r.definitionId, version: r.version, query: r.query, ambiguities: r.ambiguities, digest: r.digest };
  } catch (error) {
    if (unavailable(error)) return { status: "unavailable" };
    const failure = explain(error, "charts.definition_restatement");
    return failure.status === "phi" ? { status: "unavailable" } : failure;
  }
}

export async function confirmRestatementAction(_previous: RestateState, formData: FormData): Promise<RestateState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  const definitionId = String(formData.get("definitionId") ?? "");
  const digest = String(formData.get("digest") ?? "");
  try {
    // The confirmed text is read back from the database: what is stored as
    // evidence is what the server generated, never what the browser sent.
    const confirmed = await runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, () =>
      confirmRestatement(user, measureId, definitionId, digest),
    );
    revalidatePath(`/charts/measures/${measureId}`);
    return { status: "confirmed", version: confirmed.version, query: confirmed.query, confirmedAt: confirmed.confirmedAt.toISOString() };
  } catch (error) {
    const failure = explain(error, "measure.definition_confirm");
    return failure.status === "phi" ? { status: "error", message: "Could not record the confirmation." } : failure;
  }
}

// ---------------------------------------------------------------- data request

export type DataRequestState =
  | { status: "idle" }
  | { status: "done"; document: DataRequestDocument; markdown: string }
  | { status: "unavailable" }
  | Failure;

const month = z.string().regex(/^\d{4}-\d{2}$/, "Choose a month.");

export async function dataRequestAction(_previous: DataRequestState, formData: FormData): Promise<DataRequestState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  const range = z.object({ from: month, to: month }).safeParse({ from: formData.get("from"), to: formData.get("to") });
  if (!range.success) return { status: "error", message: range.error.issues[0]?.message ?? "Choose a date range." };

  try {
    const result = await runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, () =>
      draftDataRequest(user, measureId, range.data),
    );
    await recordUsage("export_generated", { id: user.id, role: user.role, programId: user.programId }, {
      entityId: measureId,
      metadata: { kind: "data_request" },
    });
    return { status: "done", ...result };
  } catch (error) {
    if (unavailable(error)) return { status: "unavailable" };
    const failure = explain(error, "charts.data_request");
    return failure.status === "phi" ? { status: "unavailable" } : failure;
  }
}
