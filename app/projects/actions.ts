"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, type User } from "@/lib/auth";
import { acknowledged } from "@/lib/charts/errors";
import { phiErrorBody } from "@/lib/phi";
import type { PhiErrorBody } from "@/lib/phi";
import { addDriverNode, moveDriverNode, removeDriverNode, renameDriverNode } from "@/lib/projects/driverService";
import { acceptHandoff, createHandoff } from "@/lib/projects/handoff";
import type { IntakeIssue } from "@/lib/projects/intake";
import { completeCycle, createCycle, updateCycle } from "@/lib/projects/pdsa";
import {
  addMeasure,
  approveProject,
  archiveProject,
  completeProject,
  createDraft,
  IntakeBlockedError,
  ProjectNotFoundError,
  ProjectPermissionError,
  ProjectRuleError,
  removeMeasure,
  returnToDraft,
  saveAim,
  submitProject,
  updateContext,
  updatePeople,
  updateProblem,
} from "@/lib/projects/service";
import { runWithContext } from "@/lib/request-context";

/**
 * Project actions. Every one runs inside a request context carrying the
 * user's PHI acknowledgements, because every free-text write passes through
 * the PHI guard inside the database client.
 */

export type FormState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "blocked"; blockers: IntakeIssue[] }
  | ({ status: "phi" } & PhiErrorBody);

function explain(error: unknown): FormState {
  const phi = phiErrorBody(error);
  if (phi) return { status: "phi", ...phi };
  if (error instanceof IntakeBlockedError) return { status: "blocked", blockers: error.review.blockers };
  if (error instanceof ProjectRuleError || error instanceof ProjectPermissionError || error instanceof ProjectNotFoundError) {
    return { status: "error", message: error.message };
  }
  console.error("[projects] unexpected failure", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

function invalid(error: z.ZodError): FormState {
  return {
    status: "error",
    message: error.issues[0]?.message ?? "Check the form.",
    fieldErrors: Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message])),
  };
}

/** Runs `fn` as the current user with the form's PHI acknowledgements. */
async function asUser<T>(formData: FormData, fn: (user: User) => Promise<T>): Promise<T> {
  const user = await getCurrentUser();
  return runWithContext({ userId: user.id, acknowledgedPhi: acknowledged(formData) }, () => fn(user));
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const optional = (formData: FormData, key: string) => str(formData, key) || null;
const number = (formData: FormData, key: string) => {
  const raw = str(formData, key).replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
};

function refresh(projectId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---------------------------------------------------------------- intake

const problemSchema = z.object({
  title: z.string().min(6, "Give the project a short, specific title.").max(160),
  problemStatement: z
    .string()
    .min(40, "Describe the problem in a sentence or two: what goes wrong, for whom, and how you know.")
    .max(3000),
});

export async function createProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = problemSchema.safeParse({ title: str(formData, "title"), problemStatement: str(formData, "problemStatement") });
  if (!parsed.success) return invalid(parsed.error);
  let id: string;
  try {
    id = await asUser(formData, (user) => createDraft(user, parsed.data));
  } catch (error) {
    return explain(error);
  }
  revalidatePath("/projects");
  redirect(`/projects/${id}/intake?step=problem&saved=1`);
}

export async function saveProblemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const parsed = problemSchema.safeParse({ title: str(formData, "title"), problemStatement: str(formData, "problemStatement") });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await asUser(formData, (user) => updateProblem(user, projectId, parsed.data));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Saved. Similar projects below were found from what you wrote." };
}

const aimSchema = z.object({
  text: z.string().min(20, "Write the aim as one sentence.").max(1000),
  baselineValue: z.number().nullable(),
  baselineUnit: z.string().max(40).nullable(),
  baselinePeriod: z.string().max(120).nullable(),
  target: z.number().nullable(),
  targetUnit: z.string().max(40).nullable(),
  deadline: z.date().nullable(),
  population: z.string().max(300).nullable(),
});

export async function saveAimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const baselineValue = number(formData, "baselineValue");
  const target = number(formData, "target");
  if (Number.isNaN(baselineValue) || Number.isNaN(target)) {
    return { status: "error", message: "Baseline and target are numbers, such as 34 or 1.4." };
  }
  const deadlineRaw = str(formData, "deadline");
  const deadline = deadlineRaw ? new Date(`${deadlineRaw}T00:00:00Z`) : null;
  if (deadline && Number.isNaN(deadline.getTime())) return { status: "error", message: "Give the deadline as a date." };
  const parsed = aimSchema.safeParse({
    text: str(formData, "text"),
    baselineValue,
    baselineUnit: optional(formData, "baselineUnit"),
    baselinePeriod: optional(formData, "baselinePeriod"),
    target,
    targetUnit: optional(formData, "targetUnit"),
    deadline,
    population: optional(formData, "population"),
  });
  if (!parsed.success) return invalid(parsed.error);
  let version: number;
  try {
    version = await asUser(formData, (user) => saveAim(user, projectId, parsed.data));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: `Saved as version ${version}. Earlier versions stay on record.` };
}

const measureSchema = z.object({
  name: z.string().max(160),
  type: z.enum(["outcome", "process", "balancing"], { error: "Choose outcome, process or balancing." }),
  chartType: z.enum(["run", "xmr", "p", "u", "c"], { error: "Choose a chart type — the advisor can help." }),
  libraryMeasureId: z.string().nullable(),
});

export async function addMeasureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const parsed = measureSchema.safeParse({
    name: str(formData, "name"),
    type: str(formData, "type"),
    chartType: str(formData, "chartType") || "run",
    libraryMeasureId: optional(formData, "libraryMeasureId"),
  });
  if (!parsed.success) return invalid(parsed.error);
  if (!parsed.data.libraryMeasureId && parsed.data.name.length < 6) {
    return { status: "error", message: "Name the measure, or choose one from the library.", fieldErrors: { name: "Name the measure." } };
  }
  try {
    await asUser(formData, (user) => addMeasure(user, projectId, parsed.data));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Measure added. Write its operational definition from its chart page before you request data." };
}

export async function removeMeasureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    await asUser(formData, (user) => removeMeasure(user, projectId, str(formData, "measureId")));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Removed." };
}

export async function savePeopleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    await asUser(formData, (user) =>
      updatePeople(user, projectId, {
        clinicalOwner: optional(formData, "clinicalOwner"),
        coachId: optional(formData, "coachId"),
        sponsor: optional(formData, "sponsor"),
        analystContact: optional(formData, "analystContact"),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Saved." };
}

const CLER = ["patient_safety", "health_care_quality", "care_transitions", "supervision", "well_being", "professionalism"] as const;

export async function saveContextAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const cler = str(formData, "clerDomain");
  if (cler && !(CLER as readonly string[]).includes(cler)) return { status: "error", message: "Choose a CLER focus area from the list." };
  try {
    await asUser(formData, (user) =>
      updateContext(user, projectId, {
        clerDomain: (cler || null) as (typeof CLER)[number] | null,
        equityStratificationPlan: optional(formData, "equityStratificationPlan"),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Saved." };
}

export async function submitProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    await asUser(formData, (user) => submitProject(user, projectId));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  redirect(`/projects/${projectId}?submitted=1`);
}

// ---------------------------------------------------------------- lifecycle

export async function approveProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    await asUser(formData, (user) => (str(formData, "decision") === "return" ? returnToDraft(user, projectId) : approveProject(user, projectId)));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: str(formData, "decision") === "return" ? "Returned to draft for changes." : "Approved. The project is active." };
}

const completionSchema = z.object({
  outcomeSummary: z.string().min(30, "Say what changed, with the numbers from your chart, in a sentence or two.").max(2000),
  changeOwner: z.string().min(3, "Name who owns the change now.").max(300),
  continuingMeasureId: z.string().nullable(),
  cadence: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "annual"], { error: "Choose how often the measure continues." }),
  reviewer: z.string().min(3, "Name who reviews it.").max(300),
  notes: z.string().max(2000).nullable(),
});

export async function completeProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const parsed = completionSchema.safeParse({
    outcomeSummary: str(formData, "outcomeSummary"),
    changeOwner: str(formData, "changeOwner"),
    continuingMeasureId: optional(formData, "continuingMeasureId"),
    cadence: str(formData, "cadence"),
    reviewer: str(formData, "reviewer"),
    notes: optional(formData, "notes"),
  });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await asUser(formData, (user) => completeProject(user, projectId, parsed.data));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Complete, with its sustainability plan on record." };
}

export async function archiveProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const endReason = str(formData, "endReason");
  if (endReason.length < 20) {
    return { status: "error", message: "Say why the project ended. It is the first thing the next cohort reads.", fieldErrors: { endReason: "Required." } };
  }
  try {
    await asUser(formData, (user) => archiveProject(user, projectId, { endReason, outcomeSummary: optional(formData, "outcomeSummary") }));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Archived. It stays in the registry and in duplicate detection." };
}

// ---------------------------------------------------------------- PDSA

const date = (formData: FormData, key: string) => {
  const raw = str(formData, key);
  return raw ? new Date(`${raw}T00:00:00Z`) : null;
};

export async function createCycleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const plan = str(formData, "plan");
  if (plan.length < 20) return { status: "error", message: "Describe the change you will test, on whom, and for how long.", fieldErrors: { plan: "Required." } };
  let number: number;
  try {
    number = await asUser(formData, (user) =>
      createCycle(user, projectId, {
        plan,
        prediction: optional(formData, "prediction"),
        plannedStart: date(formData, "plannedStart"),
        plannedEnd: date(formData, "plannedEnd"),
      }),
    );
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: `Cycle ${number} planned.` };
}

const ACT = ["adopt", "adapt", "abandon"] as const;

export async function updateCycleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const cycleId = str(formData, "cycleId");
  const act = str(formData, "actDecision");
  if (act && !(ACT as readonly string[]).includes(act)) return { status: "error", message: "Choose adopt, adapt or abandon." };
  const complete = str(formData, "intent") === "complete";
  try {
    await asUser(formData, async (user) => {
      await updateCycle(user, cycleId, {
        plan: str(formData, "plan"),
        prediction: optional(formData, "prediction"),
        doAction: optional(formData, "doAction"),
        studyResult: optional(formData, "studyResult"),
        actDecision: (act || null) as (typeof ACT)[number] | null,
      });
      if (complete) await completeCycle(user, cycleId);
    });
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: complete ? "Cycle complete." : "Saved." };
}

// ---------------------------------------------------------------- drivers

export async function driverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const op = str(formData, "op");
  const id = str(formData, "nodeId");
  const text = str(formData, "text");
  try {
    await asUser(formData, async (user) => {
      if (op === "add") {
        if (text.length < 3) throw new ProjectRuleError("Write the driver or change idea first.");
        const kind = str(formData, "kind");
        if (kind !== "primary" && kind !== "secondary" && kind !== "change") throw new ProjectRuleError("Unknown kind of node.");
        await addDriverNode(user, projectId, { kind, parentId: optional(formData, "parentId"), text });
      } else if (op === "rename") {
        if (text.length < 3) throw new ProjectRuleError("The text cannot be empty.");
        await renameDriverNode(user, projectId, id, text);
      } else if (op === "remove") {
        await removeDriverNode(user, projectId, id);
      } else if (op === "up" || op === "down") {
        await moveDriverNode(user, projectId, id, op);
      } else {
        throw new ProjectRuleError("Unknown change.");
      }
    });
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: op === "remove" ? "Removed, with everything under it." : "Saved." };
}

// ---------------------------------------------------------------- handoff

export async function createHandoffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  const nextActions = [str(formData, "next1"), str(formData, "next2"), str(formData, "next3")];
  const openItems = str(formData, "openItems");
  const dataAccessNotes = str(formData, "dataAccessNotes");
  const toUserId = str(formData, "toUserId");
  const fieldErrors: Record<string, string> = {};
  if (!toUserId) fieldErrors["toUserId"] = "Choose who is taking over.";
  if (openItems.length < 10) fieldErrors["openItems"] = "List what is unfinished.";
  if (dataAccessNotes.length < 10) fieldErrors["dataAccessNotes"] = "Say how the data is obtained and who to ask.";
  nextActions.forEach((a, i) => {
    if (a.length < 5) fieldErrors[`next${i + 1}`] = "Three concrete next actions.";
  });
  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "The packet needs every section, including exactly three next actions.", fieldErrors };
  }
  let delivered: boolean;
  try {
    ({ delivered } = await asUser(formData, (user) =>
      createHandoff(user, projectId, { toUserId, openItems, dataAccessNotes, nextActions: nextActions as [string, string, string] }, { baseUrl: process.env["APP_URL"] ?? "" }),
    ));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return {
    status: "done",
    message: delivered
      ? "Packet sent. The project moves to the new owner when they accept it here."
      : "Packet recorded. Mail is in log mode, so nothing was emailed; the new owner accepts it on this page.",
  };
}

export async function acceptHandoffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = str(formData, "projectId");
  try {
    await asUser(formData, (user) => acceptHandoff(user, str(formData, "handoffId")));
  } catch (error) {
    return explain(error);
  }
  refresh(projectId);
  return { status: "done", message: "Accepted. The project is yours now." };
}
