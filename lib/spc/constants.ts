/**
 * Control chart constants.
 *
 * These are the only magic numbers in the engine, and each is stated with the
 * quantity it derives from so that a reviewer can check it rather than trust
 * it. See docs/VALIDATION.md.
 */

/**
 * d2 for a moving range of n = 2 successive values.
 *
 * Source: standard control chart constant, tabulated in Montgomery,
 * *Introduction to Statistical Quality Control*, and in Wheeler,
 * *Understanding Variation*.
 */
export const D2_N2 = 1.128;

/**
 * The individuals-chart limit multiplier, 3 / d2 for n = 2.
 *
 *   3 / 1.128 = 2.6595744...
 *
 * Published as 2.660, which is the value used here and the value a reader
 * will find in Wheeler. Using the unrounded quotient instead would shift
 * limits in the fourth significant figure and disagree with every printed
 * worked example, so the published rounding is deliberate.
 */
export const XMR_INDIVIDUALS_MULTIPLIER = 2.66;

/**
 * D4 for n = 2: the moving-range chart's upper limit multiplier.
 *
 * Source: standard control chart constant (Montgomery; Wheeler).
 */
export const MOVING_RANGE_D4_N2 = 3.267;

/**
 * Sigma multiplier for control limits. Three, by convention, on every chart
 * type here.
 */
export const SIGMA_MULTIPLIER = 3;

/** Run chart rule thresholds (Perla, Provost & Murray 2011). */
export const SHIFT_LENGTH = 6;
export const TREND_LENGTH = 5;
export const MINIMUM_RUN_CHART_POINTS = 12;

/** Western Electric supplementary rule thresholds. */
export const WE_EIGHT_ON_ONE_SIDE = 8;
