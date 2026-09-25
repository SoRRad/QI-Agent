# 0014 — Committee: the chart first, ties shared, drafts marked

**Status:** accepted (phase 8)

§6.6 asks for eight committee tools:

- event kits;
- judging with tie handling;
- a curriculum tracker;
- an ACGME milestone mapper;
- a CLER mock walkaround;
- coach matching;
- an annual report;
- the chair dashboard.

§7 makes the dashboard's first element an annotated run chart of the
institution's headline measure.

Two of the eight call a language model: the milestone mapper and the CLER
question writer. Everything else is counted or assembled in code, for the
reason given in ADR-0013: text that reports figures to the GMEC should hold its
figures by construction, not by a checker.

## 1. The dashboard opens with the headline measure, with its median frozen before the intervention

`Measure.isHeadline` marks one library measure as the headline. Two database
rules keep that honest:

- **A CHECK constraint** requires the headline to be a library measure.
- **A partial unique index** allows at most one headline.

The seed adds a 24-month institution-wide series with a genuine step down, and
two committee annotations.

**Why the median is frozen.** Plotted with a median over all 24 months, that
series fired "shift" on its own baseline. The median sits between the before
and after, so both halves read as runs on the wrong side of it. The chart was
technically correct and useless for the one question the dashboard asks: did
the committee's changes move the measure?

**What the dashboard does instead.** It freezes the median on the periods
before the first committee intervention and extends it across the rest. This
is the studio's frozen-baseline option, used here by default.
- **The rule.** `baselineFor`: points before the first annotation, if there
  are at least two. Otherwise the whole series.
- **Where it is stated.** The chart's own caption says so.
- **Consistency.** The annual report reads the chart the same way.

**Other institution measures.** Every institution-level measure with data is
drawn the same way. Each is a run chart, never a control chart, bar or stat
card:
- a run chart makes no distributional claim about a measure the committee did
  not choose the chart type for;
- the brief says "never bar charts".

**The pulse response rate.** It becomes a run chart from the second quarter.
With one quarter, the page says that one point is not a trend and shows the
table.

**Found while building this.** The axis labelled a 2.5 tick step with no
decimals, so 32.5% printed as "33%". `formatValue` now uses as many decimals as
the step carries. This affected every chart with a 2.5 step, not only this one.

## 2. Ties are shared, never broken

- **Weights.** Rubric weights are whole numbers, so each judge's total is an
  integer.
- **Exact comparison.** Means are compared by cross-multiplying (sum × count),
  so equal means tie exactly and near-misses never round into a tie.
- **Competition ranking.** Tied submissions share a rank (1, 1, 3). Choosing
  between them is the committee's decision, not an order the software invents.
- **Incomplete scoring.** A submission is ranked only once every assigned
  judge has scored. A provisional rank would move and be read as final.

**The export writes the rank as a number, with a `tied` column.** The page
shows a shared rank as "=1". That is the usual notation, but in a CSV opened in
a spreadsheet `=1` is a formula and displays as 1, losing the marker. `toCsv`
also neutralises any cell a spreadsheet would execute (leading `=`, `+`, `-`,
`@`), because titles and presenters are user text.

**Judges.**
- **Who they are.** The chair and the coaches.
- **Conflicts.** A judge is never assigned a project they coach or lead. The
  board shows who is not assignable and why.
- **Enforcement.** A score is accepted only from an assigned judge. The
  database enforces this with a foreign key from `JudgeScore` to
  `JudgeAssignment`, not only the service.
- **No silent changes.** Once a judge has scored, their assignment cannot be
  removed, so results cannot change silently.

**Visibility.** Judges see and edit only their own scores. The board and
results are the chair's, as `JudgeScore` already was (Q4).

## 3. Event kits are templates, stored as generated

The kit has five sections: agenda, invitation, slide skeleton, rubric and
feedback form. The rubric appears for symposia only.

**How it is filled.** From the event and its submissions. It states no time,
room or rule the record does not hold; those are marked `[organiser to fill:
…]`. The rubric section is printed from the same `RUBRIC` constant the judges
score on and the aggregation counts.

**Why it is stored.** The kit is saved as generated, not rebuilt on view:
once an invitation has gone out, the record should show what it said.

**Staleness.** When a submission arrives after generation, the page says the
kit is out of date. It does not regenerate on its own.

**The PHI exemption.** `Event.kit` is exempt from name and date patterns. It is
composed by the system from the event date and `Submission.presenters`, which
is already name-exempt.

## 4. Curriculum: all or nothing, never un-completing

**The item list.** It is whatever the records hold, so a new module appears
when its first row is imported. A trainee with no record for an item has not
completed it.

**The import.** It refuses the whole file on any bad row and lists every
problem by line. A half-imported roster is worse than none, because nobody can
tell which half landed.
- **Blank dates.** A blank `completed_on` assigns an item.
- **No clearing.** An import never clears a completion already on record.
  Re-importing an older export must not undo newer work.

**The export.** It uses the import's columns, plus program and name, so it
round-trips.

**Visibility.** Completion by named trainee is personnel information, so the
tracker, the export and the annual report are the chair's. Coaches see the rest
of the dashboard without the curriculum table.

## 5. The milestone mapper cites facts and never rates

The mapper builds numbered facts from the record in code:
- role;
- aim;
- measures, and the engine's reading of each chart;
- PDSA plans, predictions and results;
- the sustainability plan;
- the CLER focus area;
- presentations.

**The prompt.** `committee.milestone_draft` gets the facts and the
subcompetency list from `content/milestones.json`. The file holds codes,
titles and the committee's own paraphrase, never ACGME level text. The prompt's
refine rejects a draft that:
- rates, or uses level language;
- names anyone;
- cites a fact that does not exist;
- uses a number not in the facts that paragraph cites.

**Storage.** Each entry is stored with its cited facts underneath and marked
**DRAFT — requires program director review** until a review is recorded.

**What was wrong in the brief, and what was done instead.** The brief says the
mapper maps "a resident's" activity. The record does not attribute each PDSA
cycle or data point to a person; it knows who leads, who handed over, and who
presented. So the facts describe the project and the trainee's recorded role.
Every draft says in its own words that the program director confirms the
resident's personal contribution. Writing "the resident designed…" from a team
record would be the fabricated evidence the non-negotiables forbid.

**Recording the review.** The system has no program director role. The chair
or coach who received the PD's review records it, and the page names who did.

**Visibility.** Drafts are for the chair and the project's coach: a new
`committee` tier (chair and coaches), narrowed in the service to the project's
own coach.

## 6. CLER mock: the model asks, people rate

**Questions.** `committee.cler_questions` writes one to three questions per
focus area for a named setting. It must cover all six areas, and the questions
contain no numbers. The mock provider draws on a fixed bank.

**Responses.** The interviewer records each answer by role ("PGY-2 resident"),
never by name, and rates it: clear, partial, or could not answer. Answers pass
the PHI guard like any free text.

**The gap reading.** It is counted per focus area from those ratings. A focus
area is a gap if any answer could not be given. The model never sees an
answer.

## 7. Coach matching shows its arithmetic

The scoring is on the page:
- expertise in the project's CLER focus area: +3;
- same program: +2;
- each active or stalled project already coached: −1.

**Expertise.** It is declared on the user (`User.expertise`), not inferred from
past projects. **Assignment.** The chair assigns, and the change is audited.

## 8. The annual report says what it cannot know

The report is assembled for one academic year (July–June). It defaults to the
last completed year; the current year is offered as "to date".

**Figures it can count exactly:**
- projects submitted, completed and archived;
- barriers closed;
- events and submissions;
- abstract drafts and screenings.

**Figures it can only give as they are now**, which it says:
- **Active and stalled now.** The record keeps status transitions as
  timestamps, not a status history.
- **Pulse rates.** Taken against current active trainees, because past rosters
  are not kept.
- **Curriculum completion.** As of the day the report is generated.

**What the chair writes.** The narrative and external publications are
**AUTHOR INPUT NEEDED**.

**Download.** The report downloads as Markdown for the GMEC packet.

## Revisit when

- **Program directors sign in.** Give them a role, and let them record their
  own review of milestone drafts.
- **Individual attribution.** If the committee wants milestone evidence
  attributed to people, PDSA cycles need an author field. That is a schema
  change, not a prompt change.
- **Status history.** Keep a status history if the GMEC wants "active on
  30 June" rather than "active now".
- **Tie-breaks.** If the committee adopts a tie-break rule, such as the higher
  Results score, it goes in `lib/committee/judging.ts` as a named rule shown on
  the board. It is never applied silently.
