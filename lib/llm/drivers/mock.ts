import type { DriverRequest, DriverResponse, LlmDriver } from "../types";

/**
 * The default provider. Deterministic, credential-free, and good enough to
 * demonstrate every feature.
 *
 * Each prompt definition in lib/llm/prompts supplies its own mock alongside
 * the real prompt, so the stand-in behaviour is reviewed in the same place as
 * the prompt it stands in for. A call with no mock gets a clearly labelled
 * placeholder rather than plausible-looking invented text.
 */
export function mockDriver(): LlmDriver {
  return {
    name: "mock",
    model: "mock",
    async generate(request: DriverRequest): Promise<DriverResponse> {
      const text = request.mock
        ? request.mock()
        : `[mock provider — no stand-in is defined for "${request.feature}". Set LLM_PROVIDER to a real provider to see model output.]`;
      return {
        text,
        model: "mock",
        // A rough, stable figure so audit rows and usage views have realistic
        // shape in a demo. Clearly not a billing number.
        inputTokens: Math.ceil(((request.system?.length ?? 0) + request.prompt.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    },
  };
}
