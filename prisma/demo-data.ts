/**
 * Demo series used by both the seed and the SPC test suite.
 *
 * Shared deliberately: a copy in the test file would let the seeded data and
 * the test that proves it fires drift apart, and the whole point of this
 * series is that the engine visibly signals on it during a demo.
 */

export interface DemoPoint {
  label: string;
  den: number;
  num: number;
}

/**
 * 24 months of discharge summaries signed more than 48 hours after discharge,
 * with a genuine step change at month 13.
 *
 * Verified against a median of 26.749% to fire three run chart rules:
 *   - shift: 12 consecutive points above the median, then 12 below
 *   - too few runs: 2 runs across 24 useful observations
 *   - trend: 5 consecutive decreasing points across the step change
 *
 * Denominators vary deliberately, so the p-chart produces stepped control
 * limits rather than flat ones.
 */
export const DISCHARGE_SERIES: readonly DemoPoint[] = [
  { label: "Oct 2024", den: 112, num: 39 },
  { label: "Nov 2024", den: 104, num: 34 },
  { label: "Dec 2024", den: 121, num: 43 },
  { label: "Jan 2025", den: 98, num: 31 },
  { label: "Feb 2025", den: 116, num: 42 },
  { label: "Mar 2025", den: 109, num: 36 },
  { label: "Apr 2025", den: 127, num: 45 },
  { label: "May 2025", den: 103, num: 32 },
  { label: "Jun 2025", den: 118, num: 41 },
  { label: "Jul 2025", den: 95, num: 34 },
  { label: "Aug 2025", den: 113, num: 37 },
  { label: "Sep 2025", den: 121, num: 44 },
  { label: "Oct 2025", den: 107, num: 24 },
  { label: "Nov 2025", den: 115, num: 23 },
  { label: "Dec 2025", den: 99, num: 19 },
  { label: "Jan 2026", den: 122, num: 22 },
  { label: "Feb 2026", den: 108, num: 21 },
  { label: "Mar 2026", den: 113, num: 19 },
  { label: "Apr 2026", den: 101, num: 18 },
  { label: "May 2026", den: 119, num: 20 },
  { label: "Jun 2026", den: 106, num: 17 },
  { label: "Jul 2026", den: 124, num: 22 },
  { label: "Aug 2026", den: 97, num: 16 },
  { label: "Sep 2026", den: 111, num: 18 },
] as const;

/** Routine laboratory draws per patient-day: a u-chart series. */
export const LAB_SERIES: ReadonlyArray<{ label: string; count: number; days: number }> = [
  { label: "Jan 2025", count: 1042, days: 452 },
  { label: "Feb 2025", count: 958, days: 418 },
  { label: "Mar 2025", count: 1101, days: 476 },
  { label: "Apr 2025", count: 995, days: 441 },
  { label: "May 2025", count: 1038, days: 463 },
  { label: "Jun 2025", count: 902, days: 428 },
  { label: "Jul 2025", count: 744, days: 455 },
  { label: "Aug 2025", count: 688, days: 437 },
  { label: "Sep 2025", count: 651, days: 449 },
  { label: "Oct 2025", count: 672, days: 468 },
  { label: "Nov 2025", count: 617, days: 431 },
  { label: "Dec 2025", count: 634, days: 446 },
] as const;

/**
 * Monthly 30-day readmission on the Hospitalist service, built on the 2024
 * library definition that the committee later SUPERSEDED. Seeded so the
 * deprecation banner (addition C3) is visible in a demo rather than
 * theoretical: a chart whose meaning changed underneath it.
 */
export const READMISSION_SERIES: ReadonlyArray<{ label: string; readmitted: number; discharges: number }> = [
  { label: "Oct 2025", readmitted: 17, discharges: 112 },
  { label: "Nov 2025", readmitted: 15, discharges: 104 },
  { label: "Dec 2025", readmitted: 19, discharges: 121 },
  { label: "Jan 2026", readmitted: 14, discharges: 98 },
  { label: "Feb 2026", readmitted: 18, discharges: 116 },
  { label: "Mar 2026", readmitted: 16, discharges: 109 },
  { label: "Apr 2026", readmitted: 20, discharges: 127 },
  { label: "May 2026", readmitted: 15, discharges: 103 },
  { label: "Jun 2026", readmitted: 17, discharges: 118 },
  { label: "Jul 2026", readmitted: 13, discharges: 95 },
  { label: "Aug 2026", readmitted: 16, discharges: 113 },
  { label: "Sep 2026", readmitted: 18, discharges: 121 },
] as const;

/**
 * The institution's headline trainee-sensitive measure, which opens the chair
 * dashboard (§7): discharge summaries signed more than 48 hours after
 * discharge, across all inpatient services — the measure the flagship project
 * moved on one service and the committee then adopted institution-wide.
 *
 * Thirteen months at a baseline near 31%, then a step down after the
 * committee adopted huddle drafting as an institutional standard (Nov 2025).
 * Verified in tests/committee to fire a shift on the run chart.
 */
export const INSTITUTION_SERIES: readonly DemoPoint[] = [
  { label: "Oct 2024", den: 2410, num: 752 },
  { label: "Nov 2024", den: 2355, num: 721 },
  { label: "Dec 2024", den: 2502, num: 790 },
  { label: "Jan 2025", den: 2468, num: 760 },
  { label: "Feb 2025", den: 2298, num: 709 },
  { label: "Mar 2025", den: 2531, num: 797 },
  { label: "Apr 2025", den: 2444, num: 745 },
  { label: "May 2025", den: 2489, num: 781 },
  { label: "Jun 2025", den: 2376, num: 732 },
  { label: "Jul 2025", den: 2420, num: 770 },
  { label: "Aug 2025", den: 2455, num: 752 },
  { label: "Sep 2025", den: 2398, num: 736 },
  { label: "Oct 2025", den: 2472, num: 771 },
  { label: "Nov 2025", den: 2430, num: 689 },
  { label: "Dec 2025", den: 2517, num: 641 },
  { label: "Jan 2026", den: 2446, num: 598 },
  { label: "Feb 2026", den: 2311, num: 551 },
  { label: "Mar 2026", den: 2503, num: 590 },
  { label: "Apr 2026", den: 2462, num: 571 },
  { label: "May 2026", den: 2480, num: 580 },
  { label: "Jun 2026", den: 2391, num: 548 },
  { label: "Jul 2026", den: 2437, num: 563 },
  { label: "Aug 2026", den: 2468, num: 551 },
  { label: "Sep 2026", den: 2420, num: 540 },
];
