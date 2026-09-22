import { MeasureAccessError, MeasureNotFoundError } from "./service";
import { LlmConfigurationError, LlmRefusalError, LlmRequestError, LlmTruncatedError } from "@/lib/llm";
import { phiErrorBody, type PhiErrorBody } from "@/lib/phi";

/** Shared failure shapes for the chart actions. Not a server action module. */

export type Failure = { status: "error"; message: string };
export type PhiFeedback = { status: "phi" } & PhiErrorBody;

/** PHI acknowledgement fingerprints the form carried, validated for shape. */
export function acknowledged(formData: FormData): Set<string> {
  return new Set(formData.getAll("ack").filter((v): v is string => typeof v === "string" && /^[0-9a-f]{24}$/.test(v)));
}

/** Turns anything thrown into a message the user can act on. */
export function failureFor(error: unknown, feature: string): Failure | PhiFeedback {
  const phi = phiErrorBody(error);
  if (phi) return { status: "phi", ...phi };
  if (error instanceof MeasureAccessError || error instanceof MeasureNotFoundError) return { status: "error", message: error.message };
  if (error instanceof LlmConfigurationError) {
    console.error(`[${feature}] ${error.message}`);
    return { status: "error", message: "The language model provider has not been set up yet. Please tell the committee." };
  }
  if (error instanceof LlmRefusalError) return { status: "error", message: error.message };
  if (error instanceof LlmTruncatedError) return { status: "error", message: "The response was too long to complete. Please try again." };
  if (error instanceof LlmRequestError) return { status: "error", message: "The language model service did not respond. Please try again in a moment." };
  console.error(`[${feature}] unexpected failure`, error);
  return { status: "error", message: "Something went wrong. Please try again." };
}
