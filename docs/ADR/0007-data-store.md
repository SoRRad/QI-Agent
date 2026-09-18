# 0007 — Prisma with an explicit driver adapter

**Status:** accepted (phase 0)

## Decision

PostgreSQL through Prisma 7, using the `prisma-client` generator and an
explicit `PrismaPg` driver adapter constructed in one place (`lib/db.ts`). All
schema change goes through migrations in `prisma/migrations`, including the
hand-written SQL that installs the triggers, check constraints and trigram
indexes.

## Why

The data store is one of the three adapters the brief requires, and the
connection story needs to be one file for the self-hosted path — the adapter is
where a connection pool, a CA bundle for an intercepting proxy, or a pooler URL
would be configured.

Prisma 7's driver adapter model helps here: there is no engine binary to
download at image build time, which is one of the constraints on the
Dockerfile.

Writing the guarantees as raw SQL inside Prisma migrations rather than as
application code is deliberate — see ADR-0005.

## Rejected

- **A raw SQL query builder.** More control, but the schema is large and
  relational and the type safety across ~20 models is worth more here than
  query-level control.
- **Prisma 8 (release candidate).** The CLI's `latest` tag currently points at
  an 8.0 release candidate while the client is at 7.10. Pinning both to 7.10
  keeps CLI and client in step; a prerelease is not what an institutional
  system should run.
- **Keeping the generated client in version control.** It is generated on
  install (`postinstall`) and gitignored. Committing generated TypeScript
  invites edits to it.

## Consequence

`DATABASE_URL` must be present whenever a client is constructed, so the
Dockerfile supplies a placeholder at build time — every route is dynamic, so
nothing connects during the build. `pnpm install` runs `prisma generate`, and
CI must do the same before typechecking.

## Revisit when

Read replicas or a connection pooler are needed. Both are configuration inside
`lib/db.ts`.
