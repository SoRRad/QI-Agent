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
