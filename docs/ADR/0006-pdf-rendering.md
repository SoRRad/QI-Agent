# 0006 — No headless Chrome in the runtime image; charts rasterised from the UI's own SVG

**Status:** accepted (phase 0; implemented phase 9)

## Decision

PDF documents render through a library with no headless-browser dependency.
Charts inside them are embedded as PNGs rasterised from **the same SVG the
interface renders**, so the chart in the PDF is identical in geometry to the
chart on screen.

One rendering path, two outputs. The chart component is the single source of
truth for what a chart looks like.

## Why

Two requirements that pull in opposite directions: the self-hosted image must
stay small and must download no binaries at build time, and a chart in a
committee's annual report must not look worse than the chart on screen.

Bundling Chromium satisfies the second and fails the first — it roughly
triples the image and adds a binary download to the build. Drawing charts twice
(once in SVG for the interface, once in a PDF drawing API) satisfies the first
and fails the second, in the specific way that matters: the two
implementations drift, and the drift is invisible until a program director
notices the report disagrees with the application.

Rasterising the UI's own SVG keeps one implementation and no browser.

## Rejected

- **Headless Chrome / Playwright in the runtime image.** Image size and a
  build-time binary download. Playwright stays a devDependency for tests only.
- **A separate PDF chart drawing implementation.** Two sources of truth for
  the most scrutinised artefact the system produces.
- **Vector-embedding the SVG directly into the PDF.** Cleaner in principle;
  rejected because SVG-to-PDF vector conversion handles fonts and
  `color-mix()` inconsistently, and a wrong-looking chart is worse than a
  raster one. Worth revisiting.

## Revisit when

A committee needs print-resolution vector charts, or the rasteriser proves
unreliable. Vector embedding is the upgrade, and it does not change the
component.
