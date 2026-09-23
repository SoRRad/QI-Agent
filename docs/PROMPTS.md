# Prompts, in plain language

This page is for the committee. It describes, without code, every instruction
this system gives a language model: what it is for, what the model is shown,
what it is not shown, what it must not do, and what happens when it gets it
wrong.

Every prompt lives in `lib/llm/prompts/` as a named definition. None is written
inline in the application. A test fails if a prompt exists without a section
on this page, so this page cannot quietly fall out of date.

## Rules that apply to every prompt

- **The model never produces a number that appears on a chart.** Medians,
  limits, counts and percentages are computed by the statistics engine. Where
  the model describes a chart, it is not allowed to write any number at all —
  in digits or in words — and a check rejects any reply that does. See
  `charts.interpretation` below.
- **Every call is logged** — who asked, for which feature, which model
  answered, how many tokens it used, and how long it took. **The question and
  the answer are not logged.**
- **Replies are checked, not trusted.** A structured reply is validated against
  the shape it must have. If it fails, the model is asked once more with the
  reason; if it fails again, the user sees a plain "unavailable" message rather
  than a half-right answer.
- **No prompt contains patient information.** Free text written by users is
  scanned for identifiers before it is stored, and before it is sent to a
  model.

## Which model

The system can use Anthropic's API directly, an Azure OpenAI deployment, or an
internal gateway at the institution. Which one is a configuration setting, not
a code change. Where Anthropic's API is used, the default model is Claude Opus
5, with server-side fallbacks turned on: if the model's safety checks decline a
request, the same request is re-run on another model within the same call.

With no provider configured, the system runs a **mock** that gives fixed,
clearly-labelled stand-in answers. Every feature works in that mode, which is
how the system is demonstrated and tested.

---

## `ask.answer`

**What it is for.** Answers a question about quality improvement at this
institution, using only the institutional library.

**What the model is shown.** Every library document, in full, marked by title
and id, with the three institutional placeholders marked as placeholders. Then
the question. (While the library is small, the whole library fits in one
request. When it grows past roughly 120,000 tokens this will switch to
retrieving the relevant passages; see the README.)

**What it must do.**

- Answer only from those documents. For each document it relies on, give the
  document's id and a short quote copied **word for word** from it.
- If the documents do not answer the question, say so, briefly describe what
  is missing, and name the document the institution should write. It must not
  answer from general knowledge, even when it knows the answer. This matters
  most for institutional policy — IRB and QI determination, sign-offs, duty
  hours — where a plausible general answer can be wrong here.
- Treat the three placeholders as unwritten policy. It may cite one to explain
  that the policy has not been written, never as if it were policy.
- Keep answers to a few sentences.

**How the rules are checked.** In code, after the reply arrives:

- A citation to a document the model was not given is rejected.
- A quote that does not appear in the cited document is rejected. (Markdown,
  capitals and spacing are ignored when comparing.)

A rejected reply is retried once with the reason. If the second reply also
fails, the user is told Ask could not produce an answer grounded in the
library — and nothing is answered from outside it.

**What the user sees.** The answer, each cited document with its quote and a
link to read it in full. If an answer cites a placeholder, a banner says the
policy has not yet been supplied by the institution.

**What is recorded.** Questions the library does not cover go to the chair's
knowledge gap queue, as do questions whose answer had to lean on a placeholder.
A question asked again in different words adds to the same gap's count rather
than creating a new one. Answers themselves are not stored. The question is
scanned for patient identifiers before it is sent.

---

## `ask.tutor`

**What it is for.** Coaches a trainee through their own project Socratically —
by asking, not telling.

**What the model is shown.** If the trainee has selected a project: its title,
problem statement, current aim statement, and the aim check — which of the five
required elements are present, and why any are missing. (The aim check is
computed by the system, not by the model.) Then the conversation so far.

**What it must not do.**

- Ask more than one question per reply.
- Write, draft, suggest or complete an aim statement — even partially, even if
  the trainee asks for one. The point is that the trainee can write the next
  one without help.

**How the rules are checked.** A reply must contain exactly one question mark,
at the end. A reply that reads like an aim statement — a change "from" one
value "to" another "by" a date — or that offers one ("your aim could be…") is
rejected, and the model is asked again.

**Order.** When the aim is incomplete, the tutor starts with the most
fundamental missing element: the number that would show success, then the
baseline, then who is counted, then the date, then the measure's definition.

**What is recorded.** Each tutor exchange is counted for the usage figures.
The conversation is not stored. Everything the trainee types is scanned for
patient identifiers before it is sent.

---

## `ask.devils_advocate`

**What it is for.** Argues, specifically and from the project's own record,
why a project is likely to fail — and what to do about each risk. Most serious
first.

**What the model is shown.** The problem statement and aim, and a set of facts
**computed by the system** from the project record: whether there is a named
clinical owner, a coach, and outcome, process and balancing measures; whether
the outcome measure's data source has been identified; how many data points
exist; how many months remain before the deadline; how many points the measure
will have by then at its cadence; how many the run chart rules need; how many
PDSA cycles lack a written prediction; and which aim elements are missing.

**What it must not do.** Write any number, in digits or words. The
calculations that matter here — "the effect is too small to detect before the
deadline" — are done by the system; the model refers to them through
placeholders, under the same check as chart interpretation. It must also stick
to risks the record supports rather than pad the list.

**The risks it looks for** are the ones that actually end trainee projects:
the data never arrives; nobody with authority owns the change; the
intervention cannot be tested at the scale a trainee controls; the effect is
too small to detect in the time available; there is no balancing measure; the
aim cannot be succeeded or failed against; cycles run without predictions; the
change evaporates when the trainee rotates off.

**Where it appears.** On demand in Ask. From phase 5 it also runs
automatically at intake review, and again when a project is flagged as
stalled, attached to the stall notification.

---

## `charts.interpretation`

**What it is for.** Explains in plain language what a run chart or control
chart is showing — for example, that a shift began after an intervention.

**What the model is shown.** The chart type, which rules fired and over which
periods, the interventions annotated on the chart, and a table of placeholders
for every value it might mention, each with the value it stands for.

**What the model is not shown.** The data series itself. It never sees the
monthly values, only what the statistics engine concluded from them.

**What it must not do.**

- Write any number, in digits or in words. It writes a placeholder instead —
  `{{centre_line}}` rather than "26.7%" — and the system fills in the value
  computed by the statistics engine. The numbers in the explanation are
  therefore exactly the numbers on the chart, because they are the same
  values; the model cannot mistype, round or invent one.
- Claim that an intervention *caused* a change. It may say the timing is
  consistent with the intervention, and no more.
- Use the phrase "statistically significant".

**What happens if it breaks a rule.** A reply containing any number, or a
placeholder that does not exist, is rejected and the model is asked once more
with the reason. If the second reply also fails, the chart is shown without an
explanation, labelled "interpretation unavailable". The chart itself is never
affected: it is drawn from the statistics engine, not from the model.

**Length.** Three or four sentences.

---

## `charts.definition_restatement`

**What it is for.** The reproducibility check on an operational definition. The
model restates the definition as the data query an analyst would actually run —
for each period, which records to start from, which to keep and leave out, what
to count, how the result is formed — and the resident who wrote the definition
confirms it matches what they meant. The value is in the mismatch: a definition
that reads clearly to its author often admits two queries, and the restatement
makes the model pick one where the author can see it.

**What the model is shown.** The measure's name, chart type and cadence, and
the definition's numerator, denominator, inclusions, exclusions and data
source. Not the name of the person who pulls the data, and no data points.

**What it must not do.**

- Introduce a number. It may repeat one that appears in the definition — a
  48-hour window, a potassium threshold — exactly as written, because a
  restatement that drops the threshold is not a restatement. A number that is
  not in the definition is rejected.
- Name a person, or write anything the PHI scanner flags at all. The confirmed
  restatement is stored as evidence, and because a model wrote it there is no
  one to acknowledge a warning on its behalf, so it must pass with no flags.
- Improve the definition. Where the definition is vague it must pick a reading
  visibly and list the ambiguity separately (up to four questions).

**What happens if it breaks a rule.** The reply is rejected and the model is
asked once more with the reason; if the second reply also fails, the check is
shown as unavailable and nothing is stored.

**What is stored.** The restatement, on the definition version it describes.
When the resident confirms it, the confirmation time is stored too, and from
then on the database refuses to change either (migration
`definition_evidence_lock`). A definition whose meaning changes is a new
version with its own check.

---

## `charts.data_request`

**What it is for.** Drafting a data request an analyst can act on without a
meeting — the brief calls the data request the single largest source of stalled
trainee projects.

**What is computed in code, not by the model.** The date range and how many
periods it covers, the output file's columns, and the rule that the output is
aggregate counts only: one row per period, no patient-level rows, no
identifiers. These are assembled around the model's text by
`lib/charts/dataRequest.ts`.

**What the model is shown.** The operational definition, the project's problem
statement and current aim where there is one, and the computed date range.

**What the model writes.** The clinical question in one sentence; the systems
likely to hold the data (starting from the named source, and never inventing a
table name, because it does not know this hospital's schema); the fields
needed; the inclusions and exclusions as filter logic; and up to four things
the analyst should confirm first.

**What it must not do.**

- Introduce a number that is not in what it was given.
- Ask for a patient identifier. A request mentioning a record number, a patient
  name or a date of birth is rejected.
- Write more than one sentence for the clinical question.

**What happens if it breaks a rule.** Rejected and retried once with the
reason; if the retry fails, the request is shown as unavailable. Nothing is
stored: the request is a document the resident copies or downloads.

---

## `projects.duplicate_rerank`

**What it is for.** Duplicate detection at intake: "has anyone already tried
this?" Trigram search over every project's title and problem statement — every
program, every year, archived projects included — finds candidates that share
words (ADR-0003). This prompt decides which of them are genuinely the same
problem, and says in one sentence what overlaps, so the new team knows why to
read it.

**What the model is shown.** The new project's title and problem statement,
and each candidate's title, problem statement, program, cohort year and status.

**What the model is not shown, and never says.** How a candidate turned out.
What it achieved and why it ended are displayed beside the model's sentence,
verbatim from the project's own record, so a trainee reads what actually
happened rather than a paraphrase of it.

**What it must not do.**

- Return a key that was not in the list, or the same project twice.
- Describe an outcome ("succeeded", "was abandoned", "ended").
- Introduce a number that is not in what it was given.

**What happens if it breaks a rule.** Rejected and retried once with the
reason. If the retry fails, or the provider is unavailable, the page still
shows the top three recall candidates, labelled as not checked for relevance:
the committee would rather a trainee see a possibly related project than
nothing.

## `pulse.theme`

**What it is for.** Reading a quarter's pulse survey. Trainees describe what got
in the way of improvement work, in their own words; this prompt groups those
answers into three to six themes, each with a plain-language label, a
paraphrased summary and a suggested escalation target (the QI committee, GMEC,
or a program). The chair edits each proposal and saves it as a barrier, or adds
it to a barrier already open.

**What the model is shown.** The free-text answers, each with a key, and the
label and summary of each open barrier, so it can say "this belongs with one
you already have".

**What the model is not shown.** Who wrote an answer, whether they gave their
name, their program, their confidence rating, their CLER area, or the date.

**What it must not do.**

- Copy six or more consecutive words from any answer. Themes are read across
  programs while the answers behind them are the chair's alone (Q4); a trainee
  must not be recognisable by how they write. The same check runs again when
  the chair saves a barrier, whoever wrote the words.
- Write a number, in digits or words. How many answers a theme holds is counted
  by the system from the keys the model assigned.
- Leave an answer out, put one in two themes, invent a key, or match two themes
  to the same open barrier.
- Split one concern into two themes to reach three.

**What happens if it breaks a rule.** Rejected and retried once with the reason.
If the retry fails, or the provider is unavailable, no themes are proposed: the
page lists the answers and the chair groups them by hand, writing the summary in
their own words. Nothing the model writes is stored until the chair saves it.

## `pulse.digest`

**What it is for.** The trainee-facing "You reported, we changed" digest (§6.4):
a short summary of barriers the committee has closed and what is different now.
Closing the loop visibly is what keeps trainees reporting.

**What the model is shown.** Closed barriers only, each with a key: the theme,
the decision recorded, what changed, and the month it closed. All of it was
written by the committee. It is never shown a survey answer.

**What it must not do.**

- Write about a barrier it was not given, leave one out, or cover one twice.
- Introduce a number that is not in the records. It may repeat one ("a two-week
  turnaround").
- Promise further changes, or describe benefits the records do not state.

**What happens if it breaks a rule.** Rejected and retried once. If the retry
fails, or the provider is unavailable, the draft is assembled from each
barrier's own "what changed" text instead, and says so. Either way it is a
draft: the chair edits it and publishes it, the PHI guard reads what is
published, and publishing refuses any barrier that is not closed or has already
been reported.
