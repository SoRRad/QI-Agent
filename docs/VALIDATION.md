# Validation of the statistical engine

This page exists for one situation: a program director disagrees with a chart.
It lists every rule and limit the system computes, the published source for
the method, and the test case that holds it in place.

Every number in every chart originates in `lib/spc`. That directory contains
pure functions, imports no language model, makes no network call, and reads no
environment variable — asserted structurally in
`tests/spc/purity.test.ts`, not merely intended. A model may be handed a
completed analysis to describe in prose; it never produces a statistic.

**Test suite:** 93 tests across six files, all passing.

---

## Sources

| Method | Source |
|---|---|
| Run chart rules; critical values for the number of runs | Perla RJ, Provost LP, Murray SK. "The run chart: a simple analytical tool for learning from variation in healthcare processes." *BMJ Quality & Safety* 2011;20(1):46–51. |
| The underlying run distribution the table presents | Swed FS, Eisenhart C. "Tables for testing randomness of grouping in a sequence of alternatives." *Annals of Mathematical Statistics* 1943;14(1):66–87. |
| Chart selection; healthcare worked examples | Provost LP, Murray SK. *The Health Care Data Guide.* |
| Control limits, including variable subgroup sizes | Montgomery DC. *Introduction to Statistical Quality Control.* |
| XmR conventions and constants | Wheeler DJ. *Understanding Variation.* |
| Western Electric supplementary rules | Western Electric *Statistical Quality Control Handbook*, as presented in Montgomery. |

---

## An honest note on the runs table

**Read this before citing the runs test to anyone.**

The engine does not transcribe the printed table from Perla et al. Table 1. It
**computes** the critical values from the exact run distribution that the
published table presents, in exact integer arithmetic:

```
P(R = 2k)     = 2·C(n₁-1, k-1)·C(n₂-1, k-1) / C(n₁+n₂, n₁)
P(R = 2k + 1) = [C(n₁-1, k-1)·C(n₂-1, k) + C(n₁-1, k)·C(n₂-1, k-1)] / C(n₁+n₂, n₁)
```

with `n₁ = floor(n/2)` and `n₂ = ceil(n/2)`, since the median splits the useful
observations evenly. The lower critical value is the smallest run count whose
lower tail exceeds α = 0.025; the upper is the mirror. `runs < lower` is too
few; `runs > upper` is too many.

**Why it was computed rather than transcribed.** The build environment had no
network access to the published paper. Computing the values from the
distribution they are derived from is more defensible than transcribing a
table from memory, and it cannot contain a transcription typo.

**Corroboration.** The derivation reproduces these published rows exactly:

| Useful observations | Lower | Upper |
|---|---|---|
| 10 | 3 | 9 |
| 14 | 4 | 12 |
| 16 | 5 | 13 |
| 24 | 8 | 18 |
| 30 | 11 | 21 |
| 40 | 15 | 27 |
| 50 | 19 | 33 |
| 60 | 24 | 38 |

Eight independent rows agreeing is not coincidence. The derivation is also
checked against the *definition* of a critical value — that the tail beyond it
is under α and including it exceeds α — for n = 10, 12, 16, 20, 24, 30, 40 and
50, in `tests/spc/runs.test.ts`.

> **Open item for the committee.** Two rows, **n = 12** and **n = 20**, could
> not be corroborated against a second source and should be spot-checked
> against the committee's printed copy of Perla et al. Table 1. If either
> disagrees, tell me and I will reconcile the derivation before the engine is
> used to challenge anyone's chart. Nothing else in this page depends on those
> two rows.

---

## Run chart rules

Centre line is the **median**, not the mean: a single extreme point must not
move the line when the question is whether that point is extreme.
(`tests/spc/runChart.test.ts`)

Rules are not evaluated below **12 points**. A shorter series still plots; the
rules are simply not applied, and the analysis says so.

### Rule 1 — Shift

Six or more consecutive points on one side of the median.

| Case | Expected | Result |
|---|---|---|
| Exactly 6 consecutive on one side | Fires, indices `[0..5]` and `[6..11]` | pass |
| Longest same-side run of 5 | Does not fire | pass |
| **3 above, 1 exactly on the median, 3 above** | Fires as a shift of **6**, indices `[0,1,2,4,5,6]` | pass |
| Same series | Useful observations = **12**, not 13 | pass |

The third case is the one that is easy to get wrong. A point lying exactly on
the median is skipped: it is not counted, and **it does not break a shift**. If
it did, that series would be two runs of three and no signal at all.

### Rule 2 — Trend

Five or more consecutive points all increasing or all decreasing.

| Case | Expected | Result |
|---|---|---|
| 5 consecutive increasing | Fires, indices `[4..8]` | pass |
| 4 consecutive increasing | Does not fire | pass |
| 5 consecutive decreasing | Fires | pass |
| **`1, 2, 3, 3, 4, 5`** | Fires as a trend of **5**, indices `[0,1,2,4,5]` | pass |
| 8 identical values | Does not fire | pass |

Where two consecutive points are equal, one is ignored — a repeated value is
neither an increase nor a decrease. Treating the repeat as breaking the
sequence would give two runs of three and miss the trend.

### Rule 3 — Too few or too many runs

Run count compared against the critical values above, indexed by useful
observations.

| Case | Expected | Result |
|---|---|---|
| 2 runs across 12 useful observations | Too few (lower limit 4) | pass |
| 12 runs across 12 useful observations | Too many (upper limit 10) | pass |
| 6 runs across 12 useful observations | Silent | pass |

### Rule 4 — Astronomical point

**This rule is a judgement, not a calculation,** and the engine does not
pretend otherwise. Every chart has a largest point, and the rule is not "the
largest point".

The engine surfaces at most one *candidate*, using a transparent robust
heuristic — distance from the median exceeding five times the median absolute
deviation — and marks it `requiresJudgement: true` so the interface asks a
human what happened in that period.

**There is no published critical value for this rule, and the threshold above
is a surfacing heuristic rather than a test.** It is off unless explicitly
requested.

| Case | Expected | Result |
|---|---|---|
| Off by default | No candidate surfaced | pass |
| One wild point, detection on | One candidate, `requiresJudgement` true | pass |
| No standout point, detection on | Nothing surfaced | pass |

---

## Control chart limits

All limits are three sigma. Expected values below were derived **by hand from
the formulas**, and each case is constructed so the arithmetic is exact and
checkable with a calculator from the numbers given.

### c chart — counts over constant exposure

`cbar = mean(counts)`, `limits = cbar ± 3·√cbar`.

Counts `14,18,16,16,15,17,16,16,13,19,16,16` sum to **192**; `cbar = 192/12 =
16`; `√16 = 4`; limits `16 ± 12`.

| Quantity | Expected | Result |
|---|---|---|
| Centre line | 16 | pass |
| Upper | 28 | pass |
| Lower | 4 | pass |
| Limits flat across all points | yes | pass |
| `cbar = 2` (3√2 > 2) | Lower clamped to 0 | pass |

### p chart — proportion, constant denominator

`pbar = Σnumerator / Σdenominator`, `sigma_i = √(pbar(1−pbar)/n_i)`.

Numerators sum to **240** over 1,200: `pbar = 0.2`. With `n = 100`,
`sigma = √(0.2 × 0.8 / 100) = √0.0016 = 0.04`; limits `0.2 ± 0.12`.

| Quantity | Expected | Result |
|---|---|---|
| Centre line | 0.2 | pass |
| Sigma | 0.04 | pass |
| Upper / lower | 0.32 / 0.08 | pass |
| With `multiplier: 100` | 20, 32, 8 | pass |
| Plotted value derived from numerator ÷ denominator | Ignores a wrong stored value | pass |

### p chart — variable denominator, stepped limits

`pbar = 1500/3000 = 0.5`. For `n = 100`, `sigma = √(0.25/100) = 0.05`; for
`n = 400`, `sigma = √(0.25/400) = 0.025`.

| Quantity | Expected | Result |
|---|---|---|
| Limits at `n = 100` | 0.35 / 0.65 | pass |
| Limits at `n = 400` | 0.425 / 0.575 | pass |
| Width ratio | exactly 2 (= √(400/100)) | pass |

Flat limits on a variable denominator would be wrong, not a simplification: a
month of 95 discharges has more natural variation than a month of 127.

### p chart — pooled, not averaged

Points `(1, 100)` and `(9, 10)`. The proportions 0.01 and 0.9 average to
**0.455**; the pooled proportion is `10/110 = 0.0909…`

| Quantity | Expected | Result |
|---|---|---|
| Centre line | 0.0909… | pass |
| Centre line is *not* 0.455 | asserted | pass |

Averaging the proportions would let a subgroup of 10 outvote one of 100.

### p chart — clamping

`pbar = 24/1200 = 0.02`; `sigma = √(0.02 × 0.98/100) = √0.000196 = 0.014`;
`3σ = 0.042`, so the lower limit would be **−0.022**.

| Quantity | Expected | Result |
|---|---|---|
| Upper | 0.062 | pass |
| Lower | clamped to 0 | pass |
| `pbar = 0.98` | Upper clamped to 1 | pass |

A limit outside `[0, 1]` is not a limit; it is the normal approximation
failing near the boundary.

### u chart — counts per unit of exposure

`ubar = Σcounts / Σexposure`, `sigma_i = √(ubar/n_i)`.

`ubar = 300/1200 = 0.25`; with `n = 100`, `sigma = √0.0025 = 0.05`.

| Quantity | Expected | Result |
|---|---|---|
| Centre line / sigma | 0.25 / 0.05 | pass |
| Upper / lower | 0.40 / 0.10 | pass |
| Stepped: `n = 400` | 0.325 / 0.175 | pass |
| `ubar = 0.01`, `3σ = 0.03` | Lower clamped to 0 | pass |

### XmR — individuals and moving range

`CL = mean`, `limits = CL ± 2.660 · mRbar`, where 2.660 = 3/d₂ and d₂ = 1.128
for n = 2. Moving range chart `UCL = D₄ · mRbar`, D₄ = 3.267.

Values alternating 10 and 12: `mean = 11`, every moving range is 2, so
`mRbar = 2`; half-width `2.660 × 2 = 5.32`.

| Quantity | Expected | Result |
|---|---|---|
| Centre line | 11 | pass |
| Upper / lower | 16.32 / 5.68 | pass |
| Sigma consistent with limits (`CL + 3σ = UNPL`) | exact | pass |
| Moving range chart CL / UCL / LCL | 2 / 6.534 / 0 | pass |
| Flat series | No limits spread, no violations | pass |

Sigma is reported as one third of the limit distance so the Western Electric
zones agree exactly with the limits, rather than differing in the fourth
significant figure because of the published rounding of 2.660.

### Frozen baseline limits

Freezing the centre line freezes the **limits** with it. Computing sigma from
the whole series while drawing the centre line from a baseline produces a chart
whose line and limits describe different periods — worse than not offering the
option, because it looks correct.

| Case | Expected | Result |
|---|---|---|
| p chart, pooled 0.5, frozen at 0.2, n = 100 | sigma 0.04, limits 0.32 / 0.08 | pass |
| u chart, pooled 1.0, frozen at 0.25, n = 100 | sigma 0.05, limits 0.40 / 0.10 | pass |

*(This was a real defect, found by the demo-series test and fixed. The two
cases above are its regression tests.)*

---

## Western Electric supplementary rules

**Off by default.** Applying all of them alongside the run chart rules inflates
false signals on the short series trainee projects produce, and a chart that
signals constantly teaches people to ignore signals. The toggle is surfaced in
the chart view with a one-line explanation.

The basic rule — a point beyond the limits — is **not** supplementary and is
always evaluated.

Cases use a c chart frozen at 16, fixing sigma at 4, so the zones are exactly
20 (1σ), 24 (2σ) and 28 (3σ).

| Rule | Case | Expected | Result |
|---|---|---|---|
| — | Off by default | No `we_*` violations | pass |
| — | Basic rule still evaluated | Point beyond limits fires | pass |
| 2 of 3 beyond 2σ | 25, 26 consecutive | Fires, indices `[2,3]` | pass |
| 2 of 3 beyond 2σ | Only one point beyond | Does not fire | pass |
| 2 of 3 beyond 2σ | One above, one below | Does not fire (same side required) | pass |
| 4 of 5 beyond 1σ | 21, 22, 21, 22 | Fires, indices `[1,2,3,4]` | pass |
| 4 of 5 beyond 1σ | Three of five | Does not fire | pass |
| 8 on one side | Eight above | Fires, indices `[0..7]` | pass |
| 8 on one side | Seven above | Does not fire | pass |
| 8 on one side | 4 above, 1 on the line, 4 above | Fires as eight | pass |

Zones are evaluated against **each point's own sigma**, which is what makes the
rules correct on a stepped-limit chart. Tested directly: the same values fire
at `sigma = 0.025` and do not at `sigma = 0.05`.

---

## The seeded demo series

Pinned so the seed and the demo script cannot drift apart
(`tests/spc/demoSeries.test.ts`).

24 months of discharge summaries signed more than 48 hours after discharge,
with an intervention at month 13.

| Quantity | Expected | Result |
|---|---|---|
| Median | 26.75% | pass |
| Useful observations | 24 | pass |
| Shifts | Two, of 12 points each; second starts at index 12 | pass |
| Runs | 2 across 24 useful observations, against a lower limit of 8 | pass |
| Trend | One, of 5 points, across the step | pass |
| p-chart limits | Stepped; July 2025 (n=95) wider than April 2025 (n=127) | pass |

### A teaching case worth knowing about

The same data, analysed two defensible ways, gives opposite answers:

| Limits computed over | pbar | Points beyond limits |
|---|---|---|
| The whole 24-month series | 26.2% | **0 of 24** |
| The 12-month baseline only | 34.3% | **11 of 12** post-intervention |

Limits computed across the step change absorb it into the estimate of
variation, and the control chart shows nothing at all. Freeze them on the
baseline and the improvement is unmistakable.

The improvement did not change. The analyst's choice did. This is why limits
are frozen at an intervention rather than recomputed over it — and it is a good
five-minute teaching moment for a trainee, which is why it is seeded rather
than hypothetical.

It is also why the run chart is not redundant next to a control chart: the run
chart's shift rule detected this change regardless of how the limits were set.

---

## What is not validated here

- **The astronomical point threshold.** A surfacing heuristic with no published
  critical value, as stated above.
- **Rows n = 12 and n = 20 of the runs table.** Flagged above for a spot-check.
- **Normality and independence assumptions.** Control limits assume the
  observations within a subgroup are independent. Autocorrelated data — a
  measure carried over from month to month — will signal more often than it
  should. The engine does not test for this, and no engine can substitute for
  knowing where the numbers came from.
