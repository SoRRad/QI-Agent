import { z, type ZodType } from "zod";
import { anthropicDriver, parseEffort } from "./drivers/anthropic";
import { chatCompletionsDriver, type MaxTokensParam } from "./drivers/chatCompletions";
import { mockDriver } from "./drivers/mock";
import { extractJson } from "./json";
import {
  LlmConfigurationError,
  LlmOutputError,
  type CompleteJsonOptions,
  type CompleteOptions,
  type LlmDriver,
  type LlmProvider,
  type ProviderName,
} from "./types";

export * from "./types";
export { extractJson } from "./json";

/**
 * The one place a provider is chosen. Changing the institution's endpoint is a
 * change to environment variables — or, for a provider not yet written, one
 * new driver file and one case here.
 */
export function driverFromEnv(
  env: Record<string, string | undefined> = process.env,
  transport?: typeof fetch,
): LlmDriver {
  const provider = (env["LLM_PROVIDER"] ?? "mock") as ProviderName;
  const timeoutMs = env["LLM_TIMEOUT_MS"] ? Number(env["LLM_TIMEOUT_MS"]) : 60_000;
  const maxTokensParam = (env["LLM_MAX_TOKENS_PARAM"] ?? "max_tokens") as MaxTokensParam;

  switch (provider) {
    case "mock":
      return mockDriver();

    case "anthropic":
      return anthropicDriver({
        apiKey: env["ANTHROPIC_API_KEY"] ?? "",
        model: env["ANTHROPIC_MODEL"] || "claude-opus-5",
        ...(env["ANTHROPIC_BASE_URL"] ? { baseURL: env["ANTHROPIC_BASE_URL"] } : {}),
        fallbacks: env["ANTHROPIC_FALLBACKS"] !== "off",
        ...(env["ANTHROPIC_EFFORT"] ? { effort: parseEffort(env["ANTHROPIC_EFFORT"]) } : {}),
        timeoutMs,
        ...(transport ? { fetch: transport } : {}),
      });

    case "azure-openai": {
      const endpoint = required(env, "AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
      const deployment = required(env, "AZURE_OPENAI_DEPLOYMENT");
      const version = env["AZURE_OPENAI_API_VERSION"] || "2024-10-21";
      return chatCompletionsDriver({
        name: "azure-openai",
        url: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(version)}`,
        headers: { "api-key": required(env, "AZURE_OPENAI_API_KEY") },
        model: deployment,
        sendModel: false,
        maxTokensParam,
        timeoutMs,
        ...(transport ? { fetch: transport } : {}),
      });
    }

    case "openai-compatible": {
      const baseUrl = required(env, "OPENAI_COMPATIBLE_BASE_URL").replace(/\/+$/, "");
      const key = env["OPENAI_COMPATIBLE_API_KEY"];
      return chatCompletionsDriver({
        name: "openai-compatible",
        url: `${baseUrl}/chat/completions`,
        headers: key ? { authorization: `Bearer ${key}` } : {},
        model: required(env, "OPENAI_COMPATIBLE_MODEL"),
        sendModel: true,
        maxTokensParam,
        timeoutMs,
        ...(transport ? { fetch: transport } : {}),
      });
    }

    default:
      throw new LlmConfigurationError(
        `LLM_PROVIDER must be one of mock, anthropic, azure-openai, openai-compatible.`,
      );
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new LlmConfigurationError(`${name} is not set.`);
  return value;
}

// ---------------------------------------------------------------- audit

export interface LlmCallRecord {
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  ok: boolean;
}

export type LlmAuditor = (record: LlmCallRecord) => Promise<void>;

/**
 * The production auditor. Imported lazily so that code which injects its own
 * auditor — the unit tests — never loads the database client.
 */
const defaultAuditor: LlmAuditor = async (record) => {
  const { auditLlmCall } = await import("@/lib/audit");
  await auditLlmCall(record);
};

// ---------------------------------------------------------------- provider

export interface LlmContext {
  /** Named feature, e.g. `ask.answer`. Recorded on every call. */
  feature: string;
  userId?: string | null;
}

export interface LlmDependencies {
  driver?: LlmDriver;
  audit?: LlmAuditor;
}

const DEFAULT_MAX_TOKENS = 16_000;

const JSON_INSTRUCTION = (schema: ZodType<unknown>) =>
  [
    "Respond with a single JSON value that matches this JSON Schema, and nothing else — no prose, no code fence.",
    JSON.stringify(z.toJSONSchema(schema)),
  ].join("\n");

/**
 * Returns a provider bound to one feature and user, so every call it makes is
 * audited with who asked, for what, what it cost, and how long it took. Never
 * the prompt, and never the reply.
 */
export function createLlm(context: LlmContext, deps: LlmDependencies = {}): LlmProvider {
  const driver = deps.driver ?? driverFromEnv();
  const audit = deps.audit ?? defaultAuditor;
  const userId = context.userId ?? null;

  async function call(opts: CompleteOptions): Promise<string> {
    const started = performance.now();
    let ok = false;
    let model = driver.model;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      const response = await driver.generate({
        feature: context.feature,
        prompt: opts.prompt,
        maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.mock ? { mock: opts.mock } : {}),
      });
      ok = true;
      model = response.model;
      inputTokens = response.inputTokens;
      outputTokens = response.outputTokens;
      return response.text;
    } finally {
      await audit({
        userId,
        feature: context.feature,
        provider: driver.name,
        model,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        latencyMs: Math.round(performance.now() - started),
        ok,
      });
    }
  }

  return {
    complete: call,

    /**
     * Validates against the schema, then against `refine` if given. On
     * failure, asks ONCE more with the reason attached, then throws. Two
     * attempts is the budget: a model that cannot produce the shape twice in
     * a row will not produce it on the fifth try either, and the user is
     * waiting.
     */
    async completeJSON<T>(opts: CompleteJsonOptions<T>): Promise<T> {
      const system = [opts.system, JSON_INSTRUCTION(opts.schema as ZodType<unknown>)].filter(Boolean).join("\n\n");
      let prompt = opts.prompt;
      let lastIssue = "";

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await call({ ...opts, system, prompt });
        const issue = validate(text, opts);
        if (issue.ok) return issue.value;

        lastIssue = issue.message;
        prompt = [
          opts.prompt,
          "",
          `Your previous reply could not be used: ${issue.message}`,
          "Reply again with only the corrected JSON.",
        ].join("\n");
      }

      throw new LlmOutputError(lastIssue);
    },
  };
}

type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

function validate<T>(text: string, opts: CompleteJsonOptions<T>): Validation<T> {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "),
    };
  }

  const refined = opts.refine?.(parsed.data) ?? null;
  return refined ? { ok: false, message: refined } : { ok: true, value: parsed.data };
}
