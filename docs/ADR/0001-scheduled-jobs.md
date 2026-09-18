# 0001 — Scheduled jobs run through a protected route

**Status:** accepted (phase 0)

## Decision

Nightly work — stall detection first — is a plain exported function with its
own unit tests, invoked by a protected route (`POST /api/jobs/stall`,
authenticated by a shared secret header). Vercel's cron calls that route via
`vercel.json`; the self-hosted compose file calls it from a small scheduler
service.

## Why

Every external dependency sits behind an adapter, and a hosting provider's
cron is an external dependency. Putting job *logic* in a platform cron handler
would make the self-hosted path a rewrite rather than a configuration change,
and would make the job untestable without HTTP.

Keeping the logic in a function also means the test suite exercises the actual
stall rule — 42 days without a data point or PDSA entry — rather than a route.

## Rejected

- **A platform cron handler containing the logic.** Fails the self-hosted
  requirement.
- **An in-process timer (`setInterval`) in the Next server.** Fires once per
  instance, so it runs N times under horizontal scaling, and not at all if the
  instance is cold.
- **A separate worker container with its own database connection.** More moving
  parts than one committee's stall queue justifies. The route is the seam if we
  ever need it.

## Revisit when

Jobs grow beyond a handful, or one needs to run longer than a request timeout
allows. At that point the route becomes an enqueue and a worker drains a queue —
the job functions themselves do not change.
