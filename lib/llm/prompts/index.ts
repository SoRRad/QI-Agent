import { askAnswerPrompt } from "./askAnswer";
import { chartInterpretationPrompt } from "./chartInterpretation";
import { devilsAdvocatePrompt } from "./devilsAdvocate";
import { tutorPrompt } from "./tutor";
import type { PromptDefinition } from "./types";

export type { PromptDefinition } from "./types";
export { chartInterpretationPrompt, interpretationValues } from "./chartInterpretation";
export type { InterpretationInput } from "./chartInterpretation";
export { askAnswerPrompt } from "./askAnswer";
export type { AskDocument, AskInput, AskOutput } from "./askAnswer";
export { tutorPrompt, looksLikeAimStatement } from "./tutor";
export type { TutorInput, TutorTurn } from "./tutor";
export { devilsAdvocatePrompt, RISK_CATEGORIES } from "./devilsAdvocate";
export type { DevilsAdvocateInput, DevilsAdvocateOutput } from "./devilsAdvocate";

/**
 * Every prompt in the system. docs/PROMPTS.md must have a section for each id
 * here; tests/llm/prompts.test.ts enforces it, and runs every mock through its
 * own schema and refine so the demo path is known to satisfy the real checks.
 */
export const ALL_PROMPTS: ReadonlyArray<PromptDefinition<never, unknown>> = [
  askAnswerPrompt as PromptDefinition<never, unknown>,
  tutorPrompt as PromptDefinition<never, unknown>,
  devilsAdvocatePrompt as PromptDefinition<never, unknown>,
  chartInterpretationPrompt as PromptDefinition<never, unknown>,
];
