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

A server-side scanner runs as middleware on every free-text write. It is not a
client-side convenience and cannot be bypassed by calling the API directly.

### Two tiers

**Block tier — no attestation path exists.** The write is refused and the user
must edit the text. There is deliberately no override button, because a
trainee-facing button that overrides a hard PHI control becomes, within a
month, the button everyone clicks. Blocked patterns:

- Social Security Number shapes
- Telephone number shapes
- Any digit string of 9 or more
- Any digit string of 6 or more within 30 characters of `MRN`, `DOB`, `acct`,
  `account`, `accession` or `record`

**Warn tier — any user may acknowledge and proceed.** The acknowledgement and
the specific flags are written to the audit log. Warned patterns:

- Bare digit strings of 6 to 8
- Dates in any format
- `room` or `bed` adjacent to digits
- Capitalised two-word sequences following `patient`, `Mr.`, `Mrs.`, `Ms.` or
  `Dr.`

### What the audit log records about a block

That a block occurred, the flag types, and the user. **Never the offending
string.** Text that trips a block is never written to any table, including the
audit table — storing it to prove it was rejected would defeat the control.

### Fields exempt from name patterns

Structured staff-name fields legitimately hold names and are not scanned for
them: clinical owner, coach, sponsor, analyst contact, judge, and the handoff
from/to fields. Their free-text siblings are scanned normally.

### Why the tiering exists

The patterns in the brief will flag ordinary QI text — "baseline Jan 2025 –
Jun 2025, n = 412" contains both a date range and a number, and a handoff
packet legitimately names a coach. A scanner that cries wolf trains users to
dismiss it, which is worse than no scanner. The block tier is therefore narrow
and absolute; the warn tier is broad and advisory. A false-positive suite of
realistic QI sentences guards the boundary: if that suite goes noisy, the
tiering is wrong and gets fixed rather than loosened.

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
outcome, sustainability plan, and archived project records. Barrier themes,
their paraphrased summaries, decisions and what changed. The library. Events.

### Restricted to the owning program, the assigned coach, and the chair

Data points, PDSA cycle contents, handoff packets, milestone maps,
symposium submissions, and any free text a trainee wrote about obstacles. The
project's clinical owner, sponsor and analyst contact.

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
