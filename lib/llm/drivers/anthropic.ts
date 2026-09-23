import Anthropic from "@anthropic-ai/sdk";
import {
  LlmConfigurationError,
  LlmRefusalError,
  LlmRequestError,
  LlmTruncatedError,
  type DriverRequest,
  type DriverResponse,
  type LlmDriver,
} from "../types";

/**
 * Anthropic, through the official SDK.
 *
 * Defaults, each overridable by environment:
 *
 *   model      claude-opus-5. No model was specified for this system, so the
 *              default is the current recommended model rather than a cheaper
 *              one chosen on the committee's behalf. ANTHROPIC_MODEL changes it.
 *   fallbacks  "default", under the server-side-fallback-2026-07-01 beta. If
 *              the model's safety classifiers decline a request, the API
 *              re-runs it on a fallback model chosen by refusal category,
 *              inside the same call. ANTHROPIC_FALLBACKS=off disables it.
 *   effort     the API default. ANTHROPIC_EFFORT=low|medium|high|xhigh|max
 *              tunes cost against depth; low and medium are worth measuring
 *              for the short grounded tasks this system mostly runs.
 *
 * Only `text` blocks are returned. Thinking is on by default on this model and
 * its blocks are never shown to users.
 */

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

export interface AnthropicDriverOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  fallbacks?: boolean;
  effort?: Effort;
  timeoutMs?: number;
  /** Injected transport, for contract tests. */
  fetch?: typeof fetch;
}

export function anthropicDriver(options: AnthropicDriverOptions): LlmDriver {
  if (!options.apiKey) {
    throw new LlmConfigurationError("ANTHROPIC_API_KEY is not set.");
  }
  const model = options.model ?? "claude-opus-5";
  // baseURL and authToken are passed EXPLICITLY. Left undefined, the SDK
  // falls back to ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN from the process
  // environment — so a stray token on the host could be sent alongside the
  // key this app was configured with. Configuration here is only ever what
  // driverFromEnv read from the app's own settings.
  const client = new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    baseURL: options.baseURL ?? "https://api.anthropic.com",
    timeout: options.timeoutMs ?? 60_000,
    maxRetries: 2,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    name: "anthropic",
    model,
    async generate(request: DriverRequest): Promise<DriverResponse> {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: request.maxTokens,
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: "user", content: request.prompt }],
          ...(options.fallbacks === false ? {} : { betas: [FALLBACK_BETA], fallbacks: "default" as const }),
          ...(options.effort ? { output_config: { effort: options.effort } } : {}),
        });
      } catch (error) {
        throw mapError(error);
      }

      // Check the stop reason BEFORE reading content: a refusal arrives as
      // HTTP 200. With fallbacks on, a refusal here means the whole chain
      // declined.
      if (response.stop_reason === "refusal") {
        throw new LlmRefusalError(response.stop_details?.category ?? null);
      }
      if (response.stop_reason === "max_tokens") {
        throw new LlmTruncatedError();
      }

      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      return {
        text,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

export function parseEffort(value: string | undefined): Effort | undefined {
  if (!value) return undefined;
  if ((EFFORTS as readonly string[]).includes(value)) return value as Effort;
  throw new LlmConfigurationError(`ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}.`);
}

/**
 * Typed SDK errors, most specific first. The SDK's messages carry the API's
 * error text, never the request headers, so they are safe to surface.
 */
function mapError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmConfigurationError("The Anthropic API rejected the configured credentials.");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new LlmConfigurationError("The configured Anthropic key is not permitted to use this model.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmRequestError("The Anthropic API is rate limiting requests. Try again shortly.", 429, true);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmRequestError("The Anthropic API did not respond in time.", null, true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmRequestError("Could not reach the Anthropic API.", null, true);
  }
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === "number" ? error.status : null;
    const retryable = status !== null && (status >= 500 || status === 408 || status === 409);
    return new LlmRequestError(`The Anthropic API returned an error${status ? ` (${status})` : ""}.`, status, retryable);
  }
  return error instanceof Error ? error : new Error(String(error));
}
