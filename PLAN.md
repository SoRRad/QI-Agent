# QI Agent — Build Plan

Status: **awaiting confirmation before Phase 0.**

This plan restates the build brief as an executable sequence with explicit exit
criteria, records the decisions I intend to make, and lists the questions that
need your answer. Nothing in `/app`, `/lib`, or `/prisma` has been written yet.

---

## 0. Environment findings

Checked before planning, because two of them change the plan:

| Finding | Consequence |
|---|---|
| Repository is empty — no commits, no remote refs | Everything is greenfield. Phase 0 scaffolds from zero. |
| `qi-companion.jsx` is **not present** | The seven seed library documents have no source. See Q1. |
| Postgres 16 server binaries + `psql` present | Migrations, seed, and DB-backed tests are verifiable in this environment. Phase 0 exit criteria can include a real migration. |
| Docker present | `Dockerfile` / `docker-compose.yml` can be built and smoke-started, not just written. |
| No `ANTHROPIC_API_KEY`, no `DATABASE_URL` | All LLM work is built and tested against the `mock` provider. `anthropic` and `azure-openai` adapters ship complete but exercised only by contract tests with a stubbed transport. |
| Node 22.22, pnpm 10.33 | Matches the stack. Next 15 / React 19 / Prisma 6 are the versions I'll pin. |

### Palette contrast, verified

I computed WCAG ratios for the §7 palette rather than assuming them:

```
ink      on paper   14.05:1  AAA
primary  on paper    9.71:1  AAA
signal   on paper    5.92:1  AA
confirm  on paper    5.51:1  AA
muted    on paper    4.68:1  AA   ← tightest passing pair
white    on primary  11.05:1 AAA
white    on signal    6.73:1  AA
white    on confirm   6.26:1  AA
muted    on grid      4.01:1  FAILS AA for normal text
grid     on paper     1.17:1  (intentional hairline)
```

Two rules fall out of this and go into the design system as lint-able tokens:

1. `muted` is for body-adjacent text on `paper` only. It is never placed on a
   `grid`-filled surface (4.01:1), so grid fills get `ink` text.
2. `grid` at 1.17:1 is deliberately near-invisible. It is decoration and
   structure, never a carrier of meaning — no data encoded in gridlines alone.

The palette as specified is AA-clean. No changes requested.

---

## 1. How the two hardest constraints get *enforced*

Constraints 1 and 2 are the ones that fail quietly if left to discipline. Each
gets a mechanism and a test, not a convention.

### Constraint 1 — the LLM never produces a number that appears in a chart

Three layers:

1. **Input shape.** Chart-interpretation prompts never receive a data array.
   They receive the already-computed `SpcAnalysis` object produced by
   `lib/spc` — center line, limits, and violations that already carry
   `plainLanguage` strings generated in TypeScript.
2. **Output guard.** `lib/llm/guards/numeric.ts` extracts every numeric token
   from the model's interpretation and rejects the response if a token is not
   present in the computed analysis it was given. Wrong numbers cannot reach
   the UI; they surface as a retry, then a plain "interpretation unavailable".
3. **Test.** A unit test feeds the guard a deliberately hallucinated
   interpretation and asserts rejection.

This means the numbers on a chart and the numbers in its narration are the same
objects, by construction.

### Constraint 2 — Ask never answers policy from general knowledge

1. `completeJSON` with a schema requiring `citations: string[]`, and
   `answered: false` + `gap: string` as the only alternative shape.
2. **Citation validation:** every cited title must appear in the retrieved
   document set. A citation to a document that wasn't retrieved is treated as
   ungrounded — the answer is discarded and the "not covered" path runs.
3. Ungrounded questions write a `KnowledgeGap` row, which surfaces on the chair
   dashboard as the queue of documents the institution still owes.
4. **Test.** With a library seeded to contain nothing about, say, duty hours, a
   duty-hours question must return "not covered" and create a gap row.

### PHI — middleware, not a helper

The scanner runs as a single write-path chokepoint (`lib/phi/middleware.ts`)
that every free-text mutation routes through, rather than a function each route
remembers to call. The test that matters here is the *negative* one: a route
handler that writes free text without passing through the chokepoint fails a
static check in CI. I'll implement that as a lint rule over the route
handlers plus a Vitest test that enumerates write routes and asserts each is
wrapped.

---

## 2. Build order, with exit criteria

Phase N+1 does not start until N's exit criteria pass. One conventional commit
per phase minimum.

### Phase 0 — Scaffold
Next 15 App Router + TS strict, Tailwind with the §7 tokens, Prisma schema for
every §4 model, initial migration, seed, auth stub, design-system primitives,
`Dockerfile`, `docker-compose.yml`, the five-item nav shell.

**Exit:** `pnpm typecheck` and `pnpm lint` clean; `prisma migrate dev` runs
against a real local Postgres; `pnpm seed` loads §8 data; `docker compose up`
serves the shell; the nav renders 5 destinations at 375px.

### Phase 1 — `lib/spc` (before any chart UI)
Run chart (median center line, 4 rules) and XmR, p, u, c charts with correct
limits including stepped limits for variable subgroup sizes. Western Electric
rules behind a config flag. Structured violation objects.

**Exit:** unit tests against **published worked examples with known answers**
(see Q6 for which references), including at least one variable-subgroup p-chart
and one u-chart. Points-on-median handling tested explicitly: excluded from run
counting, do not break a shift. Coverage on `lib/spc` at 100% of branches —
this is the one module where that's worth the cost.

### Phase 2 — `lib/phi`, `lib/audit`, `lib/llm`
Scanner with config-file patterns, 422 + attest flow, append-only audit,
provider adapter with `mock`, the numeric guard, prompts as named exports.

**Exit:** scanner tests per pattern class plus a false-positive suite (see Q7);
audit table proven append-only at the DB level; `completeJSON` retry-once
tested; numeric guard test; write-path chokepoint test.

### Phase 3 — Library admin + Ask
Whole-document retrieval, citations, "not covered" + `KnowledgeGap`, tutor
mode, devil's advocate. Switchover threshold to chunk retrieval documented in
the README.

**Exit:** grounding tests above; tutor mode asserted never to emit an aim
statement; devil's advocate returns ranked risks each with a mitigation.

### Phase 4 — Charts
SPC studio, chart-type advisor as a pure decision tree, measure library with
chair promotion, operational definition builder with reproducibility check,
data request generator, CSV upload with column mapping, manual entry.

**Exit:** advisor is a tested pure function with zero LLM calls in its path;
definition builder refuses to save when incomplete; charts render and annotate
at 375px; the seeded 24-point series visibly fires its shift.

### Phase 5 — Projects
Intake wizard with five-element aim validation and hard blocks, duplicate
detection, registry filters, workspace tabs, driver diagram (SVG, PNG export),
PDSA with required prediction, handoff packet, stall job.

**Exit:** submission blocked with a *specific* explanation on missing balancing
measure / clinical owner; PDSA cannot be marked done without a prediction;
stall job flips a 43-day-idle active project and notifies; archived projects
still searchable.

### Phase 6 — Pulse and barriers
Survey, chair-composed questions, seeded default instrument, PHI scan on
submit, theming to 3–6 paraphrased themes, barrier lifecycle, digest, response
rate by program.

**Exit:** theming output contains no verbatim substring of any response above a
threshold length (tested); barrier lifecycle transitions validated; digest
generates from closed barriers only.

### Phase 7 — Scholarship
SQUIRE drafter, abstract formatter with word counter, venue matcher from
`/content/venues.json`, IRB pre-check with local-policy citation and explicit
ambiguity flagging.

**Exit:** SQUIRE drafter marks every author-input section and invents no
results (tested against a project with no data points); IRB pre-check cites a
`LibraryDoc` or declares the gap.

### Phase 8 — Committee
Event kits, judging with tie handling, curriculum tracker, milestone mapper,
CLER mock, coach matching, annual report, chair dashboard, library admin.

**Exit:** dashboard opens with the live annotated run chart (not stat cards);
institution measures are run charts, never bar charts; milestone output marked
draft-requiring-PD-review; judging export correct with a seeded tie.

### Phase 9 — Exports, smoke tests, docs
CSV and PDF, Playwright smoke tests for each of the five destinations at
375px, and all of §10.

**Exit:** Playwright green; every doc in §10 present; `docs/PROMPTS.md` covers
every named export in `lib/llm/prompts/`.

---

## 3. Decisions I'm making unless you object

Each becomes a short ADR in `docs/ADR/`.

1. **Scheduled jobs.** The stall job is a protected route (`POST
   /api/jobs/stall`, shared-secret header) invoked by `vercel.json` cron on
   Vercel and by a tiny `ofelia`/cron sidecar in compose. No Vercel-only API,
   per constraint 4, and the job logic itself is a plain exported function with
   unit tests that don't need HTTP.
2. **Duplicate detection without pgvector.** §6.2 wants semantic search, but
   §6.1 says defer embeddings. Resolution: Postgres `pg_trgm` + a normalized
   problem-statement index for candidate recall, then a single LLM re-rank of
   the top ~15 candidates that returns reasons for the match. Behind
   `lib/search/similar.ts` so pgvector is a one-file swap, documented as the
   upgrade path. This keeps Phase 5 free of an embedding pipeline.
3. **PDF generation.** Server-side React → HTML → PDF via a library with no
   headless-Chrome dependency, so self-hosted images stay small and no binary
   download is needed at build time. (If you'd rather have pixel-exact chart
   PDFs, that argues for Playwright's Chromium, which is already in the image —
   tell me and I'll take that path instead.)
4. **`lib/auth`.** The brief shows `lib/auth.ts` in one place and `/lib/auth`
   in the tree. I'll use `lib/auth/index.ts` so the import path is `lib/auth`
   either way.
5. **Aim versioning.** `AimStatement` rows are append-only with a `version`
   integer and the latest read via a view helper, rather than mutate-in-place
   plus a history table. Same for measure operational definitions, since a
   changed definition invalidates chart history and that needs to be visible.
6. **Role visibility.** Default until you say otherwise (Q4): trainees see
   their own program; coaches see projects they coach plus their program;
   chair sees everything. Enforced in one `lib/auth/scope.ts` predicate used by
   every query, not per-route.

---

## 4. Where I think the brief is worth pushing on

Offered as suggestions, not changes — I'll build as specified unless you say so.

1. **The handoff packet is the highest-leverage feature and is under-specified.**
   §6.2 emails it to the incoming owner. Trainee rotation is the single largest
   cause of project death, and an email is a document that gets lost. I'd
   suggest the packet also becomes a durable `Handoff` record with an explicit
   *acceptance* step by the incoming owner — so the registry can show
   "handed off, unaccepted for 14 days" as its own stall signal. Small addition,
   large effect, and it needs no new nav.
2. **"You reported, we changed" deserves to be the Pulse landing view**, not a
   generated digest you have to go find. Response rates are sustained by the
   loop being visible before you're asked to report again. Same components,
   different placement.
3. **The measure library needs a deprecation state, not just promotion.** Once
   programs link to a shared "readmission" definition and the committee changes
   it, every linked chart's history silently changes meaning. I'd add
   `deprecated` + `supersededById` to library measures and surface a banner on
   charts built from a superseded definition. This is the kind of thing that
   destroys trust in the data a year in.
4. **Devil's advocate should run on a schedule, not only at intake review.**
   §6.1 surfaces it automatically at intake. The risks it names — data
   unavailable, owner absent, effect too small — are exactly the ones that
   become true *later*. Re-running it when a project goes `stalled` and
   attaching the output to the stall notification costs nothing extra.
5. **A "numbers provenance" affordance.** Since constraint 1 is the system's
   central claim, I'd make it visible: every computed value in a chart view can
   show which pure function produced it. It's a small UI detail that makes the
   guarantee legible to a skeptical program director, which is who has to trust
   this.
6. **Consider seeding one deliberately bad demo project.** §8 seeds three
   projects at different lifecycle stages. A fourth with a vague aim, no
   balancing measure, and an absent owner makes the intake blocks, the aim
   critique rubric, and devil's advocate demonstrable in 30 seconds. Demo
   quality drives adoption for a tool like this.

---

## 5. Open questions — I need answers to 1, 2, 3, and 6 before Phase 0

**Q1 — `qi-companion.jsx` is not in this repository.** §8 says to port seven
library documents from it. Can you paste the file or the documents? Otherwise I
will draft the four non-local documents (aim statement standard, measure types,
run chart rules, PDSA discipline, SQUIRE outline) from the public standards
they're based on, and create the three `isLocal` ones as clearly-flagged
placeholders that state what institutional content is required. That's the
plan if you don't have the file — I just don't want to quietly substitute my own
content for yours.

**Q2 — LLM credentials.** No `ANTHROPIC_API_KEY` in this environment. I'll
build everything against `mock` and ship the `anthropic` adapter tested against
a stubbed transport. Confirm that's fine, or supply a key if you want a live
end-to-end pass before Phase 9.

**Q3 — Email.** §6.2 emails the handoff packet; §6.4 implies a digest reaches
trainees. No provider is specified, and a hospital-firewalled deployment
usually means internal SMTP. Proposal: `lib/mail` adapter with `smtp`,
`resend`, and `log` providers, defaulting to `log` (renders the packet, records
it, sends nothing) so nothing accidentally emails from a demo. Confirm, or name
the provider.

**Q4 — Data isolation between programs.** My default is in §3.6 above. But this
is a governance question, not a technical one: should a coach in Internal
Medicine be able to read a Surgery project's problem statement and data? The
cross-cohort learning goal in §6.2 argues for openness; program politics often
argue the other way. Tell me and I'll enforce it in one place.

**Q5 — Who may attest past a PHI flag?** §3 says "the user may... attest".
Any user, or coach/chair only? And once attested: do we store the original text
or the redacted form? I'd store the original (the attestation says it's not
PHI) with the flags recorded in the audit log — but if your compliance posture
is "flagged text never lands raw", that's a different implementation and worth
knowing now.

**Q6 — Which published SPC references should the tests cite?** Phase 1's exit
criteria depend on worked examples with known answers, and the "too few / too
many runs" table must come from a specific published source rather than my
reconstruction. My intent is the runs table and run-chart rules as published in
Perla, Provost & Murray (2011) and *The Health Care Data Guide*, with control
chart examples from Montgomery or Wheeler. If your committee has a house
reference it cites in its own teaching, I'd rather the tests match that
document exactly — the numbers should agree with what you teach.

**Q7 — PHI scanner false-positive tolerance.** The §3 patterns will flag
ordinary QI text: "6+ digits" hits sample sizes and MRN-free accession-like
figures, "dates in any format" hits every baseline period ("Jan 2025 – Jun
2025"), and capitalized-pairs-after-Dr. hits coach names in a handoff packet.
That last one is a design tension worth naming: `Handoff` legitimately contains
a coach's name. If every write is noisy, users learn to click "attest"
reflexively and the control is worse than none. Proposal: keep all patterns,
but tier them — `block` (SSN, phone, MRN-keyword-adjacent digits) versus
`warn` (bare dates, capitalized pairs) — with only `block` returning 422 and
`warn` requiring acknowledgement. Attestation is recorded either way. Confirm
the tiering, or tell me to make everything blocking.

**Q8 — Western Electric rules default.** §6.3 says configurable. On or off by
default for a new chart? I'd default them **off**, since applying all of them
alongside the run chart rules inflates false signals on the short series
trainee projects actually produce.

**Q9 — Deploy target reality.** Anything I should know about the actual
hospital environment — Postgres version available, whether outbound HTTPS to an
LLM endpoint is permitted at all, whether the image must be built from a
specific base? This affects the `Dockerfile` more than anything else.

---

## 6. What I will not build

Restating so it's on the record: no safety-event narrative capture (§11), no
sixth nav item, no component library, no general graph editor, no LLM-computed
numbers, no general-knowledge fallback in Ask.

---

**Please confirm this plan, or answer the questions above, and I'll start
Phase 0.**
