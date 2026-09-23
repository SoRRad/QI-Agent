import {
  LlmConfigurationError,
  LlmRefusalError,
  LlmRequestError,
  LlmTruncatedError,
  type DriverRequest,
  type DriverResponse,
  type LlmDriver,
  type ProviderName,
} from "../types";

/**
 * The chat-completions wire format, shared by two providers:
 *
 *   azure-openai       {endpoint}/openai/deployments/{deployment}/chat/completions
 *                      ?api-version=..., authenticated with an `api-key` header.
 *   openai-compatible  {baseUrl}/chat/completions, with an optional bearer key.
 *                      For an internal gateway at an arbitrary base URL, which
 *                      is the likely production path where the enclave has no
 *                      outbound HTTPS to a public endpoint (Q9).
 *
 * Plain fetch, because these are not Anthropic endpoints and an institution's
 * gateway may speak only the wire format, not a vendor SDK's assumptions.
 *
 * The token-limit parameter name differs between deployments: newer reasoning
 * models accept only `max_completion_tokens`, many gateways only `max_tokens`.
 * It is configurable (LLM_MAX_TOKENS_PARAM) and on the IT checklist.
 */

export type MaxTokensParam = "max_tokens" | "max_completion_tokens";

export interface ChatCompletionsOptions {
  name: Extract<ProviderName, "azure-openai" | "openai-compatible">;
  url: string;
  headers: Record<string, string>;
  /** Sent in the body for openai-compatible; Azure implies it from the deployment. */
  model: string;
  sendModel: boolean;
  maxTokensParam?: MaxTokensParam;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

interface ChatCompletionsResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const RETRYABLE = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

export function chatCompletionsDriver(options: ChatCompletionsOptions): LlmDriver {
  const transport = options.fetch ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const tokenParam = options.maxTokensParam ?? "max_tokens";

  return {
    name: options.name,
    model: options.model,
    async generate(request: DriverRequest): Promise<DriverResponse> {
      const body = {
        ...(options.sendModel ? { model: options.model } : {}),
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: request.prompt },
        ],
        [tokenParam]: request.maxTokens,
      };

      let lastError: LlmRequestError | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (attempt > 0) await sleep(backoff(attempt, lastError));

        let response: Response;
        try {
          response = await transport(options.url, {
            method: "POST",
            headers: { "content-type": "application/json", ...options.headers },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
          });
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "TimeoutError";
          lastError = new LlmRequestError(
            timedOut ? `The ${options.name} endpoint did not respond in time.` : `Could not reach the ${options.name} endpoint.`,
            null,
            true,
          );
          continue;
        }

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new LlmConfigurationError(`The ${options.name} endpoint rejected the configured credentials.`);
          }
          lastError = new LlmRequestError(
            `The ${options.name} endpoint returned an error (${response.status}).`,
            response.status,
            RETRYABLE(response.status),
          );
          (lastError as LlmRequestError & { retryAfter?: number }).retryAfter = retryAfterMs(response);
          if (!lastError.retryable) throw lastError;
          continue;
        }

        const json = (await response.json()) as ChatCompletionsResponse;
        const choice = json.choices?.[0];
        if (choice?.finish_reason === "content_filter") throw new LlmRefusalError("content_filter");
        if (choice?.finish_reason === "length") throw new LlmTruncatedError();

        return {
          text: choice?.message?.content ?? "",
          model: json.model ?? options.model,
          ...(json.usage?.prompt_tokens !== undefined ? { inputTokens: json.usage.prompt_tokens } : {}),
          ...(json.usage?.completion_tokens !== undefined ? { outputTokens: json.usage.completion_tokens } : {}),
        };
      }

      throw lastError ?? new LlmRequestError(`The ${options.name} endpoint failed.`, null, false);
    },
  };
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, 10_000) : undefined;
}

function backoff(attempt: number, error: LlmRequestError | null): number {
  const hinted = (error as (LlmRequestError & { retryAfter?: number }) | null)?.retryAfter;
  return hinted ?? 500 * 2 ** (attempt - 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
