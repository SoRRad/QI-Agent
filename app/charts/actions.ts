"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { acknowledged, failureFor, type Failure, type PhiFeedback } from "@/lib/charts/errors";
import { interpretChart } from "@/lib/charts/service";
import { deprecateMeasure, LibraryError, promoteMeasure } from "@/lib/charts/libraryService";
import { LlmOutputError, LlmRefusalError } from "@/lib/llm";
import { runWithContext } from "@/lib/request-context";

/**
 * Studio actions. Interpretation is available to anyone who can see the data;
 * promotion and deprecation change the shared library and are chair-only.
 */

// ---------------------------------------------------------------- interpret

export type InterpretState =
  | { status: "idle" }
  | { status: "done"; text: string }
  | { status: "unavailable"; message: string }
  | Failure;

export async function interpretAction(_previous: InterpretState, formData: FormData): Promise<InterpretState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  // Raw view state; the service parses it against the measure as stored.
  const search = {
    view: String(formData.get("view") ?? ""),
    baseline: String(formData.get("baseline") ?? ""),
    we: String(formData.get("we") ?? ""),
  };

  try {
    const text = await runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, () =>
      interpretChart(user, measureId, search),
    );
    return { status: "done", text };
  } catch (error) {
    // A reply that failed the numeric guard twice, or a provider refusal, is
    // "unavailable": the chart and its findings stand on their own.
    if (error instanceof LlmRefusalError || error instanceof LlmOutputError) {
      return { status: "unavailable", message: "An interpretation is not available for this chart right now. The findings above are complete without it." };
    }
    const failure = failureFor(error, "charts.interpretation");
    return failure.status === "phi" ? { status: "error", message: "The interpretation could not be produced." } : failure;
  }
}

// ---------------------------------------------------------------- library

export type LibraryState = { status: "idle" } | { status: "done"; message: string } | Failure | PhiFeedback;

function libraryFailure(error: unknown, feature: string): Failure | PhiFeedback {
  if (error instanceof LibraryError) return { status: "error", message: error.message };
  return failureFor(error, feature);
}

export async function promoteMeasureAction(_previous: LibraryState, formData: FormData): Promise<LibraryState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  try {
    const { name } = await runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () =>
      promoteMeasure(user, measureId),
    );
    revalidatePath("/charts");
    revalidatePath(`/charts/measures/${measureId}`);
    return { status: "done", message: `Added to the library as “${name}”. This project's chart now links to it.` };
  } catch (error) {
    return libraryFailure(error, "measure.promote");
  }
}

export async function deprecateMeasureAction(_previous: LibraryState, formData: FormData): Promise<LibraryState> {
  const user = await getCurrentUser();
  const measureId = String(formData.get("measureId") ?? "");
  try {
    await runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () =>
      deprecateMeasure(user, {
        measureId,
        note: String(formData.get("note") ?? ""),
        supersededById: (formData.get("supersededById") as string | null) || null,
      }),
    );
    revalidatePath("/charts");
    revalidatePath(`/charts/measures/${measureId}`);
    return { status: "done", message: "Superseded. Charts built on this definition now carry a banner." };
  } catch (error) {
    return libraryFailure(error, "measure.deprecate");
  }
}
