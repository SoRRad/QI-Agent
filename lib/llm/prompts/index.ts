import { chartInterpretationPrompt } from "./chartInterpretation";
import type { PromptDefinition } from "./types";

export type { PromptDefinition } from "./types";
export { chartInterpretationPrompt, interpretationValues } from "./chartInterpretation";
export type { InterpretationInput } from "./chartInterpretation";

/**
 * Every prompt in the system. docs/PROMPTS.md must have a section for each id
 * here; tests/llm/prompts.test.ts enforces it, and runs every mock through its
 * own schema and refine so the demo path is known to satisfy the real checks.
 */
export const ALL_PROMPTS: ReadonlyArray<PromptDefinition<never, unknown>> = [
  chartInterpretationPrompt as PromptDefinition<never, unknown>,
];
