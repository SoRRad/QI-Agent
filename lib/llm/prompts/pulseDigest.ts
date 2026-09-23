import { z } from "zod";
import { sourceNumbersGuard } from "../guards/sourceNumbers";
import type { PromptDefinition } from "./types";

/**
 * "You reported, we changed" (§6.4): a short trainee-facing digest of closed
 * barriers and what changed.
 *
 * The model is given closed barriers only — their theme, the decision and
 * what changed, all written by the committee — and never a response. It may
 * write about each barrier it was given, exactly once, and about nothing
 * else. It may repeat a number from those records but not add one. The chair
 * edits the draft before anything is published.
 */

export interface DigestBarrier {
  key: string;
  label: string;
  decision: string;
  whatChanged: string;
  /** "August 2026". */
  closedMonth: string;
}

export interface DigestInput {
  barriers: DigestBarrier[];
}

const schema = z.object({
  headline: z.string().min(8).max(90),
  intro: z.string().min(20).max(400),
  items: z.array(z.object({ key: z.string().min(1).max(10), text: z.string().min(20).max(500) })).min(1),
});

export type DigestOutput = z.infer<typeof schema>;

export function digestSource(input: DigestInput): string {
  return input.barriers.flatMap((b) => [b.label, b.decision, b.whatChanged, b.closedMonth]).join("\n");
}

export const pulseDigestPrompt: PromptDefinition<DigestInput, DigestOutput> = {
  id: "pulse.digest",
  purpose:
    "Drafts the trainee-facing “You reported, we changed” digest from barriers the committee has closed, for the chair to edit and publish.",
  maxTokens: 2_000,
  system: [
    "You write a short digest for residents and fellows at a teaching hospital. Each quarter they report barriers to quality improvement work in a survey; this digest tells them what the committee changed as a result. Its purpose is to show that reporting leads somewhere.",
    "",
    "You are given the barriers the committee has closed, each with a key, the problem, the decision and what changed. Write:",
    "- headline: one line.",
    "- intro: one or two sentences.",
    "- items: one per barrier, keyed, in the order given. Each says briefly what trainees reported and what is different now, in plain words a busy resident will read on a phone.",
    "",
    "Rules:",
    "- Write about each barrier given exactly once, and about nothing else.",
    "- Say only what the records say changed. Do not promise further changes or describe benefits the records do not state.",
    "- Never introduce a number that is not in the records.",
    "- Never quote or imagine what an individual trainee said.",
  ].join("\n"),

  render(input) {
    return [
      "Closed barriers:",
      ...input.barriers.map((b) => [`- key ${b.key} (closed ${b.closedMonth}): ${b.label}`, `  Decision: ${b.decision}`, `  What changed: ${b.whatChanged}`].join("\n")),
      "",
      "Write the digest.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const keys = input.barriers.map((b) => b.key);
    const unknown = output.items.filter((i) => !keys.includes(i.key));
    if (unknown.length) return `It wrote about keys that were not given (${unknown.map((i) => i.key).join(", ")}). Write only about the barriers given.`;
    const written = output.items.map((i) => i.key);
    if (new Set(written).size !== written.length) return "It wrote about the same barrier twice.";
    const missing = keys.filter((k) => !written.includes(k));
    if (missing.length) return `It left out barriers it was given (${missing.join(", ")}). Write one item for each.`;
    const numbers = sourceNumbersGuard([output.headline, output.intro, ...output.items.map((i) => i.text)].join("\n"), digestSource(input));
    if (numbers) return `The digest ${numbers}`;
    return null;
  },

  mock(input) {
    return {
      headline: "You reported, we changed",
      intro: "Each item below started as something trainees raised in the quarterly pulse survey. This is what the committee did about it.",
      items: input.barriers.map((b) => ({
        key: b.key,
        text: `You told us: ${b.label.replace(/\.$/, "")}. What is different now: ${b.whatChanged}`,
      })),
    };
  },
};
