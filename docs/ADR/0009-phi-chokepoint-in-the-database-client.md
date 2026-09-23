# 0009 — The PHI guard runs inside the database client

**Status:** accepted (phase 2)

## Decision

The PHI scanner runs as a Prisma query extension on every model's write
operations, attached in `lib/db.ts` — the only place application code may
construct a database client. A static test fails the build if anything else
constructs a client, imports the client class as a value, or writes with raw
SQL.

Warn-tier acknowledgements and the current user reach the extension through a
request context (`AsyncLocalStorage`), not through function arguments.

## Why

The brief requires a scanner that runs "as middleware on every free-text
write", and the plan promised "a single write-path chokepoint rather than a
function each route remembers to call". The alternatives each depend on
someone remembering:

- A helper each route calls is skipped by the route written in a hurry.
- Next.js edge middleware cannot reliably read request bodies, and a server
  action is not an HTTP route at all.
- A wrapper around route handlers misses server actions, jobs and scripts.

The database client is the one thing every write passes through, including
nested relation writes, transactions, jobs and the seed. Putting the guard
there means the guarantee is structural. The static test covers the remaining
escape hatches.

## Consequences

- **Lazy queries.** Prisma query promises execute on `.then()`. A caller that
  hands an un-awaited query out of the request context would run it outside
  that context, where acknowledgements are invisible. `runWithContext` awaits
  inside the context whatever the caller passes, and a regression test covers
  it. The failure mode was closed — the guard re-asked — but it made a
  naturally-written route unable to proceed.
- **Audit survives rollback.** A refused write rolls back its transaction. The
  audit record that it was refused is written through the unextended client on
  its own connection, so it persists. Tested.
- **Field exemptions are keyed by name**, because Prisma 7 does not expose the
  data model publicly for resolving nested relation targets. A test parses the
  schema and fails if an exempt field name appears on an unlisted model.
- **The seed goes through it too**, in a trusted context that lets warn-tier
  flags pass but not block-tier ones. Every seed run proves the demo data
  contains no identifiers.

## Rejected

- **Scanning in route handlers.** Not a chokepoint.
- **Database triggers.** Could block, but could not implement acknowledgement,
  could not return offsets to highlight, and would put regular expressions the
  committee maintains inside the database.
- **Redacting instead of refusing.** Q5: text that tripped a block is never
  stored, not even redacted.

## Revisit when

Prisma exposes its data model publicly, at which point exemptions can be keyed
by `Model.field` instead of field name.
