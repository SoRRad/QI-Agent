import { createLlm, type LlmDependencies } from "./index";
import type { PromptDefinition } from "./prompts/types";

/**
 * Runs a prompt definition: renders it, calls the configured provider through
 * the audited adapter, validates against its schema and refine, and supplies
 * its mock when the provider is `mock`.
 */
export async function runPrompt<Input, Output>(
  prompt: PromptDefinition<Input, Output>,
  input: Input,
  context: { userId?: string | null },
  deps: LlmDependencies = {},
): Promise<Output> {
  const llm = createLlm({ feature: prompt.id, userId: context.userId ?? null }, deps);
  return llm.completeJSON<Output>({
    system: prompt.system,
    prompt: prompt.render(input),
    schema: prompt.schema,
    ...(prompt.maxTokens ? { maxTokens: prompt.maxTokens } : {}),
    ...(prompt.refine ? { refine: (output: Output) => prompt.refine?.(output, input) ?? null } : {}),
    mock: () => JSON.stringify(prompt.mock(input)),
  });
}
