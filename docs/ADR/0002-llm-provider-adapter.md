# 0002 — One LLM interface, four providers, mock by default

**Status:** accepted (phase 0; implemented phase 2)

## Decision

All model access goes through `LlmProvider` in `lib/llm`:

```ts
complete(opts): Promise<string>
completeJSON<T>(opts & { schema: ZodSchema<T> }): Promise<T>
```

Four implementations, selected by `LLM_PROVIDER`:

- `mock` — **the default.** No credentials. Every feature is developed and
  tested against it.
- `anthropic`
- `azure-openai`
- `openai-compatible` — an internal gateway at an arbitrary base URL.

`completeJSON` validates against the Zod schema and retries once on parse
failure before throwing. Prompts live in `lib/llm/prompts/` as named exports,
never inline in route handlers, because non-engineers review them. Every call
is logged to the audit table with user, feature, token counts and latency —
never prompt bodies or model output.

## Why

The institution's production enclave is assumed to have **no outbound HTTPS to
a public LLM endpoint**. That makes `azure-openai` and `openai-compatible` the
likely production path rather than a hedge, so all four providers are
first-class from the start instead of one being real and three aspirational.

`mock` being the default is what lets the whole application be built and tested
with no credentials, which is the situation the project is actually in.

The `openai-compatible` provider exists specifically because an internal
gateway's base URL cannot be predicted.

## Implementation notes (phase 2)

- **Anthropic** uses the official `@anthropic-ai/sdk`, with an injected `fetch`
  for the contract tests. `baseURL` and `authToken` are passed explicitly, so
  the SDK never picks up `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` from the
  host environment and sends a credential the app was not configured with.
- **Default model `claude-opus-5`.** No model was specified for this system, so
  the default is the current recommended model rather than a cheaper one chosen
  on the committee's behalf. `ANTHROPIC_MODEL` changes it.
- **Server-side refusal fallbacks on by default** (`fallbacks: "default"`,
  beta `server-side-fallback-2026-07-01`): if the model's safety classifiers
  decline a request, the API re-runs it on a fallback model within the same
  call. The audit records the model that actually served each request.
  `ANTHROPIC_FALLBACKS=off` disables it.
- **Effort** is left at the API default and exposed as `ANTHROPIC_EFFORT`.
  `low` and `medium` are worth measuring for the short grounded tasks this
  system mostly runs; that is a cost decision for the institution.
- **Azure OpenAI and openai-compatible** share one chat-completions driver over
  plain `fetch`, since an institution's gateway may speak only the wire format.
  The token-limit parameter name differs between deployments and is
  configurable (`LLM_MAX_TOKENS_PARAM`).
- A refusal, a content filter and a truncated reply are all errors, checked
  before content is read, so a half-finished answer is never shown.
- `completeJSON` includes the Zod schema as JSON Schema in the system prompt,
  validates, and retries once. Structured outputs were considered and deferred:
  they would make one provider stricter than the other three, and could not be
  verified against a live endpoint from the build environment.

## Guard against fabricated numbers

Stricter than first planned. The original design compared numbers in the
model's output against the computed analysis. The implemented design forbids
the model from writing a number at all — in digits or in words — and has it
refer to values through placeholders (`{{centre_line}}`, `{{v0_points}}`) that
TypeScript fills in from the statistics engine's output.

The brief forbids the model to "compute, round, or restate" a chart number.
Comparison would still let it restate one, and would need rules for rounding
("26.7%" versus "26.75%"). Placeholders remove the question: the narration's
numbers are the chart's numbers because they are the same values.

Anything that could carry a digit — a period label, a measure name such as
"signed >48h", an annotation such as "Cycle 2" — is a placeholder too, so a
compliant reply never needs a digit. A reply containing one is rejected and
retried once; after that the chart is shown with its interpretation marked
unavailable.

## Rejected

- **A vendor SDK called directly from feature code.** Would make an endpoint
  change a repository-wide edit.
- **A third-party LLM abstraction library.** Another dependency to audit, in
  exchange for abstracting two HTTP shapes we can write ourselves.

## Revisit when

Streaming responses are needed in the interface, or a provider requires
tool-calling. Both extend the interface rather than replacing it.
