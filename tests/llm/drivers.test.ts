import { describe, expect, it } from "vitest";
import { anthropicDriver } from "@/lib/llm/drivers/anthropic";
import { chatCompletionsDriver } from "@/lib/llm/drivers/chatCompletions";
import {
  driverFromEnv,
  LlmConfigurationError,
  LlmRefusalError,
  LlmRequestError,
  LlmTruncatedError,
} from "@/lib/llm";

/**
 * Contract tests: each driver against a STUBBED transport. No network, no key.
 * They pin the request each provider sends and how each response shape is
 * read, which is what breaks first when an endpoint changes.
 *
 * A live check against a real provider is `pnpm smoke:llm`.
 */

const SECRET = "sk-test-DO-NOT-LEAK-1234567890";

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function stub(...responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Captured[] = [];
  let i = 0;
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(next?.body ?? {}), {
      status: next?.status ?? 200,
      headers: { "content-type": "application/json", ...(next?.headers ?? {}) },
    });
  }) as typeof fetch;
  return { transport, calls };
}

const anthropicReply = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: "Hello " },
    { type: "text", text: "there." },
  ],
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 12, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  ...overrides,
});

const request = { feature: "test.feature", system: "Be brief.", prompt: "Say hello.", maxTokens: 256 };

// ---------------------------------------------------------------- anthropic

describe("anthropic driver", () => {
  const make = (transport: typeof fetch, extra: Record<string, unknown> = {}) =>
    anthropicDriver({ apiKey: SECRET, baseURL: "https://api.anthropic.test", fetch: transport, ...extra });

  it("sends a Messages API request with the configured key, model and fallbacks", async () => {
    const { transport, calls } = stub({ status: 200, body: anthropicReply() });
    await make(transport).generate(request);

    const [call] = calls;
    expect(call?.url).toBe("https://api.anthropic.test/v1/messages?beta=true");
    expect(call?.headers.get("x-api-key")).toBe(SECRET);
    expect(call?.headers.get("anthropic-version")).toBeTruthy();
    expect(call?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    // The app's own key and nothing else: no stray bearer token from the host.
    expect(call?.headers.get("authorization")).toBeNull();

    expect(call?.body).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 256,
      system: "Be brief.",
      messages: [{ role: "user", content: "Say hello." }],
      fallbacks: "default",
    });
  });

  it("returns only text blocks, with the served model and token counts", async () => {
    const { transport } = stub({ status: 200, body: anthropicReply({ model: "claude-opus-4-8" }) });
    const response = await make(transport).generate(request);
    expect(response.text).toBe("Hello there.");
    // A server-side fallback can serve the request on another model; the
    // audit records which one actually ran.
    expect(response.model).toBe("claude-opus-4-8");
    expect(response.inputTokens).toBe(12);
    expect(response.outputTokens).toBe(5);
  });

  it("omits fallbacks when turned off, and sends effort when set", async () => {
    const { transport, calls } = stub({ status: 200, body: anthropicReply() });
    await make(transport, { fallbacks: false, effort: "low" }).generate(request);
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
    expect(calls[0]?.body).toMatchObject({ output_config: { effort: "low" } });
  });

  it("treats a refusal as an error rather than reading its content", async () => {
    const { transport } = stub({
      status: 200,
      body: anthropicReply({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "x" },
        content: [],
      }),
    });
    await expect(make(transport).generate(request)).rejects.toMatchObject({
      name: "LlmRefusalError",
      category: "cyber",
    });
  });

  it("refuses to return a truncated reply", async () => {
    const { transport } = stub({ status: 200, body: anthropicReply({ stop_reason: "max_tokens" }) });
    await expect(make(transport).generate(request)).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("maps rejected credentials to a configuration error that does not contain the key", async () => {
    const { transport } = stub({
      status: 401,
      body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
    });
    const error = await make(transport).generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmConfigurationError);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it("does not retry a bad request", async () => {
    const { transport, calls } = stub({
      status: 400,
      body: { type: "error", error: { type: "invalid_request_error", message: "bad" } },
    });
    const error = await make(transport).generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect((error as LlmRequestError).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("retries a rate limit and then succeeds", async () => {
    const { transport, calls } = stub(
      { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow" } }, headers: { "retry-after-ms": "1" } },
      { status: 200, body: anthropicReply() },
    );
    const response = await make(transport).generate(request);
    expect(response.text).toBe("Hello there.");
    expect(calls).toHaveLength(2);
  });

  it("will not construct without a key", () => {
    expect(() => anthropicDriver({ apiKey: "" })).toThrow(/ANTHROPIC_API_KEY is not set/);
  });
});

// ---------------------------------------------------------------- chat completions

const chatReply = (overrides: Record<string, unknown> = {}) => ({
  id: "chatcmpl-1",
  model: "gateway-model",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello there." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 20, completion_tokens: 4 },
  ...overrides,
});

describe("azure-openai driver (via driverFromEnv)", () => {
  const env = {
    LLM_PROVIDER: "azure-openai",
    AZURE_OPENAI_ENDPOINT: "https://hospital.openai.azure.com/",
    AZURE_OPENAI_API_KEY: SECRET,
    AZURE_OPENAI_DEPLOYMENT: "qi-gpt",
    AZURE_OPENAI_API_VERSION: "2024-10-21",
  };

  it("posts to the deployment URL with an api-key header and no model in the body", async () => {
    const { transport, calls } = stub({ status: 200, body: chatReply() });
    const response = await driverFromEnv(env, transport).generate(request);

    expect(calls[0]?.url).toBe(
      "https://hospital.openai.azure.com/openai/deployments/qi-gpt/chat/completions?api-version=2024-10-21",
    );
    expect(calls[0]?.headers.get("api-key")).toBe(SECRET);
    expect(calls[0]?.body).not.toHaveProperty("model");
    expect(calls[0]?.body).toMatchObject({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Say hello." },
      ],
      max_tokens: 256,
    });
    expect(response).toMatchObject({ text: "Hello there.", inputTokens: 20, outputTokens: 4 });
  });

  it("uses max_completion_tokens when the deployment requires it", async () => {
    const { transport, calls } = stub({ status: 200, body: chatReply() });
    await driverFromEnv({ ...env, LLM_MAX_TOKENS_PARAM: "max_completion_tokens" }, transport).generate(request);
    expect(calls[0]?.body).toMatchObject({ max_completion_tokens: 256 });
    expect(calls[0]?.body).not.toHaveProperty("max_tokens");
  });

  it("names the missing variable, never a value", () => {
    const { AZURE_OPENAI_API_KEY: _key, ...missing } = env;
    expect(() => driverFromEnv(missing)).toThrow(/AZURE_OPENAI_API_KEY is not set/);
  });
});

describe("openai-compatible driver (via driverFromEnv)", () => {
  const env = {
    LLM_PROVIDER: "openai-compatible",
    OPENAI_COMPATIBLE_BASE_URL: "https://llm-gateway.hospital.internal/v1/",
    OPENAI_COMPATIBLE_API_KEY: SECRET,
    OPENAI_COMPATIBLE_MODEL: "internal-model",
  };

  it("posts to {baseUrl}/chat/completions with a bearer key and the model", async () => {
    const { transport, calls } = stub({ status: 200, body: chatReply() });
    await driverFromEnv(env, transport).generate(request);
    expect(calls[0]?.url).toBe("https://llm-gateway.hospital.internal/v1/chat/completions");
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(calls[0]?.body).toMatchObject({ model: "internal-model" });
  });

  it("sends no authorization header when the gateway needs no key", async () => {
    const { OPENAI_COMPATIBLE_API_KEY: _key, ...keyless } = env;
    const { transport, calls } = stub({ status: 200, body: chatReply() });
    await driverFromEnv(keyless, transport).generate(request);
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("retries a server error and then succeeds", async () => {
    const { transport, calls } = stub(
      { status: 503, body: { error: "busy" }, headers: { "retry-after": "0" } },
      { status: 200, body: chatReply() },
    );
    const response = await driverFromEnv(env, transport).generate(request);
    expect(response.text).toBe("Hello there.");
    expect(calls).toHaveLength(2);
  });

  it("gives up after its retries, with a message that carries no key", async () => {
    const { transport, calls } = stub({ status: 500, body: { error: SECRET }, headers: { "retry-after": "0" } });
    const error = await driverFromEnv(env, transport).generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect(calls).toHaveLength(3);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it("maps a content filter to a refusal and a length stop to truncation", async () => {
    const filtered = stub({ status: 200, body: chatReply({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }) });
    await expect(driverFromEnv(env, filtered.transport).generate(request)).rejects.toBeInstanceOf(LlmRefusalError);

    const cut = stub({ status: 200, body: chatReply({ choices: [{ message: { content: "Hel" }, finish_reason: "length" }] }) });
    await expect(driverFromEnv(env, cut.transport).generate(request)).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("treats rejected credentials as configuration, without retrying", async () => {
    const { transport, calls } = stub({ status: 401, body: {} });
    await expect(driverFromEnv(env, transport).generate(request)).rejects.toBeInstanceOf(LlmConfigurationError);
    expect(calls).toHaveLength(1);
  });

  it("times out a hung endpoint", async () => {
    const hung = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
        );
      })) as typeof fetch;
    const driver = chatCompletionsDriver({
      name: "openai-compatible",
      url: "https://x.test/chat/completions",
      headers: {},
      model: "m",
      sendModel: true,
      timeoutMs: 20,
      maxRetries: 0,
      fetch: hung,
    });
    await expect(driver.generate(request)).rejects.toThrow(/did not respond in time/);
  });
});

describe("provider selection", () => {
  it("defaults to the mock provider", () => {
    expect(driverFromEnv({}).name).toBe("mock");
  });

  it("defaults the anthropic model to claude-opus-5", () => {
    expect(driverFromEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: SECRET }).model).toBe("claude-opus-5");
  });

  it("rejects an unknown provider", () => {
    expect(() => driverFromEnv({ LLM_PROVIDER: "something-else" })).toThrow(/LLM_PROVIDER must be one of/);
  });

  it("rejects an invalid effort", () => {
    expect(() =>
      driverFromEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: SECRET, ANTHROPIC_EFFORT: "extreme" }),
    ).toThrow(/ANTHROPIC_EFFORT must be one of/);
  });
});
