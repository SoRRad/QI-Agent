"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, type User } from "@/lib/auth";
import { acknowledged } from "@/lib/charts/errors";
import { phiErrorBody } from "@/lib/phi";
import { ProjectNotFoundError, ProjectPermissionError, ProjectRuleError } from "@/lib/projects/service";
import { QUESTIONS } from "@/lib/scholarship/irb";
import { runPrecheck, saveAbstract } from "@/lib/scholarship/service";
import { runWithContext } from "@/lib/request-context";
import type { FormState } from "@/app/projects/actions";

/** Scholarship actions: saving an abstract draft, and running the IRB / QI screening. */

function explain(error: unknown): FormState {
  const phi = phiErrorBody(error);
  if (phi) return { status: "phi", ...phi };
  if (error instanceof ProjectRuleError || error instanceof ProjectPermissionError || error instanceof ProjectNotFoundError) {
    return { status: "error", message: error.message };
  }
  console.error("[scholarship] unexpected failure", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

async function asUser<T>(formData: FormData, fn: (user: User) => Promise<T>): Promise<T> {
  const user = await getCurrentUser();
  return runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () => fn(user));
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function saveAbstractAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const venueId = str(formData, "venueId");
  const headings = formData.getAll("heading").map(String);
  const sections = headings.map((heading, i) => ({ heading, text: String(formData.get(`section_${i}`) ?? "") }));
  try {
    const count = await asUser(formData, (user) => saveAbstract(user, projectId, venueId, { title: str(formData, "title") || null, sections }));
    revalidatePath(`/projects/${projectId}/scholarship`, "layout");
    return {
      status: "done",
      message: count.over > 0 ? `Saved. ${count.total} words — ${count.over} over the ${count.limit}-word limit.` : `Saved. ${count.total} of ${count.limit} words.`,
    };
  } catch (error) {
    return explain(error);
  }
}

export async function runPrecheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const raw = Object.fromEntries(QUESTIONS.map((q) => [q.id, str(formData, q.id) || undefined]));
  try {
    await asUser(formData, (user) => runPrecheck(user, projectId, raw));
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/projects/${projectId}/scholarship`, "layout");
  redirect(`/projects/${projectId}/scholarship/irb?screened=1#memo`);
}
