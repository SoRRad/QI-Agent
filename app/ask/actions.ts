"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { askQuestion, runDevilsAdvocate, tutorTurn, type AskResult } from "@/lib/ask/service";
import { LlmConfigurationError, LlmRefusalError, LlmRequestError, LlmTruncatedError } from "@/lib/llm";
import type { DevilsAdvocateOutput, TutorTurn } from "@/lib/llm/prompts";
import { phiErrorBody, type PhiErrorBody } from "@/lib/phi";
import { ProjectAccessError } from "@/lib/projects/access";
import { runWithContext } from "@/lib/request-context";

/**
 * Server actions for the Ask destination.
 *
 * Each one runs its work inside a request context carrying the user and the
 * PHI acknowledgements the form submitted, because the PHI guard — in the
 * outbound path and inside the database client — reads them from there.
 */

export type PhiFeedback = { status: "phi" } & PhiErrorBody;
export type Failure = { status: "error"; message: string };

function acknowledged(formData: FormData): string[] {
  return formData.getAll("ack").filter((v): v is string => typeof v === "string" && /^[0-9a-f]{24}$/.test(v));
}

/**
 * Turns anything thrown into a message a trainee can act on. Configuration
 * detail is deliberately not shown: a trainee cannot fix an environment
 * variable, and naming one is information they do not need.
 */
function failure(error: unknown): PhiFeedback | Failure {
  const phi = phiErrorBody(error);
  if (phi) return { status: "phi", ...phi };
  if (error instanceof LlmConfigurationError) {
    console.error(`[ask] ${error.message}`);
    return { status: "error", message: "Ask is not configured yet: the language model provider has not been set up. Please tell the committee." };
  }
  if (error instanceof LlmRefusalError) return { status: "error", message: error.message };
  if (error instanceof LlmTruncatedError) return { status: "error", message: "The answer was too long to complete. Try a narrower question." };
  if (error instanceof LlmRequestError) {
    return { status: "error", message: "The language model service did not respond. Please try again in a moment." };
  }
  if (error instanceof ProjectAccessError) return { status: "error", message: error.message };
  console.error("[ask] unexpected failure", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

// ---------------------------------------------------------------- ask

export type AskState =
  | { status: "idle" }
  | ({ status: "done" } & AskResult)
  | PhiFeedback
  | Failure;

const question = z
  .string()
  .trim()
  .min(3, "Please write a question.")
  .max(1000, "Please keep the question under 1,000 characters.");

export async function askAction(_previous: AskState, formData: FormData): Promise<AskState> {
  const user = await getCurrentUser();
  const parsed = question.safeParse(formData.get("question"));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid question." };

  try {
    const result = await runWithContext({ userId: user.id, acknowledgedPhi: new Set(acknowledged(formData)) }, () =>
      askQuestion(user, parsed.data),
    );
    return { status: "done", ...result };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------- tutor

export type TutorState =
  | { status: "idle"; history: TutorTurn[] }
  | { status: "done"; history: TutorTurn[] }
  | (PhiFeedback & { history: TutorTurn[] })
  | (Failure & { history: TutorTurn[] });

const turnsSchema = z
  .array(z.object({ role: z.enum(["tutor", "trainee"]), text: z.string().max(2000) }))
  .max(40);

export async function tutorAction(previous: TutorState, formData: FormData): Promise<TutorState> {
  const user = await getCurrentUser();
  const projectId = (formData.get("projectId") as string | null) || null;

  let history: TutorTurn[];
  try {
    history = turnsSchema.parse(JSON.parse(String(formData.get("history") ?? "[]")));
  } catch {
    return { status: "error", message: "The conversation could not be read. Start again.", history: [] };
  }

  const reply = String(formData.get("reply") ?? "").trim();
  if (history.length > 0 && !reply) {
    return { status: "error", message: "Write a reply first.", history };
  }
  if (reply.length > 2000) return { status: "error", message: "Please keep replies under 2,000 characters.", history };
  const withReply: TutorTurn[] = reply ? [...history, { role: "trainee", text: reply }] : history;

  try {
    const { question: next } = await runWithContext(
      { userId: user.id, acknowledgedPhi: new Set(acknowledged(formData)) },
      () => tutorTurn(user, { projectId, history: withReply }),
    );
    return { status: "done", history: [...withReply, { role: "tutor", text: next }] };
  } catch (error) {
    // Keep the conversation as it was, so the trainee can edit their reply.
    return { ...failure(error), history: previous.history.length > 0 ? previous.history : history };
  }
}

// ---------------------------------------------------------------- devil's advocate

export type DevilState =
  | { status: "idle" }
  | ({ status: "done"; projectTitle: string } & DevilsAdvocateOutput)
  | Failure;

export async function devilsAdvocateAction(_previous: DevilState, formData: FormData): Promise<DevilState> {
  const user = await getCurrentUser();
  const projectId = String(formData.get("projectId") ?? "");
  const projectTitle = String(formData.get("projectTitle") ?? "");
  if (!projectId) return { status: "error", message: "Choose a project first." };

  try {
    const output = await runWithContext({ userId: user.id, acknowledgedPhi: new Set() }, () =>
      runDevilsAdvocate(user, projectId),
    );
    return { status: "done", projectTitle, ...output };
  } catch (error) {
    const f = failure(error);
    return f.status === "phi" ? { status: "error", message: f.message } : f;
  }
}
