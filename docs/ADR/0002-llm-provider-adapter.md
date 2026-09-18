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

## Guard against fabricated numbers

Chart-interpretation prompts receive the computed `SpcAnalysis` object, never a
raw data array. A numeric guard extracts every numeric token from the model's
output and rejects the response if a token is not present in the analysis it
was given. This is the enforcement behind the brief's first constraint; the
alternative — trusting the prompt — is not enforcement.

## Rejected

- **A vendor SDK called directly from feature code.** Would make an endpoint
  change a repository-wide edit.
- **A third-party LLM abstraction library.** Another dependency to audit, in
  exchange for abstracting two HTTP shapes we can write ourselves.

## Revisit when

Streaming responses are needed in the interface, or a provider requires
tool-calling. Both extend the interface rather than replacing it.
