---
slug: run-charts-special-cause
title: Run Charts and Special Cause
isLocal: false
---

A run chart is a measure plotted in time order with a median drawn through it.
Its purpose is to tell the difference between a system that is varying the way
it always has and a system that has actually changed. Two numbers compared —
"we were at 34% and now we're at 28%" — cannot make that distinction, and a
bar chart of before and after actively hides it.

## Set-up rules

- Plot in **time order**. The x-axis is time or sequence, never category.
- Draw the **median** as the centre line, not the mean. The median is not moved
  by a single extreme point, which is what you want when the whole question is
  whether one point is extreme.
- Use at least **12 points** before interpreting the chart for special cause.
  Fewer points can be plotted and shown, but the rules below are not reliable
  on a short series and should not be applied to one.
- **Annotate the chart** with what was done and when. An unannotated run chart
  records that something changed; an annotated one supports a claim about why.
  Every intervention gets a dated marker.
- Freeze the median from the baseline period when you want to test whether
  later points are different from the baseline.

## The four rules for special cause

A run chart shows special cause when any one of these is present.

**1. Shift** — six or more consecutive points all above, or all below, the
median. Points that fall exactly **on** the median are not counted at all: they
are skipped, and they do not break a shift. A shift is the workhorse rule; it
is what a successful intervention usually looks like first.

**2. Trend** — five or more consecutive points all increasing, or all
decreasing. Where two consecutive points are equal, one of them is ignored when
counting the trend, because a repeated value is neither an increase nor a
decrease. Note that a trend is counted against the direction of successive
points, not against the median.

**3. Too few or too many runs** — a run is a consecutive series of points on the
same side of the median. Count the number of runs and compare it against the
published critical values for the number of useful observations, where useful
observations excludes every point sitting on the median. Too few runs means the
data is clustered; too many means it is oscillating. Both indicate that
something other than chance is at work.

**4. Astronomical point** — a point so obviously different from the rest that
anyone looking at the chart picks it out. This rule is deliberately a judgement
and not a calculation: it is not "the largest point", because every chart has
one of those. Treat it as a prompt to investigate that point's story, and record
what you find.

## What the rules do not tell you

Special cause means the system changed. It does not mean your intervention
caused the change, and it does not mean the change is clinically important.
Causation comes from the annotation — from the intervention having preceded the
signal, and from process measures moving at the same time.

The absence of special cause does not mean the intervention failed. On a short
series, a real but modest improvement will frequently produce no signal at all;
this is a question of how much data you have, not of whether the change worked.

## Where the numbers come from

Every median, run count, control limit and rule evaluation in this system is
computed in deterministic code with unit tests written against published worked
examples. The language model may explain a chart; it never produces a number
that appears on one. The test cases and their published sources are listed in
`docs/VALIDATION.md`.
