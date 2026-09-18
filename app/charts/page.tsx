import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Badge, Banner, DataPair, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { PhaseNote } from "@/components/ui/PhaseNote";

export const dynamic = "force-dynamic";

export default async function ChartsPage() {
  await getCurrentUser();

  const libraryMeasures = await db.measure.findMany({
    where: { isLibrary: true },
    orderBy: [{ deprecated: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      chartType: true,
      deprecated: true,
      deprecationNote: true,
      supersededBy: { select: { name: true } },
      definitions: { orderBy: { version: "desc" }, take: 1, select: { version: true, cadence: true } },
    },
  });

  const projectMeasures = await db.measure.findMany({
    where: { isLibrary: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      chartType: true,
      project: { select: { title: true } },
      _count: { select: { dataPoints: true } },
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Charts"
        title="Measures and SPC studio"
        lede="Every median, control limit and rule evaluation is computed in deterministic code with unit tests against published worked examples. A model may explain a chart; it never produces a number that appears on one."
      />

      <div className="flex flex-col gap-4">
        <PhaseNote phase="1 and 4">
          Phase 1 builds the statistics engine with its published-example test
          suite, before any chart UI exists. Phase 4 builds the SPC studio, the
          chart-type advisor, the operational definition builder and the data
          request generator.
        </PhaseNote>

        <PlotFrame label="Institution-wide measure library">
          <p className="text-sm leading-relaxed text-muted">
            Shared definitions exist so programs do not each define
            &ldquo;readmission&rdquo; differently. A superseded definition is
            never edited in place, because that would silently change the
            meaning of every chart built on it.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {libraryMeasures.map((m) => (
              <li key={m.id} className="border-t border-grid pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{m.name}</span>
                  <span className="flex gap-1.5">
                    <Badge tone="neutral">{m.type}</Badge>
                    <Badge tone="primary">{m.chartType}-chart</Badge>
                    {m.deprecated && <Badge tone="signal">superseded</Badge>}
                  </span>
                </div>
                {m.deprecated && (
                  <div className="mt-2">
                    <Banner tone="signal" title="Charts built on this definition changed meaning">
                      {m.deprecationNote}
                      {m.supersededBy && ` Replaced by: ${m.supersededBy.name}.`}
                    </Banner>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </PlotFrame>

        <PlotFrame label="Project measures">
          <ul className="divide-y divide-grid">
            {projectMeasures.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 text-sm text-ink">{m.name}</span>
                  <span className="flex shrink-0 gap-1.5">
                    <Badge tone={m.type === "balancing" ? "confirm" : "neutral"}>{m.type}</Badge>
                    <Badge tone="primary">{m.chartType}</Badge>
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <DataPair label="Project" value={m.project?.title ?? "—"} />
                  <DataPair label="Data points" value={m._count.dataPoints} mono />
                </div>
              </li>
            ))}
          </ul>
        </PlotFrame>
      </div>
    </>
  );
}
