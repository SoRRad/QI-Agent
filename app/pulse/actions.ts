"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, type User } from "@/lib/auth";
import { acknowledged } from "@/lib/charts/errors";
import type { EscalationTarget, PulseQuestionKind } from "@/lib/generated/prisma/client";
import { phiErrorBody } from "@/lib/phi";
import { addResponses, createBarrier, transitionBarrier, updateBarrier } from "@/lib/pulse/barriers";
import { draftDigest, publishDigest, type DigestDraft } from "@/lib/pulse/digest";
import { PulseNotFoundError, PulsePermissionError, PulseRuleError } from "@/lib/pulse/errors";
import { addReceipt, RECEIPT_COOKIE } from "@/lib/pulse/receipts";
import {
  addQuestion,
  closeSurvey,
  createSurvey,
  moveQuestion,
  openForResponses,
  removeQuestion,
  setSurveyIntro,
  submitResponse,
  updateQuestion,
} from "@/lib/pulse/survey";
import { proposeThemes, type ThemingResult } from "@/lib/pulse/theming";
import { runWithContext } from "@/lib/request-context";
import type { FormState } from "@/app/projects/actions";

/**
 * Pulse actions. Every free-text write runs inside a request context carrying
 * the user's PHI acknowledgements; the guard itself is in the database client.
 */

function explain(error: unknown): FormState {
  const phi = phiErrorBody(error);
  if (phi) return { status: "phi", ...phi };
  if (error instanceof PulseRuleError || error instanceof PulsePermissionError || error instanceof PulseNotFoundError) {
    return { status: "error", message: error.message };
  }
  console.error("[pulse] unexpected failure", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

async function asUser<T>(formData: FormData, fn: (user: User) => Promise<T>): Promise<T> {
  const user = await getCurrentUser();
  return runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () => fn(user));
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const lines = (formData: FormData, key: string) => str(formData, key).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const TARGETS: readonly string[] = ["committee", "gmec", "program"];
const target = (formData: FormData): EscalationTarget => {
  const t = str(formData, "escalationTarget");
  return (TARGETS.includes(t) ? t : "committee") as EscalationTarget;
};

function refresh() {
  revalidatePath("/pulse", "layout");
  revalidatePath("/committee");
}

// ---------------------------------------------------------------- responding

export async function submitSurveyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const surveyId = str(formData, "surveyId");
  const answers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("q_") && typeof value === "string") answers[key.slice(2)] = value;
  }
  // The barrier question's field is named for its column, so the PHI notice
  // can highlight flags in it.
  const barrierQuestionId = str(formData, "barrierQuestionId");
  if (barrierQuestionId) answers[barrierQuestionId] = String(formData.get("barrierText") ?? "");
  let receipt: string;
  try {
    receipt = await asUser(formData, (user) =>
      submitResponse(user, surveyId, { answers, identify: formData.get("identify") === "on", shareProgram: formData.get("shareProgram") === "on" }),
    );
  } catch (error) {
    return explain(error);
  }
  const jar = await cookies();
  jar.set(RECEIPT_COOKIE, addReceipt(jar.get(RECEIPT_COOKIE)?.value, receipt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/pulse",
    maxAge: 60 * 60 * 24 * 365 * 4,
  });
  refresh();
  redirect("/pulse/mine?submitted=1");
}

// ---------------------------------------------------------------- composing

export async function createSurveyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await asUser(formData, (user) => createSurvey(user, str(formData, "quarter")));
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: "Draft created from the most recent survey's questions." };
}

const KINDS: readonly string[] = ["scale", "single_choice", "free_text"];

export async function addQuestionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const kind = str(formData, "kind");
  if (!KINDS.includes(kind)) return { status: "error", message: "Choose what kind of question this is." };
  try {
    await asUser(formData, (user) =>
      addQuestion(user, str(formData, "surveyId"), {
        kind: kind as PulseQuestionKind,
        prompt: str(formData, "prompt"),
        help: str(formData, "help") || null,
        required: formData.get("required") === "on",
        options: lines(formData, "options"),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: "Question added." };
}

export async function updateQuestionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await asUser(formData, (user) =>
      updateQuestion(user, str(formData, "questionId"), {
        prompt: str(formData, "prompt"),
        help: str(formData, "help") || null,
        required: formData.get("required") === "on",
        options: lines(formData, "options"),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: "Saved." };
}

export async function questionOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const op = str(formData, "op");
  const questionId = str(formData, "questionId");
  try {
    await asUser(formData, (user) => (op === "remove" ? removeQuestion(user, questionId) : moveQuestion(user, questionId, op === "up" ? "up" : "down")));
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: op === "remove" ? "Question removed." : "Moved." };
}

export async function surveyIntroAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await asUser(formData, (user) => setSurveyIntro(user, str(formData, "surveyId"), str(formData, "intro") || null));
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: "Saved." };
}

export async function surveyStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const surveyId = str(formData, "surveyId");
  const open = str(formData, "to") === "open";
  try {
    await asUser(formData, (user) => (open ? openForResponses(user, surveyId) : closeSurvey(user, surveyId)));
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: open ? "The survey is open. Trainees see it on the Survey tab." : "The survey is closed." };
}

// ---------------------------------------------------------------- theming

export type ThemingState = { status: "idle" } | ({ status: "result" } & ThemingResult);

export async function proposeThemesAction(_prev: ThemingState, formData: FormData): Promise<ThemingState> {
  const user = await getCurrentUser();
  try {
    return { status: "result", ...(await proposeThemes(user, str(formData, "quarter"))) };
  } catch (error) {
    const failed = explain(error);
    return { status: "result", ok: false, reason: failed.status === "error" ? failed.message : "Theming failed." };
  }
}

export async function createBarrierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const responseIds = formData.getAll("responseId").map(String);
  try {
    await asUser(formData, (user) =>
      createBarrier(user, { label: str(formData, "label"), summary: str(formData, "summary"), escalationTarget: target(formData), responseIds }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: `Barrier raised from ${responseIds.length} ${responseIds.length === 1 ? "response" : "responses"}.` };
}

export async function addToBarrierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const responseIds = formData.getAll("responseId").map(String);
  try {
    await asUser(formData, (user) => addResponses(user, str(formData, "barrierId"), responseIds));
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: `Added ${responseIds.length} ${responseIds.length === 1 ? "response" : "responses"} to the barrier.` };
}

// ---------------------------------------------------------------- barriers

export async function updateBarrierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await asUser(formData, (user) =>
      updateBarrier(user, str(formData, "barrierId"), {
        label: str(formData, "label"),
        summary: str(formData, "summary"),
        escalationTarget: target(formData),
        ownerId: str(formData, "ownerId") || null,
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: "Saved." };
}

const STATUSES: readonly string[] = ["raised", "at_gmec", "decided", "closed"];

export async function transitionBarrierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const to = str(formData, "to");
  if (!STATUSES.includes(to)) return { status: "error", message: "Choose where the barrier goes next." };
  try {
    await asUser(formData, (user) =>
      transitionBarrier(user, str(formData, "barrierId"), {
        to: to as "raised" | "at_gmec" | "decided" | "closed",
        decision: str(formData, "decision") || null,
        whatChanged: str(formData, "whatChanged") || null,
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh();
  return { status: "done", message: "Status updated." };
}

// ---------------------------------------------------------------- digest

export type DigestState = { status: "idle" } | { status: "draft"; draft: DigestDraft } | { status: "error"; message: string };

export async function draftDigestAction(_prev: DigestState, formData: FormData): Promise<DigestState> {
  try {
    const draft = await asUser(formData, (user) => draftDigest(user));
    return { status: "draft", draft };
  } catch (error) {
    const failed = explain(error);
    return { status: "error", message: failed.status === "error" ? failed.message : "The draft could not be generated." };
  }
}

export async function publishDigestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const barrierIds = formData.getAll("barrierId").map(String);
  try {
    await asUser(formData, (user) =>
      publishDigest(user, {
        headline: str(formData, "headline"),
        intro: str(formData, "intro"),
        items: barrierIds.map((barrierId) => ({ barrierId, text: str(formData, `item_${barrierId}`) })),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh();
  redirect("/pulse?published=1");
}
