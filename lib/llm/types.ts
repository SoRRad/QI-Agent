import type { ZodType } from "zod";

/**
 * The LLM adapter surface.
 *
 * `LlmProvider` is the interface from the build brief, unchanged in shape.
 * Two optional fields are additions, both documented where they are used:
 *
 *   refine — semantic validation after the schema passes (the numeric guard,
 *            citation validation). A failure consumes the same single retry
 *            as a schema failure.
 *   mock   — a deterministic stand-in used ONLY when LLM_PROVIDER=mock, so
 *            every feature is demonstrable without credentials. Real
 *            providers ignore it.
 */
export interface CompleteOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  mock?: () => string;
}

export interface CompleteJsonOptions<T> extends CompleteOptions {
  schema: ZodType<T>;
  /** Return an error message to reject a schema-valid value, or null to accept it. */
  refine?: (value: T) => string | null;
}

export interface LlmProvider {
  complete(opts: CompleteOptions): Promise<string>;
  completeJSON<T>(opts: CompleteJsonOptions<T>): Promise<T>;
}

export type ProviderName = "mock" | "anthropic" | "azure-openai" | "openai-compatible";

/** One request to a model, as a driver sees it. */
export interface DriverRequest {
  /** Named feature, for the mock driver's lookup and for audit. */
  feature: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  mock?: () => string;
}

export interface DriverResponse {
  text: string;
  /** The model that actually served the request, which can differ from the
   *  configured one when a server-side fallback ran. */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** A provider implementation. Drivers know HTTP; they know nothing of audit. */
export interface LlmDriver {
  readonly name: ProviderName;
  readonly model: string;
  generate(request: DriverRequest): Promise<DriverResponse>;
}

// ---------------------------------------------------------------- errors
//
// No error in this module ever carries a credential, a header, or a prompt
// body. Messages are written to be safe in a log and on a screen.

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** The provider is not configured. Names the missing variable, never a value. */
export class LlmConfigurationError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

/** The upstream call failed. */
export class LlmRequestError extends LlmError {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "LlmRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

/** The model — and any server-side fallback — declined the request. */
export class LlmRefusalError extends LlmError {
  readonly category: string | null;
  constructor(category: string | null) {
    super(
      `The model declined this request${category ? ` (category: ${category})` : ""}. Rephrase it, or ask the committee.`,
    );
    this.name = "LlmRefusalError";
    this.category = category;
  }
}

/** The response hit the output limit and would be shown half-finished. */
export class LlmTruncatedError extends LlmError {
  constructor() {
    super("The response was cut off at the output limit.");
    this.name = "LlmTruncatedError";
  }
}

/** The model's output failed validation twice. */
export class LlmOutputError extends LlmError {
  readonly issues: string;
  constructor(issues: string) {
    super(`The model's response could not be used: ${issues}`);
    this.name = "LlmOutputError";
    this.issues = issues;
  }
}
