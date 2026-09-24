# 0013 — Scholarship: assembled, not generated

**Status:** accepted (phase 7)

§6.5 asks for four tools:

- a SQUIRE 2.0 drafter that "never invents results";
- an abstract formatter with a word counter;
- a venue matcher over `/content/venues.json`;
- an IRB / QI pre-check that cites local policy and "flags when the answer is
  genuinely ambiguous rather than guessing".

None of the four calls a language model. That is the main decision of this
phase, and the others follow from it.

## 1. The SQUIRE draft is assembled from the record, not written by a model

The drafter arranges the record into SQUIRE's eighteen items in order. Every
line under an item comes from one of three places, and nowhere else:

- **Copied from the record.** The problem statement, aim versions, driver
  diagram, change ideas, PDSA plans, predictions and results, operational
  definitions, context fields, the sustainability plan, and similar archived
  projects from the registry.
- **Computed by the SPC engine.** For example, "Run chart of 24 points from
  Oct 2024 to Sep 2026. Median 26.7%. Signals: …". This is the same
  `describeChart` text the chart's accessible description uses.
- **Fixed methods text.** Sentences describing the rules the engine applies,
  built from its own constants, so the text cannot drift from the code.

Everything else is an **AUTHOR INPUT NEEDED** prompt that says what the item
asks for. Discussion, rationale, literature, context and funding are always
the author's.

**Why not model prose.** A model asked to write a Results section from a
record will write a Results section. "Never invents results" would then rest
on a checker catching every invention; with assembly it holds by
construction. The test states it as a property. For a project with no data:

- Results carries no line from the record, only the author prompt;
- no author prompt contains a digit;
- every number in the draft appears in the record or in the engine's method
  text.

**Rejected:**
- **Model-written prose checked by the numeric guard.** The guard catches an
  invented number. It cannot catch "the change was well received".
- **A model "polish" pass.** It is the same problem one step later.

**Other choices:**
- **Assembled on each view, never stored.** The draft is always the current
  record; the author edits the downloaded Markdown in their own word
  processor.
- **The aim is checked.** Specific Aims names the aim's missing elements,
  using the same check intake uses.

## 2. The IRB pre-check screens; it never determines

A branching questionnaire of nine questions, one of which is asked only when
it applies. It is evaluated by a pure function into one of three results:

- **Likely QI.**
- **Likely research:** randomisation, a research grant, or a purpose meant to
  apply beyond the institution.
- **Ambiguous:** any "not sure", or any answer where improvement and research
  genuinely overlap. These are:
  - both purposes at once;
  - an unproven change;
  - added risk;
  - extra data from patients or trainees;
  - identifiable data leaving the care team.

An ambiguous result names each answer that made it so. It does not choose.

**The questions state no policy.** They are screening considerations phrased
as questions. The memo says in its first line that it is a screening, not a
determination.

**Local policy.** The memo cites the library's `local-irb-determination`
document by title, version and link, but only once the institution has
replaced it (`isLocal` false). While it is a placeholder, the memo says the
policy is missing and lists what the institution must supply, from the
document's own `localFieldsRequired`. That is the exit criterion, "cites a
LibraryDoc or declares the gap". The seed's placeholder means the demo shows
the gap.

**Storage.** Screenings are append-only: a database trigger refuses edits, and
each run is a new record. The latest one feeds SQUIRE's Ethical
Considerations section.

**The memo's PHI exemption.** The memo is exempt from the name and date
patterns, scoped to `IrbPrecheck.memo` alone. Its names come from user
records, and its dates are the screening date and the aim's deadline, from
text that already passed the guard. Block-tier rules still apply. This is the
same reasoning as `Handoff.summary` in Phase 5.

## 3. The venue list is validated at load and imported, not read

`content/venues.json` is imported and parsed with Zod when the module loads:

- **A malformed edit fails the test suite**, not a trainee's page.
- **It ships inside the build** on Vercel and Docker alike. Editing it is a
  commit, which is also the record of the committee's quarterly review.

**Matching is rule-based.** Each scope tag in the file has a reading: fits,
stretch, check, or out of scope. For example:
- **Paediatric setting** excludes an adult project.
- **Improvement report** is a stretch until the project is complete.

**Unknown tags.** A tag the matcher does not know reads as "check", so the
committee can add tags before the code learns them.

**Ranking.** Venues are ranked by fit, then by the nearest deadline month,
because the library's SQUIRE outline names deadlines as the binding
constraint.

**Deadlines are months, not dates.** The file gives a month, so the page shows
"usually in March" and asks the trainee to confirm the date on the venue's
site.

## 4. The abstract formatter counts in the open

**The counting rule.** A word is any run of characters between spaces, so
"34%" and "p-chart" each count as one. Headings and the title are not
counted. The rule is on the page, because venues differ and trainees get
caught out.

**Headings.** A venue's headings come from the file. When the file gives none
for a structured abstract, the formatter uses the common four and says it is
a fallback.

**Saving.** A draft may be saved over the limit, because a draft is how you
get under it. The count is shown live and returned on save.

**The starter** fills sections from the record only:
- **Background:** the problem statement.
- **Methods:** the aim, the changes and the measures.
- **Results:** the engine's reading of the outcome measure with the most data.

Conclusions start empty. Drafts are saved per project and venue, and are
visible to the owning program only.

**The PHI warn prompt.** The Methods starter quotes the aim, so saving usually
raises a warning for the aim's deadline date, and the trainee confirms it.
Unlike the memo, an abstract is the trainee's own text and is scanned in full.

## 5. Found while building this

`ActionForm` gained `resetOnSuccess`. The abstract editor keeps editing in
place after a save with a live count, and resetting the form would leave the
count out of step with the text.

## Revisit when

- **The IRB policy is filled.** Once the institution supplies it, the committee
  may want the questionnaire to follow its written criteria. It would become
  a local rule set in the library rather than code.
- **Model prose is wanted after all.** The place for it is a clearly labelled
  "suggest wording for this section" per author prompt, restricted to the
  author's own notes, never to Results.
- **Exact deadlines.** Venues publish exact dates the committee wants to track:
  add a `deadline` date to the file, and the matcher can count days.
