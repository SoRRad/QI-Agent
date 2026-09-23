# Security and data handling

This page is written to be read by the committee, by the institution's privacy
office, and by whoever is asked to approve this system. It states what the
system does, and — just as importantly — what it is not approved for.

## What this system is explicitly not approved for

**Safety event reporting.** QI Agent does not capture safety event narratives,
and that omission is deliberate rather than pending. Safety event reporting
requires an approved institutional system with its own legal protections,
review workflow and retention rules. Trainees must be directed to that system.
If someone asks for this feature, the answer is a link to the institutional
reporting tool, not a new text field here.

**It is not a clinical system.** It holds no patient records, supports no
clinical decision, and must not be relied on for any patient-level action.

**It is not a source of truth for institutional policy.** Three library
documents ship as placeholders (IRB / QI determination, project intake
requirements, and the committee charter). Until the institution replaces them,
Ask reports questions on those topics as not covered rather than answering, and
any answer citing one carries a visible banner.

## Protected health information

**The stance: PHI does not enter the database.** Not redacted, not encrypted,
not quarantined. It does not arrive.

### Where the scanner runs

Inside the database client itself. The scanner is a Prisma query extension on
every model's write operations (`lib/phi/extension.ts`), attached in the one
place a database client is constructed (`lib/db.ts`). A route handler cannot
forget to call it, because a route handler has no other way to reach the
database.

That is only a guarantee if nothing can get an unguarded client, so a test
(`tests/phi/chokepoint.test.ts`) fails the build if any application code:

- constructs its own database client,
- imports the client class as a value, or
- writes with raw SQL, which would bypass the extension.

The scanner walks **every** string in a write — top-level fields, nested
relation writes, updates, array elements, JSON — and scans it. The default is
to scan: a field added to the schema later is covered without anyone
remembering to register it. Only identifiers (record ids, foreign keys, email,
slug) are skipped.

It is not a client-side convenience and cannot be bypassed by calling the API
directly. The demo seed writes through the same guarded client; a seed run that
completes is proof that the demo data contains no block-tier content.

Free text sent **to a language model** is scanned the same way before it is
sent: an external model endpoint is not a safer place for an identifier than a
database. An Ask question is scanned as the knowledge-gap record it may become,
so one acknowledgement covers both the model call and the stored copy of the
same words; it cannot cover different words. Everything a trainee types to the
tutor is rescanned on every turn, because the conversation history comes back
from the browser and is not trusted.

**What Ask keeps.** Ask answers and tutor conversations are not stored. What is
stored is a question the library could not answer (or could answer only from a
placeholder), in the knowledge-gap queue the chair reviews, and a count of
usage.

### Two tiers

**Block tier — no acknowledgement path exists.** The write is refused and the
user must edit the text. There is deliberately no override button, because a
trainee-facing button that overrides a hard PHI control becomes, within a
month, the button everyone clicks. Blocked, per the approved tiering (Q7):

- Social Security Number shapes
- Telephone number shapes (with separators, so a list of counts is not one)
- Any digit string of 9 or more
- Any digit string of 6 or more within 30 characters of `MRN`, `DOB`, `acct`,
  `account`, `accession` or `record`

**Plus one addition, for the committee to confirm.** As written, the tiering
lets `DOB: 03/14/1962` and `MRN 12-345-678` through as warn-only, because
neither contains an unbroken run of six digits. Both are unambiguous
identifiers, so a fifth block rule catches a strongly identifying keyword —
`MRN`, `DOB`, `acct`, `accession`, `record number`, `account #` —
**immediately** followed by a number of six or more digits with separators.
The plain words "record" and "account" are excluded unless followed by
"number", "no." or "#", so that "the health record 2025-2026 upgrade" stays
ordinary prose. This rule is in the false-positive suite like the others.

**Warn tier — any user may acknowledge and proceed.** The acknowledgement and
the specific flags are written to the audit log. Warned:

- Bare digit strings of 6 to 8
- Dates that carry a **day**, in any format: `03/14/2025`, `2025-03-14`,
  `14 March 2025`, `March 14`. A **month and year alone** — "Jan 2025 –
  Jun 2025", "July 2025", "Q3 FY2026" — describes a measurement period, not an
  event in a person's care, and is not flagged. That is what lets "baseline Jan
  2025 – Jun 2025, n = 412" pass clean, as the approved false-positive suite
  requires.
- `room` or `bed` followed by digits ("bed 14"; not "32-bed ward")
- Capitalised two-word sequences following `patient`, `Mr.`, `Mrs.`, `Ms.` or
  `Dr.` (the full stop is optional, since "Mr Smith" is common outside the
  US). After "patient", a committee-maintained stop list suppresses ordinary
  phrases: "the Patient Safety Committee" is not a name.

### What the audit log records

For a block: that it occurred, the user, the model and field, the rule and the
character offsets. For an acknowledgement: the same, plus the record it was
attached to. **Never the offending string** — not in the audit log, not in the
error returned to the browser, not in a server log. Text that trips a block is
never written to any table, including the audit table.

The record of a block is written on its own connection, outside any enclosing
transaction, so that it survives the rollback of the write it refused. This is
tested.

Acknowledgement works by fingerprint: the 422 response lists each warn-tier
flag with an opaque fingerprint, and the resubmission lists the fingerprints
the user confirmed. A fingerprint changes if the flagged text changes, so an
acknowledgement cannot be carried over to different text. Fingerprints are
never stored: a hash of a short date is trivially reversible by brute force.

The audit table and the usage table themselves are scanned at block tier only.
They are written by the system from content that has already passed the guard;
asking for acknowledgement on an audit write would make no sense, but no code
path can smuggle an identifier into the audit log either.

### Fields exempt from particular patterns

Exemptions switch off one **category** of pattern for a field that
legitimately contains it. Block-tier identifier and contact rules can never be
exempted: an SSN in the "clinical owner" field is still an SSN.

**Exempt from name patterns** — structured staff-name fields. Named in the
approved tiering: clinical owner, coach, sponsor, analyst contact, judge, and
the handoff from/to fields (the latter two are user links, not text).
Added because they are name fields by nature, listed here so the committee can
object: program and user names and measure names (`name`), program director
(`pdName`), the optional pulse respondent name (`respondentName`), symposium
`presenters`, the data `puller`, and the sustainability plan's `changeOwner`
and `reviewer`.

**Exempt from date patterns** — the aim statement's `text` and
`baselinePeriod`. The aim statement standard *requires* a calendar deadline and
a baseline period, so without this exemption every valid aim would raise a
warning, and a warning that fires on every aim teaches people to click through
warnings. A date of birth after "DOB" in an aim is still blocked. Also the
handoff packet's generated `summary` (phase 5): it quotes the current aim, and
its author did not write it.

Exemptions are keyed by model *and* field: `AimStatement.text` is exempt,
`DriverNode.text` is not. (Until phase 5 they were keyed by field name alone,
with a test forbidding any other model from reusing an exempt name; the driver
diagram's `text` field tripped that test, and scoping by model replaced the
rule.) A test still parses the schema and fails if an exemption names a field
that no longer exists.

### Extending the patterns without a deploy

`config/phi-patterns.json` is read at runtime and re-read when it changes. The
committee can add block or warn patterns and stop words there. It cannot remove
or weaken the built-in rules, which live in code: a malformed, empty or deleted
file leaves the approved control fully in force, and `/api/health` reports
whether the file loaded. Patterns with nested quantifiers — the shape that can
hang a server on crafted input — are rejected.

### Why the tiering is shaped this way

The block tier has no override, so a block-tier false positive stops a trainee
cold. The warn tier is advisory, but a warning that fires on ordinary prose
trains users to dismiss it. A false-positive suite of 29 realistic QI
sentences — rates, counts, periods, "the Patient Safety Committee", "accession
volumes exceeded 250,000" — must pass with **zero** flags in either tier. If
that suite goes noisy, the tiering is wrong and gets fixed rather than
loosened.

## Read visibility

The boundary is drawn by **sensitivity of the field**, not by program. Cross-
cohort learning is the point of the registry: a Surgery resident must be able
to see that Internal Medicine tried this in 2024 and why it ended. What stays
inside a program is the material that makes people guarded about recording it
honestly.

It is one configuration object — `SENSITIVITY_POLICY` in
`lib/auth/scope.ts` — so the committee can move the boundary without a code
change. The tests in `tests/auth/scope.test.ts` are written as a specification
of this table: if one of them changes, the committee has changed its mind, and
this page changes with it.

### Readable across all programs

Project title, problem statement, aim statement, measure definitions, status,
outcome, sustainability plan, and archived project records — including, from
phase 5, what a project achieved and why it ended (`outcomeSummary`,
`endReason`), which duplicate detection shows to every later team on the same
problem, and who leads and coaches it. Barrier themes,
their paraphrased summaries, decisions and what changed. The library. Events.

### Restricted to the owning program, the assigned coach, and the chair

Data points, PDSA cycle contents, handoff packets, milestone maps,
symposium submissions, and any free text a trainee wrote about obstacles. The
project's clinical owner, sponsor and analyst contact. From phase 5: the driver
diagram, the equity stratification plan, and why the stall job flagged a
project. (The equity plan was previously unlisted, so chair-only by default;
making it readable by its own program was a deliberate choice, recorded here
for the committee to review.)

An assigned coach reads a project's restricted material wherever they sit; a
coach with no assignment to it does not, even in the same program.

### Chair only

Named pulse responses, the raw barrier text behind a theme, judge scores,
curriculum records, usage instrumentation, and the audit log.

### Default deny

Any model or field not named in the policy is treated as chair-only. A model
added later without a policy entry cannot leak by omission, and a test asserts
this.

## Audit logging

The audit table is **append-only at the database level**, enforced by triggers
that raise on `UPDATE` and `DELETE` (migration `hard_guarantees`). It is not
application discipline: application code gets refactored, a trigger does not
quietly stop applying. Tests in `tests/db/guarantees.test.ts` assert the
triggers fire, so a future migration cannot drop one and leave the guarantee
documented but absent.

Recorded: authentication sessions, every LLM call (user, feature, provider,
model, token counts, latency — **never prompt bodies or model output**), PHI
blocks and warn acknowledgements, library document changes, project status
transitions, aim and definition versions, PDSA completions, handoff generation
and acceptance, mail sent or logged, barrier status changes, exports, and job
runs.

## Append-only historical records

Aim statements and measure operational definitions are append-only, enforced
by triggers. An older aim explains what a chart meant at the time it was
plotted; editing one silently rewrites the past. Corrections are made by
inserting the next version.

Measure definitions permit exactly one post-insert mutation: recording that the
user confirmed the plain-language restatement matches their intent. Nothing
that changes a definition's meaning can be updated.

A superseded library measure is never edited in place. Charts built on it carry
a banner naming the change and its date, because silently changing the meaning
of a shared definition is how an institution loses the ability to compare
anything.

## Authentication

Until SSO is configured, production gates the whole application behind a single
shared passcode (`APP_PASSCODE`) set as an httpOnly cookie. This is an interim
posture, not a target state: a shared passcode gives no individual attribution,
which weakens the audit log to the point where it identifies a session rather
than a person. See `docs/SSO.md` for what the identity team must supply to
replace it.

The development role switcher is disabled outright in production.

## Data retention

No automated deletion is implemented, and that is a decision the institution
must make rather than one this system should assume. Two things constrain it:

- Project records are permanent by design. Archived projects stay searchable
  forever, and a program cannot be deleted out from under a project — the
  registry's value is precisely that it outlives the cohort.
- The audit log cannot be deleted through the application at all. Removing
  audit rows requires direct database access by a privileged operator, which
  is the intended friction.

**Open items for the institution:** the retention period for pulse responses
containing free text, whether named pulse responses should be pruned after the
follow-up they were collected for, and the retention period for the audit log.
These belong in the committee charter.

## Reporting a problem

Security concerns about this system go to the committee chair and the
institution's information security office. Do not open a public issue.
