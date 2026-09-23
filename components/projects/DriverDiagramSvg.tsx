import type { DiagramLayout } from "@/lib/projects/drivers";
import { CHART_COLORS as C, CHART_FONT } from "@/lib/charts/palette";

/**
 * The driver diagram as SVG: a pure function of its layout, with literal
 * colours and fonts so the same markup rasterises to PNG without a
 * stylesheet. The aim is drawn in ink, drivers on the surface, change ideas
 * with a primary rule down their left edge: three levels, told apart by more
 * than colour.
 */
export function DriverDiagramSvg({ layout, title, id }: { layout: DiagramLayout; title: string; id?: string }) {
  const margin = 12;
  const width = layout.width + margin * 2;
  const height = layout.height + margin * 2;
  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      fontFamily={CHART_FONT}
      style={{ background: C.surface }}
    >
      <rect width={width} height={height} fill={C.surface} />
      <g transform={`translate(${margin},${margin})`}>
        {layout.columns.map((c) => (
          <text key={c.label} x={c.x} y={14} fontSize={10} letterSpacing="0.08em" fill={C.muted}>
            {c.label.toUpperCase()}
          </text>
        ))}
        {layout.links.map((l) => (
          <path key={`${l.from}-${l.to}`} d={l.path} fill="none" stroke={C.muted} strokeWidth={1.25} />
        ))}
        {layout.boxes.map((b) => {
          const aim = b.kind === "aim";
          return (
            <g key={b.id}>
              <rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                fill={aim ? C.ink : b.kind === "change" ? C.paper : C.surface}
                stroke={aim ? C.ink : C.grid}
                strokeWidth={1}
              />
              {b.kind === "change" && <rect x={b.x} y={b.y} width={3} height={b.height} fill={C.primary} />}
              {b.kind === "primary" && <rect x={b.x} y={b.y} width={b.width} height={3} fill={C.primary} />}
              {b.lines.map((line, i) => (
                <text key={i} x={b.x + 10} y={b.y + 10 + 11 + i * 15} fontSize={11.5} fill={aim ? C.surface : C.ink}>
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
