# 0003 — Trigram recall plus LLM re-rank; pgvector deferred

**Status:** accepted (phase 0; implemented phase 5)

## Decision

Registry duplicate detection ("has another program already tried this?") runs
in two stages behind `lib/search/similar.ts`:

1. **Recall** — PostgreSQL `pg_trgm` similarity over project title and problem
   statement, with GIN indexes, returning roughly the top 15 candidates.
2. **Re-rank** — one LLM call over those candidates that returns, for each
   plausible match, the reason it matches.

## Why

The brief asks for semantic search at intake, and separately says to defer
embeddings for Ask until the corpus outgrows the context window. Resolving the
two: trigram recall plus a single re-rank gets the behaviour that matters — a
Surgery resident sees that Internal Medicine tried this in 2024 — without
standing up an embedding pipeline, a vector column, and a re-index job in phase
5.

Recall does not have to be excellent, because the re-rank step supplies the
judgement and the *reason*, which is the part a trainee actually needs. A list
of similar titles without reasons is not cross-cohort learning.

## Rejected

- **pgvector from day one.** Requires an extension a managed Postgres may not
  grant, an embedding provider (which the enclave may not reach), and a
  re-embedding path whenever a problem statement is edited. Real cost, for
  better recall over a registry that will hold tens of projects, not thousands.
- **LLM-only search over the whole registry.** Cost and latency grow with the
  registry, and it cannot use an index.
- **Plain keyword search.** Misses the paraphrase, which is the entire point.

## Consequence

`pg_trgm` must be creatable on the production database. This is on the IT
checklist in `docs/DEPLOY.md`, because a managed instance may not grant it.

## Revisit when

The registry passes a few hundred projects, or recall is visibly missing
paraphrased duplicates. The swap is one file: `lib/search/similar.ts` keeps its
signature and gains a vector column behind it.
