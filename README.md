# QI Agent

A web platform for an institution-wide Graduate Medical Education quality
improvement committee. Its users are resident and fellow physicians, faculty QI
coaches, and the committee chair.

Two claims sit at the centre of the design, and both are enforced rather than
promised:

1. **No number in a chart comes from a language model.** Every median, control
   limit, run count and percentage is computed in deterministic TypeScript with
   unit tests written against published worked examples. A model may interpret
   a chart; a guard rejects any model output containing a numeric token that is
   not in the computed analysis it was given.
2. **Ask answers only from the institutional library.** Citations are validated
   against the retrieved document set, and a question the library does not
   cover produces a "not covered" answer naming the document that should be
   written — never an answer from general knowledge.

## Status

Phases 0 to 2 of 9 are complete.

**Phase 0** — scaffold, data model, migrations, seed, the auth seam, the design
system, the five-destination shell, Docker, and the health endpoint.

**Phase 1** — `lib/spc`, the statistical engine, built before any chart UI
exists. Every rule and limit, its published source and its test case are listed
in `docs/VALIDATION.md`.

**Phase 2** — the PHI scanner, running inside the database client so no write
can bypass it; the LLM adapter with four providers (mock by default); and the
numeric guard, under which a model may not write a number at all.

See `PLAN.md` for the build order and the exit criteria for each phase.
Destination pages carry a dated note naming the phase that builds the feature
behind them, so a demo never implies something works when it does not.

## Local setup

Requires Node 20.9+, pnpm 10, and PostgreSQL 15 or later.

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL
pnpm db:migrate               # create the schema
pnpm db:seed                  # load the demo data
pnpm dev
```

The seed prints the addresses it created. In development the current user is
resolved from `DEV_USER_EMAIL`, or switched with the role switcher in the
masthead; `chair@example.edu` sees everything.

### Verifying

```bash
pnpm verify    # typecheck, lint, unit tests, production build
pnpm e2e       # Playwright smoke tests with axe, at 375px and 1280px
```

`pnpm verify` is the exit gate for every phase. No phase closes on a partial
pass. The database-level guarantee tests skip themselves when `DATABASE_URL` is
unset, so the unit suite runs on a machine with no Postgres — CI must set one.

Where a sandbox or CI image ships its own Chromium rather than the revision
this Playwright version pins, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to it
instead of downloading a second browser.

## Environment variables

Every variable is documented in `.env.example`. The ones that change behaviour
rather than credentials:

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `mock` (default, no credentials), `anthropic`, `azure-openai`, or `openai-compatible` for an internal gateway. |
| `ANTHROPIC_MODEL` | Defaults to `claude-opus-5`. |
| `ANTHROPIC_FALLBACKS` | `default` (on): a request the model declines is re-run on a fallback model within the same call. `off` disables it. |
| `ANTHROPIC_EFFORT` | Optional cost/depth trade-off, `low` to `max`. Unset uses the API default. |
| `LLM_MAX_TOKENS_PARAM` | `max_tokens` or `max_completion_tokens`, for chat-completions gateways that accept only one. |
| `PHI_PATTERNS_PATH` | The committee's scanner extensions. Defaults to `config/phi-patterns.json`, read at runtime. |
| `MAIL_PROVIDER` | `log` (default) records the rendered message to the audit table and sends nothing. A demo must never send mail. |
| `APP_PASSCODE` | Production without SSO: gates the whole app behind one shared passcode. See `docs/SSO.md`. |
| `DEV_USER_EMAIL` | Development identity. |
| `JOB_SECRET` | Shared secret for the protected nightly job route. |

### Adding an LLM key locally

No key is required to develop: every feature is built and tested against the
`mock` provider. To exercise a real provider, set `LLM_PROVIDER` and its
credentials in `.env`, then:

```bash
pnpm smoke:llm     # one call through the adapter; prints provider, model, latency
```

The smoke script reports the provider name and token counts. It never prints a
key or any fragment of one.

## Retrieval: whole documents now, chunks later

Ask puts whole library documents in context rather than running an embedding
pipeline. This is correct while the corpus is small and it keeps citation
validation exact — a cited title either was or was not retrieved.

**Switchover threshold:** move to embedding-based chunk retrieval when the
library exceeds roughly 120,000 tokens of body text, or about 60 documents of
the length of the seeded ones, whichever comes first. At that point whole-corpus
context stops fitting a single request and recall has to be selective. The
seam is `lib/llm` plus the retrieval call in the Ask feature; registry
duplicate detection has its own seam at `lib/search/similar.ts`.

## Layout

```
/app                 Next.js App Router routes and the five destinations
/components          Design system primitives and feature components
/lib
  /llm               Provider adapter: anthropic | azure-openai | openai-compatible | mock
  /auth              getCurrentUser(), requireRole(), and the read-visibility policy
  /spc               Deterministic statistics. Zero LLM. Fully unit tested.
  /phi               PHI scanner and write-path chokepoint
  /audit             Append-only audit logging
  /export            CSV and PDF generation
/prisma              Schema, migrations, seed
/content             Library documents as markdown, and the venue list
/tests               Unit tests, and Playwright specs under tests/e2e
/docs                SSO, deployment, security, prompts, validation, ADRs
```

## Documentation

- `docs/SSO.md` — exactly what the institution's identity team must supply.
- `docs/DEPLOY.md` — the Vercel path, the self-hosted Docker path, and a
  checklist of assumptions to confirm with institutional IT.
- `docs/SECURITY.md` — the PHI stance, the read-visibility boundary, audit
  logging, retention, and what this system is explicitly not approved for.
- `docs/ADR/` — one short record per adapter and architectural choice.
- `docs/VALIDATION.md` — every SPC test case, its published source, and its
  expected value. This is the page that answers a challenge to a chart.
- `docs/PROMPTS.md` — every prompt in plain language, for committee review by
  non-engineers. A test fails if a prompt exists without a section there.

## What this system is not

It is not a route for safety event reporting. That requires an approved
institutional system; see `docs/SECURITY.md`.
