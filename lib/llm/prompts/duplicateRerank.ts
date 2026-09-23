import { z } from "zod";
import { contentWords } from "@/lib/ask/text";
import { sourceNumbersGuard } from "../guards/sourceNumbers";
import type { PromptDefinition } from "./types";

/**
 * Duplicate detection's judgement step (ADR-0003). Trigram recall finds
 * candidates that share words; this decides which are genuinely the same
 * problem and says, in one sentence, what overlaps.
 *
 * The model never states how a prior project turned out. Its outcome and the
 * reason it ended are shown from the registry record, verbatim, beside the
 * model's sentence — so a trainee reads what actually happened, not a
 * paraphrase of it.
 */

export interface RerankCandidate {
  key: string;
  title: string;
  problemStatement: string;
  program: string;
  cohortYear: number | null;
  status: string;
}

export interface RerankInput {
  title: string;
  problemStatement: string;
  candidates: RerankCandidate[];
}

const schema = z.object({
  matches: z
    .array(z.object({ key: z.string().min(1).max(10), reason: z.string().min(10).max(240) }))
    .max(5),
});

export type RerankOutput = z.infer<typeof schema>;

export function rerankSource(input: RerankInput): string {
  return [input.title, input.problemStatement, ...input.candidates.flatMap((c) => [c.title, c.problemStatement, c.program, String(c.cohortYear ?? "")])].join("\n");
}

/** Words too general to make two projects "the same problem" on their own. */
const GENERIC = new Set(["patient", "improv", "better", "team", "resident", "hospital", "ward", "servic", "rate", "time", "reduc", "increas", "care", "project", "month", "week", "think", "frequent", "often", "consistent", "inconsistent"]);

export const duplicateRerankPrompt: PromptDefinition<RerankInput, RerankOutput> = {
  id: "projects.duplicate_rerank",
  purpose:
    "At intake, decides which earlier projects in the registry address the same problem as a new one, and says in one sentence what overlaps.",
  maxTokens: 1_500,
  system: [
    "You help a graduate medical education quality improvement committee avoid repeating work.",
    "",
    "You are given a new project's title and problem statement, and a list of earlier projects from the registry. Return only the earlier projects that address substantially the same problem — the same process, in a similar setting — not ones that merely share a word.",
    "",
    "For each match, write one sentence saying what the two projects have in common, so the new team knows why to read it. Refer to the earlier project by what it did, not by its key.",
    "",
    "Rules:",
    "- Never say how an earlier project turned out, whether it succeeded, or why it ended. That is shown separately from the record.",
    "- Never introduce a number that is not in what you were given.",
    "- Return an empty list if nothing genuinely matches. A false match wastes the team's time.",
    "- At most five matches, most relevant first.",
  ].join("\n"),

  render(input) {
    return [
      `New project: ${input.title}`,
      `Problem: ${input.problemStatement}`,
      "",
      "Earlier projects:",
      ...input.candidates.map(
        (c) => `- key ${c.key}: "${c.title}" (${c.program}, ${c.cohortYear ?? "cohort unknown"}, ${c.status}). Problem: ${c.problemStatement}`,
      ),
      "",
      "Which of these address the same problem?",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const keys = new Set(input.candidates.map((c) => c.key));
    const unknown = output.matches.filter((m) => !keys.has(m.key));
    if (unknown.length > 0) return `It returned keys that were not in the list (${unknown.map((m) => m.key).join(", ")}). Use only the keys given.`;
    if (new Set(output.matches.map((m) => m.key)).size !== output.matches.length) return "It listed the same project twice.";
    const numbers = sourceNumbersGuard(output.matches.map((m) => m.reason).join("\n"), rerankSource(input));
    if (numbers) return `The reasons ${numbers}`;
    if (output.matches.some((m) => /\b(succeeded|failed|abandoned|ended|completed|archived|worked)\b/i.test(m.reason))) {
      return "A reason described how an earlier project turned out. Say only what the two projects have in common; the outcome is shown from the record.";
    }
    return null;
  },

  mock(input) {
    const mine = new Set(contentWords(`${input.title} ${input.problemStatement}`).filter((w) => !GENERIC.has(w)));
    const titleWords = new Set(contentWords(input.title).filter((w) => !GENERIC.has(w)));
    const matches = input.candidates
      .map((c) => {
        const theirs = contentWords(`${c.title} ${c.problemStatement}`);
        const shared = [...new Set(theirs.filter((w) => mine.has(w)))];
        const inTitle = shared.filter((w) => titleWords.has(w));
        return { c, shared, inTitle };
      })
      .filter(({ shared, inTitle }) => inTitle.length > 0 || shared.length >= 3)
      .sort((a, b) => b.inTitle.length - a.inTitle.length || b.shared.length - a.shared.length)
      .slice(0, 5)
      .map(({ c, inTitle, shared }) => {
        const word = (c.title.match(/[A-Za-z][A-Za-z'-]+/g) ?? []).find((w) => [...inTitle, ...shared].some((s) => contentWords(w).includes(s)));
        return {
          key: c.key,
          reason: `Both look at ${word ? word.toLowerCase() : "the same process"} in ${c.program.replace(/ Residency$/, "").toLowerCase()} — read what that team learned before designing your first cycle.`,
        };
      });
    return { matches };
  },
};
