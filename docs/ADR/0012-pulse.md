# 0012 — Pulse: an anonymous survey that still has "my responses" and response rates

**Status:** accepted (phase 6)

§6.4 asks for four things that pull against each other:

- identification that stays "genuinely optional";
- a "my responses" view;
- response rate by program;
- one response per quarter.

The first three cannot all be met if a response simply records its author.
This ADR records how they are reconciled, and the other defaults Phase 6 set.

## 1. Who responded is stored apart from what they said

`PulseParticipation(surveyId, userId)` is the only record that a person
responded. It is:

- the response rate's numerator;
- the one-response-per-quarter rule, via its primary key.

It has no timestamp and no link to the response. The participation and the
response are written in one transaction, so a response the PHI guard refuses
leaves no participation behind.

The response rate counts participation over a program's active trainees. It
does not use the response's optional program field: that is the respondent's
choice to share, and a rate built on it would count only the people who chose
to share it.

## 2. Nothing on a response joins it back to a person

Each of these would have been a join key, so each was removed:

- **The id.** Random UUIDs instead of cuids, which embed a creation timestamp.
- **The submission time.** `submittedOn` is a date, not a timestamp.
- **The acknowledgement columns.** The `phiAcknowledgedAt` and
  `phiAcknowledgedFlags` columns from Phase 0 are dropped. The audit log is the
  record of an acknowledgement (Q5).
- **The audit row.** For `PulseResponse` and `PulseAnswer`, an acknowledgement's
  audit row keeps the user and the rule types (Q5). It drops the row id and the
  flag offsets. Either would let someone holding the response text find the
  audit row, and so the person.

Q5 said an acknowledgement is audited "with the specific flags". On these two
models "the flags" means the rule types, not their positions. **This is the
one place Phase 6 narrows a settled answer, so it is called out here for the
committee.**

**Residual risk.** A person with direct database access could still match the
day of a response to the time of that user's audit rows on the same day. With
several responses a day, that narrows to a group, not a person. This is
documented in `docs/SECURITY.md`; the design protects against the
application, not against a DBA.

## 3. "My responses" uses a receipt only the respondent holds

On submit:

1. The server generates a random 24-byte token.
2. The respondent's browser keeps it in an httpOnly cookie scoped to `/pulse`.
3. The response stores `SHA-256(userId:token)`.

"My responses" then shows:

- responses the person put their name to, from any browser;
- anonymous ones whose receipt is in this browser.

The user id is part of the hash because hospital workstations are shared. The
next person to sign in on the same browser gets different hashes and sees
nothing. Participation still tells every respondent which quarters they
answered. The page says plainly that an anonymous response sent from another
browser cannot be shown, and that this is the anonymity working.

**Rejected:** an HMAC of the user id with a server secret. It works across
devices, but anyone holding the secret can link every anonymous response.

## 4. The survey is composed per quarter; three questions are fixed

A `PulseSurvey` per calendar quarter, with its own questions:

- **Lifecycle.** Draft → open → closed. Only one survey is open at a time,
  enforced by a partial unique index.
- **Frozen once open.** Questions cannot change after the survey opens: a
  question reworded after people answered it changes what their answers meant.
- **New drafts.** A new draft copies the previous survey's questions.

The default instrument's three questions are **core**: confidence 1–5, CLER
focus area and free-text barrier.

- The chair may reword them but not remove them, so trends stay comparable
  across quarters.
- A CHECK constraint ties each core question to its kind.
- Their answers are columns on `PulseResponse`.

The chair may add questions of three kinds: a 1–5 scale, one choice from 2–8
options, and free text. The survey is capped at 12 questions. The answers are
`PulseAnswer` rows, readable by the chair only. Only the core barrier question
is themed.

Name and program are not questions. They are the respondent's privacy
choices: always offered, off by default, never reworded. Each says who sees
it and why:

- **Name:** "only so the chair can follow up".
- **Program:** "in a small program this may identify you".

Only trainees respond. Committee members see a read-only preview.

## 5. Theming: the model proposes, the chair writes

`pulse.theme` sees the free text and keys only: no names, programs, domains
or dates. It groups the responses into at most six themes, each with a label,
a summary, an escalation target and the response keys. Its checks:

- Every response is assigned to exactly one theme.
- Summaries contain no numbers; the system counts the keys.
- **No run of six or more consecutive words from any response.**

Proposals are not stored. The chair edits each one and saves it as a barrier,
or adds it to an open barrier the model matched. The six-word check runs again
on every barrier save, whoever wrote the text.

**Why six words.** Five caught ordinary paraphrase ("ask for a different
coach"). Seven let quoted clauses through.

**Three to six themes.** The brief says 3–6. The prompt asks for three to six
where the responses genuinely differ, and forbids splitting one concern to
reach three. The check requires at most six and does not force a minimum.
Forcing a third theme out of two would invent a distinction.

If the model is unavailable, no themes are proposed. The responses are listed
and the chair groups them by hand.

## 6. The barrier lifecycle

The path is raised → at GMEC → decided → closed, with these rules:

- **Forward only.** A closed barrier stays closed and takes no new responses.
  If the problem comes back, that is a new barrier, and the history shows the
  first fix did not hold.
- **GMEC-targeted barriers pass through "at GMEC".** A barrier aimed at the
  committee or a program may go straight from raised to decided. Taking any
  barrier to GMEC sets its target to GMEC.
- **Decided** needs the decision in a sentence.
- **Closed** needs "what changed" in words a trainee will read; this is what
  the digest reports.

Who acts:

- **The chair** creates and edits barriers.
- **The chair or the barrier's owner** (the chair or a coach) moves it along.

## 7. The digest: closed barriers only, reported once, edited before publishing

`pulse.digest` is given closed barriers that no published digest has
reported: their theme, decision, what changed and closing month. It is never
given a response. It must write about each barrier exactly once and add no
number.

The draft is returned to the chair and not stored. Publishing:

- writes what the chair saw and edited, through the PHI guard;
- refuses any barrier that is not closed or has already been reported;
- emails active trainees through the mail adapter (log by default, ADR-0008),
  **by Bcc**, because a broadcast must not show every trainee everyone's
  address. The adapter gained `bcc` for this.

The latest published digest heads the Pulse landing view (addition C2).

## 8. Things found while building this

- **React 19 reset forms after failed actions.** `ActionForm` promised that "a
  failed save keeps what was typed", but React resets a `<form action>` after
  every action. A PHI refusal therefore wiped a half-completed survey. With
  JavaScript, the form now dispatches the action itself and resets only after
  a success. Without JavaScript, the native post still reaches the same
  action. This applies to every form in the app.
- **The PHI guard blocked hex hashes.** A 64-character hex receipt hash
  sometimes contains nine digits in a row, which the block tier refused as an
  identifier: an intermittent refusal of valid survey responses. Fields ending
  in `Hash` are now skipped, like fields ending in `Id`.

## 9. Demo data

Twenty roster trainees are seeded, so response rates have a real
denominator. With SSO, every resident is a user whether or not they open a
project.

The twelve responses from §8 sit in an open 2026-Q3 survey:

- eight are in the three seeded barriers;
- four are left for the theming demo.

The browser suite reseeds the test database at start, so the flows that change
state run from the same demo every time. It also runs a second production
server whose configured identity is a trainee. Production ignores the dev role
switcher, so this exercises the survey without adding a way to change user
that production would also have.

## Revisit when

- **Small cells.** The committee wants minimum group sizes before a theme or
  count is shown (for example, hiding a theme drawn from fewer than three
  responses).
- **Retention.** It decides how long free-text responses are kept (open item
  in `docs/SECURITY.md`).
- **Other audiences.** Surveys are wanted for faculty or coaches as well as
  trainees.
