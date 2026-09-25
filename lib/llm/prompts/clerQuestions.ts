import { z } from "zod";
import { CLER_OPTIONS } from "@/lib/cler";
import { QUESTION_BANK } from "@/lib/committee/cler";
import type { ClerDomain } from "@/lib/generated/prisma/client";
import type { PromptDefinition } from "./types";

/**
 * The CLER mock walkaround's questions (§6.6): realistic interviewer questions
 * across all six focus areas, for a named setting.
 *
 * Questions only. The model never sees a response and never rates one: the
 * interviewer records what was said and how well it was answered, and the gap
 * reading is counted in code (lib/committee/cler.ts).
 */

export interface ClerQuestionsInput {
  /** "Medicine wards", "the surgical ICU" — where the walkaround happens. */
  setting: string;
  /** Who will be asked: "residents and fellows" by default. */
  audience: string;
}

const DOMAINS = CLER_OPTIONS.map(([d]) => d) as [ClerDomain, ...ClerDomain[]];

const schema = z.object({
  questions: z
    .array(
      z.object({
        domain: z.enum(DOMAINS),
        question: z.string().min(20).max(220),
      }),
    )
    .min(6)
    .max(18),
});

export type ClerQuestionsOutput = z.infer<typeof schema>;

export const clerQuestionsPrompt: PromptDefinition<ClerQuestionsInput, ClerQuestionsOutput> = {
  id: "committee.cler_questions",
  purpose: "Writes realistic interviewer questions across the six CLER focus areas for a mock walkaround, for the committee to ask residents in person.",
  maxTokens: 1_500,
  system: [
    "You help a graduate medical education committee rehearse for an ACGME Clinical Learning Environment Review (CLER) site visit. In a real visit, interviewers walk the clinical areas and ask residents and fellows open questions about how things actually work.",
    "",
    "Write questions an interviewer would ask during a walkaround in the setting given, covering all six CLER focus areas: patient safety, health care quality, care transitions, supervision, well-being, and professionalism. Between one and three questions per focus area.",
    "",
    "Rules:",
    "- Each question is one open question, answerable on the spot by a resident, about what they would do or have seen here — not about definitions or policy wording.",
    "- Ask about practice, not knowledge of acronyms. Never ask a resident to disclose anything about a patient.",
    "- Do not include numbers or statistics.",
    "- Do not claim what the ACGME requires or what this institution's policy says.",
  ].join("\n"),

  render(input) {
    return [`Setting: ${input.setting}`, `Who will be asked: ${input.audience}`, "", "Write the questions."].join("\n");
  },

  schema,

  refine(output) {
    const counts = new Map<ClerDomain, number>();
    for (const q of output.questions) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
    const missing = CLER_OPTIONS.filter(([d]) => !counts.get(d)).map(([, label]) => label);
    if (missing.length) return `It left out focus areas (${missing.join(", ")}). Ask at least one question in each of the six.`;
    const over = CLER_OPTIONS.filter(([d]) => (counts.get(d) ?? 0) > 3).map(([, label]) => label);
    if (over.length) return `Too many questions for ${over.join(", ")}. At most three per focus area.`;
    const withNumber = output.questions.find((q) => /\d/.test(q.question));
    if (withNumber) return `A question contains a number ("${withNumber.question}"). Leave numbers out.`;
    const notQuestion = output.questions.find((q) => !q.question.trim().endsWith("?"));
    if (notQuestion) return `"${notQuestion.question}" is not a question. End each with a question mark.`;
    const texts = output.questions.map((q) => q.question.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) return "Two questions are the same. Write each once.";
    return null;
  },

  mock() {
    return {
      questions: CLER_OPTIONS.flatMap(([domain]) => QUESTION_BANK[domain].map((question) => ({ domain, question }))),
    };
  },
};
