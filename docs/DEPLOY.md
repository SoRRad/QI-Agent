# Deployment

Two supported paths. Neither uses a hosting-provider-specific runtime API, so
the same code runs in both.

- **Vercel plus hosted Postgres** — the near-term path for a pilot.
- **Self-hosted Docker** — the path for running inside the hospital network,
  with no modification to the application.

The page ends with a checklist of assumptions to confirm with institutional IT.

## Path A — Vercel plus hosted Postgres

1. Provision Postgres 15 or later. Note the pooled connection string.
2. Import the repository into Vercel.
3. Set the environment variables from `.env.example`. At minimum:
   `DATABASE_URL`, `LLM_PROVIDER`, `JOB_SECRET`, and either `APP_PASSCODE` or a
   configured SSO provider.
4. Apply migrations against the production database:
   `DATABASE_URL=... pnpm db:deploy`
5. Deploy.
6. Confirm `GET /api/health` returns `ok: true` with `migrations.pending`
   empty.

### Scheduled job

The nightly stall-detection job is a protected route, not a platform-specific
cron handler (see `docs/ADR/0001-scheduled-jobs.md`). Add to `vercel.json`:

```json
{
  "crons": [{ "path": "/api/jobs/stall", "schedule": "0 2 * * *" }]
}
```

Vercel's cron invocation must carry the shared secret; configure it as a header
or accept the platform's cron authentication header, whichever the project
prefers. The job logic is a plain exported function with its own unit tests, so
it does not depend on being reached over HTTP.

### Do not

- Do not enable a Vercel-only image, KV or edge-runtime feature. The
  self-hosted path must stay a drop-in.
- Do not put the database behind a connection limit lower than the function
  concurrency without a pooler; Prisma opens a pool per instance.

## Path B — self-hosted Docker

```bash
cp .env.example .env            # set JOB_SECRET and POSTGRES_PASSWORD at minimum
docker compose up --build       # migrations run automatically before the app starts
docker compose --profile seed run --rm seed    # optional demo data
```

The app is published on `${APP_PORT:-3000}`. Postgres is deliberately **not**
published to the host: it is reachable only from the compose network.

### What the image does and does not do

- The base image is a build argument. Substitute a mandated internal base:
  `docker compose build --build-arg NODE_IMAGE=registry.hospital.internal/node:22-slim`
- The package registry is a build argument too:
  `--build-arg NPM_REGISTRY=https://registry.hospital.internal/npm/`
- Dependencies install with `--ignore-scripts`, so **no postinstall hook
  downloads a binary** — no Prisma engine fetch, no browser download, no font
  fetch from a vendor CDN. Fonts are vendored in the repository.
- There is no `# syntax=` directive, because that would make every build pull
  a frontend image from Docker Hub — which fails in exactly the
  network-restricted environment this image is for.
- Next runs in `standalone` mode under plain `node server.js`, as an
  unprivileged user, with a healthcheck against `/api/health`.

**The build host must be able to reach a package registry** (the public one or
an internal mirror) and pull the base image. That is the only external
dependency of the build. If the build host is fully air-gapped, build the image
on a connected host and transfer it with `docker save` / `docker load`.

### Scheduled job

The compose file includes a small `cron` service that posts to
`/api/jobs/stall` once a day with the shared secret. Replace it with the
institution's own scheduler if there is one; the route is the contract.

### Upgrading

```bash
docker compose pull            # if using a published image
docker compose up --build -d   # migrate runs before app on every start
```

Migrations are forward-only. `prisma migrate deploy` never resets data.

## Backups

The database is the entire state of the system; the application holds nothing
on disk that matters. Two specific things make backups more important than
usual:

- The audit log cannot be reconstructed. It is append-only by design and there
  is no second copy.
- Project records are permanent by design. Losing them destroys the
  cross-cohort learning the registry exists to provide.

Back up the `db-data` volume, or use the hosted provider's point-in-time
recovery. Verify a restore before the system carries real projects.

## Observability

`GET /api/health` reports database reachability, applied and pending migration
counts, and the active LLM provider **name**. It never returns a key or any
fragment of one — no prefix, no length, no masked form. It is safe to expose to
a monitoring system.

---

# Confirm with institutional IT

Everything below is an assumption made in the absence of an answer. Each one is
a question, not a statement. Take this section into the meeting.

## Database

- [ ] **Postgres 15 or later is available.** Which version, and who operates
      it — a managed service, or a team inside the institution?
- [ ] **The `pg_trgm` extension can be enabled.** Registry duplicate detection
      uses it. Creating an extension may require elevated privileges that a
      managed instance does not grant to the application role.
- [ ] Backup and point-in-time recovery: who owns it, and what is the tested
      restore procedure?
- [ ] Is there a mandated encryption-at-rest configuration?

## Network

- [ ] **Assumed: the production enclave has no outbound HTTPS to a public LLM
      endpoint.** Is that correct? If outbound access to a named endpoint can
      be allowed, which endpoint, and through what egress control?
- [ ] If not, is there an internal LLM gateway? What is its base URL, its
      authentication scheme, and its API shape — Azure OpenAI, or
      OpenAI-compatible?
- [ ] If a gateway is used: does it speak the chat-completions wire format, and
      does it expect `max_tokens` or `max_completion_tokens`? Set
      `LLM_MAX_TOKENS_PARAM` accordingly. Verify with `pnpm smoke:llm` before
      deployment — it makes one call, prints provider, model and latency, and
      never prints a key.
- [ ] If Anthropic's API is used directly: are server-side refusal fallbacks
      acceptable (a declined request is re-run on another Claude model within
      the same call)? They are on by default; `ANTHROPIC_FALLBACKS=off`
      disables them.
- [ ] Is TLS interception in force on egress? If so, the container needs the
      institution's CA bundle mounted.
- [ ] What is the inbound route to the application — reverse proxy, load
      balancer, or ingress? Who terminates TLS?

## Container platform

- [ ] **Is a specific base image mandated?** The Dockerfile takes it as a build
      argument; we need the registry path and the tag policy.
- [ ] Is there an internal package registry mirror to build against?
- [ ] Is there an image scanning gate, and what severity threshold blocks a
      deployment?
- [ ] Must the container run as a specific non-root UID? It currently runs as
      UID 1001.
- [ ] Is Docker Compose acceptable, or must this run on the institution's
      Kubernetes or OpenShift platform? A manifest set can be supplied.

## Identity

- [ ] SAML 2.0 or OIDC — see `docs/SSO.md` for the specific values needed.
- [ ] Until SSO exists, is a single shared passcode acceptable for a pilot?
      Note the audit-attribution consequence documented in `docs/SECURITY.md`.

## Mail

- [ ] Is there an internal SMTP relay for application mail? Host, port,
      authentication, and the permitted `From` domain.
- [ ] Until one is configured, the system runs with `MAIL_PROVIDER=log`: it
      renders and records messages, and sends nothing. Is that acceptable for
      the pilot?

## PHI scanner

- [ ] Who may edit `config/phi-patterns.json` in production, and through what
      change process? The file is read at runtime so patterns can be added
      without a deploy; mount it as a volume and restrict who can write it.
- [ ] Confirm the one addition to the approved block tier, described in
      `docs/SECURITY.md`: an identifier keyword immediately followed by a
      separated number (`DOB: 03/14/1962`, `MRN 12-345-678`).

## Privacy and approval

- [ ] Who approves this system for use, and what documentation do they need?
- [ ] Confirm the retention open items in `docs/SECURITY.md`: pulse free text,
      named pulse responses, and the audit log.
- [ ] Confirm that the explicit exclusion of safety event narrative capture is
      understood and that trainees will be directed to the approved reporting
      system instead.
