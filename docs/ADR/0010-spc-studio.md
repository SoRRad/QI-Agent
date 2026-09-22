# 0010 — The SPC studio

**Status:** accepted (phase 4)

The studio is where the brief's first constraint — no statistic from a model —
meets a user interface. Several choices were made where the brief left a
default open; they are recorded here so they can be reviewed as decisions
rather than discovered as behaviour.

## 1. Chart state lives in the URL

View (run or control), the frozen baseline and the Western Electric toggle are
query parameters, and the controls are links. A coach can send a trainee "the
frozen-baseline p chart" as a link and both see the same chart; the page works
before JavaScript loads; the back button undoes a change. Unrecognised values
fall back to the default rather than erroring (`parseStudioParams`).

## 2. The default view is the run chart

Even for a p-chart measure. The run chart's rules detect the seeded step
change however the limits are set, and it is the first chart the committee
teaches. The control view is one tap away.

## 3. Baselines are frozen at annotated changes, computed in lib/spc

The baseline choices offered are "the points before change N", taken from the
annotations, rather than a number field: a team freezes its baseline at the
moment it changed something. The frozen parameters are computed by
`frozenParameters()` in lib/spc — median for a run chart, pooled p̄ or ū for
p and u charts, mean count for c, and mean plus the average moving range
*within* the baseline for XmR. XmR needed a new engine option
(`movingRangeBar`), because its sigma comes from the moving ranges rather than
the centre line; without it the chart would draw a baseline mean between
whole-series limits — the same defect the p and u charts were fixed for in
phase 1.

**The two runs rules are not applied against a frozen run-chart median.** The
runs table gives the expected number of runs about the median *of the points
being counted*; a baseline median extended over later points is not that.
Shifts and trends are what detect change against a baseline, and they are
still applied. The chart says so in a note.

## 4. How special cause is drawn

- A point beyond a control limit: a signal-coloured **diamond**.
- A point that is part of a shift, trend or Western Electric pattern: a
  signal-coloured circle, **and** a bracket beneath the axis naming the rule.
- An astronomical point candidate: a hollow signal ring — a prompt to look,
  not a finding.

Shape or a bracket accompanies every use of colour, so nothing depends on
colour vision. On the seeded series with a whole-series median, every point is
part of one shift or the other; that is the truthful rendering, and it is the
reason the frozen-baseline view exists.

Flat limits are dashed. Stepped limits are a thin solid line: a dash pattern
restarting on every 12px step reads as noise at 375px. Limit labels sit at the
left end of the chart, where the baseline points are, because the points a
limit exists to catch are usually at the right.

## 5. One renderer, two outputs

`layoutChart()` is a pure function from an analysis and a width to geometry,
and `SpcChartSvg` is a hook-free component with literal colours. The browser
wraps it with measurement, the crosshair and the keyboard readout; phase 9
rasterises the same markup to PNG (ADR-0006). A test asserts the literal
colours match the design tokens.

## 6. Reproducibility evidence is written once

The restatement is generated and stored on the definition version before the
user confirms it, so the confirmation refers to text the server holds, and a
digest of the text the user read must match. Once confirmed, a trigger
(migration `definition_evidence_lock`) refuses any change to the restatement
or its timestamp. Because a model wrote it and no person can acknowledge a
warning on its behalf, the restatement must pass the PHI scanner with no flags
at all.

## 7. Data requests ask for aggregates only

The generated request always specifies one row per period with counts, and
states that identifiers must not be included. The upload that follows then
never has to refuse a patient-level file, and the column names in the request
are the ones the CSV mapper recognises.

## 8. Uploads never send the file

CSV files are parsed in the browser. Only the mapped columns are sent, and the
server recomputes and revalidates every row from those cells. Rows are all or
nothing: one bad row and nothing is written.

## 9. Only the latest point can be removed

Mistyped entries need a correction path, but a chart whose middle can be
rewritten cannot be trusted. Removing the most recent point is the only
deletion offered, and it is audited.

## 10. Chart types the studio does not draw

The advisor recommends g and t charts for rare events and X̄–S charts for
subgrouped measurements, says plainly that the studio does not draw them yet,
and names what to use meanwhile. Recommending a p chart for rare events because
it is the chart available would be building a worse thing quietly.

## Revisit when

- The committee wants X̄–S or g/t charts: the engine, layout and advisor
  recommendation are the three places to extend.
- A program needs to correct a point in the middle of a series: that should be
  a versioned correction with a reason, not an edit.
