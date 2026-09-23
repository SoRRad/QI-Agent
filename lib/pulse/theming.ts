import { db } from "@/lib/db";
import type { EscalationTarget, User } from "@/lib/generated/prisma/client";
import { LlmError, type LlmDependencies } from "@/lib/llm";
import { runPrompt } from "@/lib/llm/run";
import { pulseThemePrompt } from "@/lib/llm/prompts";
import { PulsePermissionError } from "./errors";

/**
 * Theming (§6.4): proposes 3–6 themes for the responses not yet in a barrier.
 *
 * Proposals are not stored. The chair reads them beside the responses, edits
 * the wording, and saves each one as a barrier — at which point the
 * paraphrase check runs again on whatever the chair saved. Counts come from
 * the response keys, never from the model.
 */

export const MIN_TO_THEME = 2;

export async function unthemedResponses(quarter: string) {
  return db.pulseResponse.findMany({
    where: { quarter, barrierText: { not: null }, barriers: { none: {} } },
    orderBy: { submittedOn: "asc" },
    select: { id: true, barrierText: true, clerDomain: true, confidence: true, respondentName: true, program: { select: { name: true } } },
  });
}

export async function openBarriersForTheming() {
  return db.barrier.findMany({
    where: { status: { not: "closed" } },
    orderBy: { raisedAt: "asc" },
    select: { id: true, themeLabel: true, summary: true },
  });
}

export interface ThemeProposal {
  label: string;
  summary: string;
  escalationTarget: EscalationTarget;
  responseIds: string[];
  /** Counted from the responses assigned, in code. */
  count: number;
  /** An open barrier this theme belongs to, if the model matched one. */
  barrier: { id: string; label: string } | null;
}

export type ThemingResult =
  | { ok: true; proposals: ThemeProposal[] }
  | { ok: false; reason: string };

export async function proposeThemes(user: User, quarter: string, deps: LlmDependencies = {}): Promise<ThemingResult> {
  if (user.role !== "chair") throw new PulsePermissionError("Only the chair themes pulse responses.");
  const [responses, barriers] = await Promise.all([unthemedResponses(quarter), openBarriersForTheming()]);
  if (responses.length < MIN_TO_THEME) {
    return { ok: false, reason: `There ${responses.length === 1 ? "is one response" : "are no responses"} with text still to theme this quarter. Add it to a barrier by hand below.` };
  }
  // The model sees text and keys only: no names, programs, domains or dates.
  const rKeys = responses.map((r, i) => ({ key: `r${i + 1}`, id: r.id, text: r.barrierText ?? "" }));
  const bKeys = barriers.map((b, i) => ({ key: `b${i + 1}`, barrier: b }));
  try {
    const output = await runPrompt(
      pulseThemePrompt,
      {
        responses: rKeys.map(({ key, text }) => ({ key, text })),
        openBarriers: bKeys.map(({ key, barrier }) => ({ key, label: barrier.themeLabel, summary: barrier.summary })),
      },
      { userId: user.id },
      deps,
    );
    const byKey = new Map(rKeys.map((r) => [r.key, r.id]));
    const barrierByKey = new Map(bKeys.map((b) => [b.key, b.barrier]));
    return {
      ok: true,
      proposals: output.themes.map((t) => {
        const responseIds = t.responseKeys.map((k) => byKey.get(k)!).filter(Boolean);
        const barrier = t.barrierKey ? barrierByKey.get(t.barrierKey) ?? null : null;
        return {
          label: t.label,
          summary: t.summary,
          escalationTarget: t.escalationTarget,
          responseIds,
          count: responseIds.length,
          barrier: barrier ? { id: barrier.id, label: barrier.themeLabel } : null,
        };
      }),
    };
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    console.error("[pulse.theme] unavailable", error);
    return {
      ok: false,
      reason: "Theming is unavailable right now. The responses are listed below; group them into a barrier by hand, writing the summary in your own words.",
    };
  }
}
