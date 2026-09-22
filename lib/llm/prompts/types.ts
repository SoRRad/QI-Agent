import type { ZodType } from "zod";

/**
 * Every prompt in the system is one of these, exported by name from a file in
 * lib/llm/prompts/ — never written inline in a route handler, because the
 * committee reviews them. docs/PROMPTS.md describes each one in plain language,
 * and a test fails if a prompt exists without a section there.
 */
export interface PromptDefinition<Input, Output> {
  /** Stable id, recorded as the `feature` on every audited call. */
  id: string;
  /** One sentence, for the committee: what this prompt is for. */
  purpose: string;
  system: string;
  render(input: Input): string;
  schema: ZodType<Output>;
  /** Semantic checks after the schema passes. Return a reason, or null. */
  refine?(output: Output, input: Input): string | null;
  /** Deterministic stand-in for LLM_PROVIDER=mock. Must satisfy schema and refine. */
  mock(input: Input): Output;
  maxTokens?: number;
}
