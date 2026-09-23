import type { ReactNode } from "react";
import type { ChartLayout, PlottedPoint } from "@/lib/charts/layout";
import { CHART_COLORS as C, CHART_FONT } from "@/lib/charts/palette";

/**
 * The chart itself: a pure function of a layout, with no hooks and no event
 * handlers. The interactive wrapper renders it in the browser; phase 9
 * rasterises exactly this markup to PNG for PDF exports, so a chart in a
 * report is the chart on screen (ADR-0006).
 *
 * Colours are literal (lib/charts/palette.ts) because a rasteriser has no
 * stylesheet. Encoding, per the dataviz rules:
 *   - one series, so no legend box; the title names it
 *   - solid hairline grid; dashed control limits (a threshold); centre line
 *     solid, dotted where a frozen baseline is extended
 *   - special cause: signal colour AND a different shape (diamond), so it
 *     never depends on colour vision
 *   - a pattern (shift, trend) is bracketed beneath the axis as well as
 *     coloured, for the same reason
 */
export function SpcChartSvg({
  layout,
  title,
  description,
  idPrefix,
  activeIndex = null,
  children,
}: {
  layout: ChartLayout;
  title: string;
  description: string;
  idPrefix: string;
  activeIndex?: number | null;
  /** Overlay drawn last, above everything: the interactive hit area. */
  children?: ReactNode;
}) {
  const { plot, compact } = layout;
  const tickSize = compact ? 10 : 11;
  const active = activeIndex !== null ? layout.points[activeIndex] : undefined;
  const halo = { stroke: C.surface, strokeWidth: 3, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
  const firstUpper = firstSegmentY(layout.upper?.path);
  const firstLower = firstSegmentY(layout.lower?.path);

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-labelledby={`${idPrefix}-title ${idPrefix}-desc`}
      fontFamily={CHART_FONT}
      className="block h-auto w-full font-mono"
      style={{ maxWidth: "100%" }}
    >
      <title id={`${idPrefix}-title`}>{title}</title>
      <desc id={`${idPrefix}-desc`}>{description}</desc>

      {/* Frozen baseline: a faint band behind the baseline periods. */}
      {layout.centre.frozenUntilX !== null && (
        <g aria-hidden="true">
          <rect
            x={plot.left}
            y={plot.top}
            width={Math.max(0, layout.centre.frozenUntilX - plot.left)}
            height={plot.bottom - plot.top}
            fill={C.sunken}
            opacity={0.55}
          />
          <text x={layout.centre.frozenUntilX - 4} y={plot.top + 11} textAnchor="end" fontSize={9} fill={C.ink} letterSpacing="0.08em" {...halo}>
            BASELINE
          </text>
        </g>
      )}

      {/* Grid and y axis */}
      <g aria-hidden="true">
        {layout.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} stroke={C.grid} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={plot.left - 6} y={t.y + 3.5} textAnchor="end" fontSize={tickSize} fill={C.muted}>
              {t.label}
            </text>
          </g>
        ))}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={C.muted} strokeWidth={1} shapeRendering="crispEdges" />
        {layout.xLabels.map((l) => (
          <g key={l.index}>
            <line
              x1={layout.points[l.index]?.x}
              x2={layout.points[l.index]?.x}
              y1={plot.bottom}
              y2={plot.bottom + 4}
              stroke={C.muted}
              strokeWidth={1}
            />
            <text x={l.x} y={layout.xAxisY} textAnchor={l.anchor} fontSize={tickSize} fill={C.muted}>
              {l.label}
            </text>
          </g>
        ))}
      </g>

      {/* Annotations: a numbered flag above the plot and a hairline down through it. */}
      <g aria-hidden="true">
        {layout.annotations.map((a) => (
          <g key={a.number}>
            <line x1={a.x} x2={a.x} y1={plot.top - 3} y2={plot.bottom} stroke={C.ink} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={a.x} cy={plot.top - 11} r={8} fill={C.ink} />
            <text x={a.x} y={plot.top - 7.5} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.surface}>
              {a.number}
            </text>
          </g>
        ))}
      </g>

      {/* Limits: thresholds, not data. Flat limits are dashed; stepped limits are
          a thin solid line, because a dash pattern restarting on every 12px step
          reads as noise at phone width. The steps themselves say "limit". */}
      <g aria-hidden="true" fill="none" stroke={C.muted}>
        {layout.upper && <path d={layout.upper.path} {...limitStroke(layout.upper.stepped)} />}
        {layout.lower && <path d={layout.lower.path} {...limitStroke(layout.lower.stepped)} />}
      </g>

      {/* Centre line; a frozen baseline is solid over the baseline and dotted where extended. */}
      <g aria-hidden="true" stroke={C.ink} strokeWidth={1.25} fill="none">
        {layout.centre.frozenUntilX === null ? (
          <line x1={plot.left} x2={plot.right} y1={layout.centre.y} y2={layout.centre.y} />
        ) : (
          <>
            <line x1={plot.left} x2={layout.centre.frozenUntilX} y1={layout.centre.y} y2={layout.centre.y} />
            <line x1={layout.centre.frozenUntilX} x2={plot.right} y1={layout.centre.y} y2={layout.centre.y} strokeDasharray="1.5 3" strokeLinecap="round" />
          </>
        )}
      </g>

      {/* The series */}
      <path d={layout.line} fill="none" stroke={C.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" />

      {/* Crosshair under the points, so the active point stays legible. */}
      {active && (
        <line x1={active.x} x2={active.x} y1={plot.top} y2={plot.bottom} stroke={C.ink} strokeWidth={1} aria-hidden="true" />
      )}

      <g aria-hidden="true">
        {layout.points.map((p) => (
          <Point key={p.index} point={p} />
        ))}
      </g>

      {active && (
        <circle cx={active.x} cy={active.y} r={8.5} fill="none" stroke={C.ink} strokeWidth={2} aria-hidden="true" />
      )}

      {/* Direct labels for the reference lines, at the right edge, haloed. */}
      <g aria-hidden="true" fontSize={tickSize} textAnchor="end">
        <text x={plot.right - 2} y={layout.centre.y - 5} fill={C.ink} {...halo}>
          {layout.centre.label}
        </text>
      </g>
      {/* Limit labels sit at the LEFT end: the special-cause points a limit
          exists to catch are usually late in the series, right where a
          right-hand label would cover them. */}
      <g aria-hidden="true" fontSize={tickSize} textAnchor="start" fill={C.muted}>
        {layout.upper && firstUpper !== null && (
          <text x={plot.left + 4} y={firstUpper - 5} {...halo}>
            {layout.upper.label}
          </text>
        )}
        {layout.lower && firstLower !== null && (
          <text x={plot.left + 4} y={firstLower + tickSize + 2} {...halo}>
            {layout.lower.label}
          </text>
        )}
      </g>

      {/* Pattern brackets beneath the axis. */}
      <g aria-hidden="true">
        {layout.brackets.map((b, i) => {
          const lineY = b.y + 13;
          const mid = (b.x1 + b.x2) / 2;
          return (
            <g key={`${b.rule}-${i}`}>
              <path
                d={`M${b.x1},${lineY - 4}V${lineY}H${b.x2}V${lineY - 4}`}
                fill="none"
                stroke={C.signal}
                strokeWidth={1.5}
              />
              <text x={mid} y={b.y + 9} textAnchor="middle" fontSize={10} fill={C.ink} {...halo}>
                {b.label}
              </text>
            </g>
          );
        })}
      </g>

      {children}
    </svg>
  );
}

function Point({ point }: { point: PlottedPoint }) {
  const ring = { stroke: C.surface, strokeWidth: 1.5 };
  switch (point.kind) {
    case "special": {
      const r = 6;
      return (
        <path
          d={`M${point.x},${point.y - r}L${point.x + r},${point.y}L${point.x},${point.y + r}L${point.x - r},${point.y}Z`}
          fill={C.signal}
          {...ring}
        />
      );
    }
    case "pattern":
      return <circle cx={point.x} cy={point.y} r={4.5} fill={C.signal} {...ring} />;
    case "judgement":
      return (
        <g>
          <circle cx={point.x} cy={point.y} r={7} fill="none" stroke={C.signal} strokeWidth={1.5} />
          <circle cx={point.x} cy={point.y} r={4} fill={C.primary} {...ring} />
        </g>
      );
    default:
      return <circle cx={point.x} cy={point.y} r={4} fill={C.primary} {...ring} />;
  }
}

/** The y where a limit path starts, for its label. */
function firstSegmentY(path: string | undefined): number | null {
  const y = path?.match(/^M[\d.-]+,([\d.-]+)/)?.[1];
  return y !== undefined ? Number(y) : null;
}

function limitStroke(stepped: boolean) {
  return stepped ? { strokeWidth: 1 } : { strokeWidth: 1.25, strokeDasharray: "5 4" };
}

/**
 * What each mark means, shown only for marks present on this chart. Not a
 * series legend (there is one series); a key to the encoding, so no reader
 * has to know SPC conventions or tell colours apart.
 */
export function ChartKey({ layout }: { layout: ChartLayout }) {
  const has = (kind: PlottedPoint["kind"]) => layout.points.some((p) => p.kind === kind);
  const items: Array<{ key: string; swatch: ReactNode; label: string }> = [
    ...(has("normal") ? [{ key: "point", swatch: <circle cx={8} cy={6} r={4} fill={C.primary} />, label: "Period" }] : []),
    {
      key: "centre",
      swatch:
        layout.centre.frozenUntilX === null ? (
          <line x1={0} x2={16} y1={6} y2={6} stroke={C.ink} strokeWidth={1.25} />
        ) : (
          <>
            <line x1={0} x2={8} y1={6} y2={6} stroke={C.ink} strokeWidth={1.25} />
            <line x1={8} x2={16} y1={6} y2={6} stroke={C.ink} strokeWidth={1.25} strokeDasharray="1.5 3" strokeLinecap="round" />
          </>
        ),
      label: layout.centre.frozenUntilX === null ? layout.centre.name : `${layout.centre.name}, frozen then extended`,
    },
  ];
  if (layout.upper) {
    items.push({
      key: "limits",
      swatch: layout.upper.stepped ? (
        <path d="M0 8H5V4H11V7H16" fill="none" stroke={C.muted} strokeWidth={1} />
      ) : (
        <line x1={0} x2={16} y1={6} y2={6} stroke={C.muted} strokeWidth={1.25} strokeDasharray="5 4" />
      ),
      label: layout.upper.stepped ? "Control limits (step with each month’s denominator)" : "Control limits",
    });
  }
  if (has("pattern")) {
    items.push({ key: "pattern", swatch: <circle cx={8} cy={6} r={4.5} fill={C.signal} />, label: "Part of a pattern (bracketed below)" });
  }
  if (has("special")) {
    items.push({ key: "special", swatch: <path d="M8 0L14 6L8 12L2 6Z" fill={C.signal} />, label: "Beyond a limit" });
  }
  if (has("judgement")) {
    items.push({
      key: "judgement",
      swatch: <circle cx={8} cy={6} r={5} fill="none" stroke={C.signal} strokeWidth={1.5} />,
      label: "Unusual — look into it",
    });
  }
  if (layout.annotations.length > 0) {
    items.push({
      key: "annotation",
      swatch: (
        <>
          <circle cx={8} cy={6} r={6} fill={C.ink} />
          <text x={8} y={9} textAnchor="middle" fontSize={8} fontWeight={600} fill={C.surface} fontFamily={CHART_FONT}>
            1
          </text>
        </>
      ),
      label: "Change made (listed below)",
    });
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Chart key">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" className="shrink-0">
            {item.swatch}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
