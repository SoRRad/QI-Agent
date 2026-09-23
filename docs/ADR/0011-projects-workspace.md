# 0011 — Projects: intake, workspace, handoff and stall

**Status:** accepted (phase 5)

Phase 5 is where a project gets a lifecycle. The brief set the rules that
matter (a missing balancing measure or clinical owner blocks submission; a
PDSA cycle needs a prediction; 42 idle days is a stall; archived projects stay
searchable). Where it left a default open, the choice is recorded here.

## 1. A project has an owner, separate from its creator and its coach

`Project.ownerId` is the resident currently accountable. It starts as the
person who filed the draft and moves only when a handoff is accepted. Without
it, "who has this project now?" would be answered by guessing from the last
person to log a data point, and the handoff would have nothing to change. The
owner and coach are cross-program fields, so another program can see who to
ask about a precedent.

## 2. Intake blocks with explanations, and warns without blocking

`reviewIntake()` is a pure function. It returns **blockers** and **warnings**:

- **Blockers:** no problem statement; an aim missing any of the five elements;
  no balancing measure; no clinical owner.
- **Warnings:** no outcome measure, a measure without an operational
  definition, no coach, no equity stratification plan, no CLER focus area.

Each blocker says what is missing, why the committee needs it and which wizard
step fixes it. The aim blocker names the missing elements rather than saying
"invalid".

Only the brief's two named blockers and the aim standard stop submission. The
rest are advice, because the committee can supply a coach at review, and an
equity plan is better drafted with the coach than invented to pass a form.

## 3. Approval by the coach or chair; archive by the chair only

A submitted project is approved, or returned to draft, by its assigned coach
or the chair. Archiving is the chair's alone and requires a reason, because
"why it ended" is the lesson a later cohort reads (ADR-0003). Completion is
open to anyone who can work on the project but requires a **sustainability
plan**, which records:

- who owns the change now;
- the measure that continues, if any;
- the review cadence;
- where it is reviewed.

A project that "worked" and has no one keeping it in place is what the brief's
clinical-owner rule exists to prevent. Completion is where that is checked a
second time.

## 4. The PDSA prediction is required, then fixed

A cycle cannot be marked done without:

- a prediction;
- a Study result;
- an Act decision (adopt, adapt or abandon).

Once the Do step is recorded, **the prediction can no longer be edited**. A
prediction changed after the test started is hindsight, and a log of
hindsight teaches the wrong habit. If the prediction was wrong, the Study step
says so. Completed cycles are immutable; the next cycle is a new record.

## 5. An unaccepted handoff is a signal, not a stall

Addition C1: a handoff unaccepted for 14 days is a stall signal. It is drawn in
the committee's stalled queue, beside stalled projects, but it **does not flip
the project's status**.

The status means one thing: nothing has been measured or tested for 42 days.
The seeded flagship project has a 20-day unaccepted handoff and fresh data. If
the handoff flipped it to "stalled", the label would be wrong on the project
the committee is most likely to be looking at. The queue shows both, each with
its own reason.

A handoff is accepted in the application by the incoming owner or the chair,
never by an email link, because mail may not be delivered at all (ADR-0008).
Only one handoff may be pending per project.

## 6. The stall job

The stall job is `runStallJob()`, invoked by `/api/jobs/stall` (ADR-0001).

**Recompute.** Last activity is recomputed from the latest of three dates:

- the latest PDSA edit;
- the latest data point;
- the approval date.

The stored `lastActivityAt` is not trusted, so a missed `touchActivity` call
cannot hide a stall. Any activity on a stalled project returns it to active.

**The notice.** It goes to the owner, the coach and the chairs, and carries
devil's advocate's reading of the project (addition C4). The job runs that
prompt as the first active chair, so the usage record has a person to
attribute it to. If the model is unavailable, the notice is sent without the
reading.

**Credentials.** The route accepts the secret as `x-job-secret` (the compose
scheduler) or as a bearer token (Vercel Cron, with `CRON_SECRET` set to the
same value). The route refuses to run in two cases:

- the secret is unset;
- the secret is still the example value in production.

## 7. The driver diagram is a tree the database enforces

`DriverNode` rows form aim → primary → secondary → change idea. The service
checks each placement, and a CHECK constraint makes a root node a primary
driver and a primary driver a root, so a malformed tree cannot be written by
any path.

The diagram is edited as an outline, which works at 375px and with a screen
reader, and drawn as an SVG. `layoutDiagram()` is pure and shared by the
screen and the PNG export, so the exported picture is the one on screen.

## 8. PHI exemptions are scoped by model, not by field name

Until now, an exemption was keyed by field name alone, and a test forbade any
other model from reusing an exempt name. `DriverNode.text` tripped that test:
it would have inherited `AimStatement.text`'s date exemption, so a driver
reading "huddle on 30 June 2027" would have passed unflagged.

Exemptions are now `(model, field)` pairs. The test instead checks that every
listed pair exists in the schema, and that an exemption does not leak to
another model.

One exemption was added: the date rules skip `Handoff.summary`. The summary is
computed from the record and quotes the aim's deadline and baseline period,
which have already passed the scanner on the aim.

## 9. Sensitivity of the new fields (Q4)

| Tier | Fields |
|---|---|
| Cross-program | `ownerId`, `coachId`, `outcomeSummary`, `endReason` |
| Owning program | `stallReason`, `equityStratificationPlan`, driver nodes |

- **Cross-program.** Who ran it, what it achieved and why it ended are the
  precedent another program needs.
- **Owning program.** These are working detail. The equity plan was previously
  unlisted, and so readable only by the chair. It is the owning program's
  plan, so its own residents must be able to read it.

## 10. Duplicate detection reranks with a prompt that cannot invent

`projects.duplicate_rerank` returns only keys of candidates it was given. Its
guard rejects:

- any number that is not in the source text;
- any claim about outcome ("improved", "reduced").

What a precedent achieved and why it ended are shown from the record. If the
prompt fails, the top three trigram candidates are shown, labelled as
unranked.

## Revisit when

- The committee wants handoffs to reassign the coach as well as the owner.
- A program asks for stall thresholds other than 42 days. That would be a
  per-program setting, not a code change per request.
- Driver diagrams need cross-links (one change idea serving two secondary
  drivers). The tree would become a graph, and the CHECK and layout would
  change with it.
