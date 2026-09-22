"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { describeChart, pointReadout, readoutSentence } from "@/lib/charts/describe";
import { layoutChart, type ChartAnnotation } from "@/lib/charts/layout";
import type { SpcAnalysis } from "@/lib/spc";
import { ChartKey, SpcChartSvg } from "./SpcChartSvg";

/**
 * The interactive chart: measures its container, lays the chart out for that
 * width, and adds a crosshair with a readout.
 *
 * Pointer: the crosshair snaps to the nearest period anywhere across the plot,
 * so a finger does not need to hit a 8px point. Keyboard: the chart is one tab
 * stop; arrow keys move between periods, Home and End jump to the ends,
 * Escape clears. Each move is announced, so a screen reader user gets exactly
 * the readout a sighted user sees in the tooltip.
 *
 * Until the container has been measured (server render, first paint) the
 * chart is laid out at a default width and scaled by its viewBox.
 */
export function SpcChart({
  analysis,
  unit,
  annotations,
  title,
}: {
  analysis: SpcAnalysis;
  unit: string;
  annotations: ChartAnnotation[];
  title: string;
}) {
  const id = `chart${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(280, Math.floor(element.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutChart({ analysis, unit, annotations, width: width ?? 720 }),
    [analysis, unit, annotations, width],
  );
  const description = useMemo(() => describeChart(analysis, unit), [analysis, unit]);
  const n = layout.points.length;
  const readout = active !== null ? pointReadout(analysis, unit, active) : null;
  const point = active !== null ? layout.points[active] : undefined;

  function indexAt(event: PointerEvent<SVGRectElement>): number {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || n === 0) return 0;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * layout.width;
    return Math.min(n - 1, Math.max(0, Math.floor((x - layout.plot.left) / (layout.step || 1))));
  }

  function move(next: number) {
    const clamped = Math.min(n - 1, Math.max(0, next));
    setActive(clamped);
    const r = pointReadout(analysis, unit, clamped);
    if (r) setAnnouncement(readoutSentence(r, { index: clamped, total: n }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (n === 0) return;
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(active === null ? 0 : active + 1),
      ArrowDown: () => move(active === null ? 0 : active + 1),
      ArrowLeft: () => move(active === null ? n - 1 : active - 1),
      ArrowUp: () => move(active === null ? n - 1 : active - 1),
      Home: () => move(0),
      End: () => move(n - 1),
      Escape: () => {
        setActive(null);
        setAnnouncement("");
      },
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }

  // Tooltip position in CSS pixels relative to the container: beside the
  // point, flipped to the left in the right half so it never leaves the chart.
  const scale = width ? width / layout.width : 1;
  const tipLeft = point ? point.x * scale : 0;
  const flip = point ? point.x > layout.width / 2 : false;

  return (
    <div className="relative">
      <div
        ref={container}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive chart"
        aria-label={`${title}. Use the arrow keys to read each period.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="relative outline-offset-4"
        data-testid="spc-chart"
      >
        <SpcChartSvg layout={layout} title={title} description={description} idPrefix={id} activeIndex={active}>
          <rect
            x={layout.plot.left}
            y={0}
            width={Math.max(0, layout.plot.right - layout.plot.left)}
            height={layout.height}
            fill="transparent"
            style={{ touchAction: "pan-y", cursor: "crosshair" }}
            onPointerMove={(e) => setActive(indexAt(e))}
            onPointerDown={(e) => setActive(indexAt(e))}
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
            aria-hidden="true"
          />
        </SpcChartSvg>

        {readout && point && (
          <div
            className="pointer-events-none absolute z-10 w-max max-w-[15rem] border border-grid bg-surface px-3 py-2 text-xs shadow-sm"
            style={{
              top: Math.max(0, point.y * scale - 12),
              ...(flip ? { right: `calc(100% - ${tipLeft - 14}px)` } : { left: tipLeft + 14 }),
            }}
            aria-hidden="true"
            data-testid="chart-tooltip"
          >
            <p className="eyebrow">{readout.period}</p>
            <p className="mt-1 font-mono text-base font-semibold text-ink" data-numeric="">
              {readout.value}
            </p>
            {readout.counts && <p className="font-mono text-muted" data-numeric="">{readout.counts}</p>}
            <p className="mt-1 font-mono text-muted" data-numeric="">{readout.centre}</p>
            {readout.limits && <p className="font-mono text-muted" data-numeric="">Limits {readout.limits}</p>}
            {readout.rules.length > 0 && (
              <p className="mt-1 flex items-center gap-1.5 font-medium text-signal">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M5 0L10 5L5 10L0 5Z" fill="currentColor" />
                </svg>
                {readout.rules.join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>

      <ChartKey layout={layout} />

      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="chart-announcement">
        {announcement}
      </p>
    </div>
  );
}
