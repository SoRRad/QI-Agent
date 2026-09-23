/**
 * Chart colours as literal hex, mirroring the tokens in app/globals.css.
 *
 * Literal rather than CSS variables because the same SVG is rasterised to PNG
 * for PDF exports (ADR-0006), where no stylesheet exists. tests/charts
 * asserts these match globals.css so the two cannot drift.
 *
 * Validated with the dataviz palette checker: primary against signal is
 * distinguishable under deuteranopia, protanopia and tritanopia (ΔE 10.9), and
 * a special-cause point differs in SHAPE as well as colour, so identity is
 * never carried by colour alone.
 */
export const CHART_COLORS = {
  paper: "#edf1f2",
  surface: "#f7f9fa",
  sunken: "#e4eaec",
  grid: "#d9e1e4",
  ink: "#16232e",
  muted: "#5a6e7a",
  primary: "#1d3f57",
  signal: "#9e3b2f",
  confirm: "#2f6b54",
} as const;

export const CHART_FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
