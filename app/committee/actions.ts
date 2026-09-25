"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, type User } from "@/lib/auth";
import { acknowledged } from "@/lib/charts/errors";
import { LlmError } from "@/lib/llm";
import { phiErrorBody } from "@/lib/phi";
import { runWithContext } from "@/lib/request-context";
import { RUBRIC } from "@/lib/committee/rubric";
import { CommitteeAccessError, CommitteeNotFoundError, CommitteeRuleError } from "@/lib/committee/services/access";
import { createClerMock, recordClerResponse } from "@/lib/committee/services/cler";
import { assignCoach } from "@/lib/committee/services/coaches";
import { importCurriculum } from "@/lib/committee/services/curriculum";
import { assignJudge, createEvent, generateKit, saveAfterAction, submitScore, unassignJudge } from "@/lib/committee/services/events";
import { draftMilestones, recordPdReview } from "@/lib/committee/services/milestones";
import type { FormState } from "@/app/projects/actions";

/** Committee actions. Each service checks the role; these only translate outcomes for the form. */

function explain(error: unknown): FormState {
  const phi = phiErrorBody(error);
  if (phi) return { status: "phi", ...phi };
  if (error instanceof CommitteeRuleError || error instanceof CommitteeAccessError || error instanceof CommitteeNotFoundError) {
    return { status: "error", message: error.message };
  }
  if (error instanceof LlmError) {
    return { status: "error", message: `The draft could not be written: ${error.message} Nothing was saved; try again.` };
  }
  console.error("[committee] unexpected failure", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

async function asUser<T>(formData: FormData, fn: (user: User) => Promise<T>): Promise<T> {
  const user = await getCurrentUser();
  return runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () => fn(user));
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

// ------------------------------------------------------------------- events

export async function createEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    id = await asUser(formData, (user) =>
      createEvent(user, { title: str(formData, "title"), type: str(formData, "type"), date: str(formData, "date"), agenda: str(formData, "agenda") || null }),
    );
  } catch (error) {
    return explain(error);
  }
  revalidatePath("/committee/events");
  redirect(`/committee/events/${id}`);
}

export async function generateKitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = str(formData, "eventId");
  try {
    await asUser(formData, (user) => generateKit(user, eventId));
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/committee/events/${eventId}`);
  return { status: "done", message: "Kit generated from the current record." };
}

export async function saveAfterActionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = str(formData, "eventId");
  try {
    await asUser(formData, (user) => saveAfterAction(user, eventId, String(formData.get("afterActionNote") ?? "")));
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/committee/events/${eventId}`);
  return { status: "done", message: "After-action note saved." };
}

// ------------------------------------------------------------------ judging

export async function assignJudgeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = str(formData, "eventId");
  try {
    await asUser(formData, (user) => assignJudge(user, str(formData, "submissionId"), str(formData, "judgeId")));
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/committee/events/${eventId}/judging`);
  return { status: "done", message: "Judge assigned." };
}

export async function unassignJudgeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = str(formData, "eventId");
  try {
    await asUser(formData, (user) => unassignJudge(user, str(formData, "submissionId"), str(formData, "judgeId")));
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/committee/events/${eventId}/judging`);
  return { status: "done", message: "Judge removed." };
}

export async function scoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(RUBRIC.map((c) => [c.id, str(formData, c.id) || undefined]));
  try {
    const total = await asUser(formData, (user) => submitScore(user, str(formData, "submissionId"), raw));
    revalidatePath("/committee/judging");
    return { status: "done", message: `Scores saved. Your weighted total: ${total}.` };
  } catch (error) {
    return explain(error);
  }
}

// --------------------------------------------------------------- curriculum

export async function importCurriculumAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("file");
  const text = file instanceof File && file.size > 0 ? await file.text() : str(formData, "csv");
  if (!text) return { status: "error", message: "Choose a CSV file, or paste its contents." };
  if (text.length > 1_000_000) return { status: "error", message: "That file is too large to import in one go." };
  try {
    const s = await asUser(formData, (user) => importCurriculum(user, text));
    revalidatePath("/committee/curriculum");
    return { status: "done", message: `Imported ${s.rows} rows: ${s.created} new, ${s.completed} newly completed, ${s.unchanged} unchanged.` };
  } catch (error) {
    return explain(error);
  }
}

// --------------------------------------------------------------- milestones

export async function draftMilestonesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    const n = await asUser(formData, (user) => draftMilestones(user, projectId, str(formData, "traineeId")));
    revalidatePath(`/committee/milestones/${projectId}`);
    return { status: "done", message: `Drafted ${n} ${n === 1 ? "entry" : "entries"}. Each is a draft until a program director's review is recorded.` };
  } catch (error) {
    return explain(error);
  }
}

export async function recordPdReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    await asUser(formData, (user) => recordPdReview(user, str(formData, "mapId")));
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/committee/milestones/${projectId}`);
  return { status: "done", message: "Program director review recorded." };
}

// --------------------------------------------------------------------- CLER

export async function createClerMockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    id = await asUser(formData, (user) => createClerMock(user, { title: str(formData, "title"), date: str(formData, "date"), setting: str(formData, "setting") }));
  } catch (error) {
    return explain(error);
  }
  revalidatePath("/committee/cler");
  redirect(`/committee/cler/${id}`);
}

export async function recordClerResponseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = str(formData, "eventId");
  try {
    await asUser(formData, (user) =>
      recordClerResponse(user, str(formData, "questionId"), {
        respondent: str(formData, "respondent"),
        response: String(formData.get("response") ?? ""),
        rating: str(formData, "rating"),
        notes: String(formData.get("notes") ?? ""),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/committee/cler/${eventId}`);
  return { status: "done", message: "Response recorded." };
}

// ------------------------------------------------------------------ coaches

export async function assignCoachAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await asUser(formData, (user) => assignCoach(user, str(formData, "projectId"), str(formData, "coachId")));
  } catch (error) {
    return explain(error);
  }
  revalidatePath("/committee/coaches");
  return { status: "done", message: "Coach assigned." };
}
