import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { CHART_NAMES, describeChart, findings } from "@/lib/charts/describe";
import { layoutChart } from "@/lib/charts/layout";
import { studioChart, toObservations } from "@/lib/charts/studio";
import { loadProjectHeader } from "@/lib/projects/load";
import { SpcChartSvg } from "@/components/charts/SpcChartSvg";
import { MeasureForm } from "@/components/projects/IntakeForms";
import { Badge, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ProjectMeasuresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  const { project, canWork } = loaded;

  const measures = await db.measure.findMany({
    where: { projectId: id },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      chartType: true,
      basedOn: { select: { name: true, deprecated: true } },
      definitions: { orderBy: { version: "desc" }, take: 1, select: { version: true, reproducibilityConfirmedAt: true } },
      // Data points are the owning program's; they are only read when the
      // viewer may see them.
      dataPoints: canWork
        ? { orderBy: { periodIndex: "asc" }, select: { periodLabel: true, value: true, numerator: true, denominator: true } }
        : { take: 0, select: { periodLabel: true, value: true, numerator: true, denominator: true } },
      annotations: canWork ? { select: { label: true, periodIndex: true } } : { take: 0, select: { label: true, periodIndex: true } },
    },
  });
  const library = canWork
    ? await db.measure.findMany({ where: { isLibrary: true, deprecated: false }, orderBy: { name: "asc" }, select: { id: true, name: true, chartType: true } })
    : [];
  const types = new Set(measures.map((m) => m.type));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {(["outcome", "process", "balancing"] as const).map((t) => (
          <Badge key={t} tone={types.has(t) ? "confirm" : t === "balancing" ? "signal" : "neutral"}>
            {types.has(t) ? "✓" : "✗"} {t}
          </Badge>
        ))}
      </div>

      {measures.length === 0 && <EmptyState title="No measures yet">An outcome, a process and a balancing measure make a complete family.</EmptyState>}

      {measures.map((m) => {
        const chart = m.dataPoints.length > 0 ? studioChart(m.chartType, toObservations(m.dataPoints), { view: "run", baseline: null, westernElectric: false }) : null;
        const layout = chart ? layoutChart({ analysis: chart.analysis, unit: chart.unit, annotations: m.annotations, width: 640, height: 160 }) : null;
        const signals = chart ? findings(chart.analysis) : [];
        const definition = m.definitions[0];
        return (
          <PlotFrame
            key={m.id}
            label={`${m.type} · ${CHART_NAMES[m.chartType]}`}
            action={
              <Link href={`/charts/measures/${m.id}`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                Open in the studio
              </Link>
            }
          >
            <h2 className="text-base font-semibold text-ink">{m.name}</h2>
            <p className="mt-1 font-mono text-xs text-muted">
              {definition ? `definition v${definition.version}${definition.reproducibilityConfirmedAt ? " · reproducibility confirmed" : " · not yet checked"}` : "no operational definition yet"}
              {m.basedOn ? ` · library: ${m.basedOn.name}${m.basedOn.deprecated ? " (superseded)" : ""}` : ""}
            </p>
            {chart && layout ? (
              <div className="mt-3">
                <SpcChartSvg layout={layout} title={`${m.name}: run chart`} description={describeChart(chart.analysis, chart.unit)} idPrefix={`m-${m.id}`} />
                <p className="mt-2 text-sm text-muted">
                  {m.dataPoints.length} points ·{" "}
                  {signals.length ? (
                    <span className="font-medium text-signal">{signals.map((s) => s.title).join(", ")}</span>
                  ) : (
                    "no special-cause signal yet"
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">{canWork ? "No data points yet." : "Data points are visible to the owning program, its coach and the chair."}</p>
            )}
          </PlotFrame>
        );
      })}

      {canWork && project.status !== "archived" && project.status !== "complete" && (
        <PlotFrame label="Add a measure">
          <MeasureForm projectId={id} library={library} />
        </PlotFrame>
      )}
    </div>
  );
}
