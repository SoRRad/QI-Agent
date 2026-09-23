import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { CHART_NAMES } from "@/lib/charts/describe";
import { Badge, Banner, DataPair, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { CHART_SECTIONS, SectionTabs } from "@/components/ui/SectionTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Charts" };

export default async function ChartsPage() {
  await getCurrentUser();

  const [libraryMeasures, projectMeasures] = await Promise.all([
    db.measure.findMany({
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
        _count: { select: { derivedMeasures: true } },
      },
    }),
    db.measure.findMany({
      where: { isLibrary: false },
      orderBy: [{ project: { title: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        chartType: true,
        project: { select: { title: true } },
        basedOn: { select: { deprecated: true } },
        _count: { select: { dataPoints: true } },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Charts"
        title="Measures and SPC studio"
        lede="Every median, control limit and rule evaluation is computed in deterministic code tested against published worked examples. A model may explain a chart; it never produces a number that appears on one."
      />
      <SectionTabs label="Charts sections" current="measures" items={CHART_SECTIONS} />

      <div className="flex flex-col gap-4">
        <PlotFrame label="Project measures">
          <ul className="divide-y divide-grid">
            {projectMeasures.map((m) => (
              <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/charts/measures/${m.id}`} className="min-w-0 text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                  <span className="flex shrink-0 gap-1.5">
                    <Badge tone={m.type === "balancing" ? "confirm" : "neutral"}>{m.type}</Badge>
                    <Badge tone="primary">{m.chartType}</Badge>
                    {m.basedOn?.deprecated && <Badge tone="signal">definition superseded</Badge>}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
                  <DataPair label="Project" value={m.project?.title ?? "—"} />
                  <DataPair label="Points" value={m._count.dataPoints} mono />
                </div>
              </li>
            ))}
          </ul>
        </PlotFrame>

        <PlotFrame label="Institution-wide measure library">
          <p className="text-sm leading-relaxed text-muted">
            Shared definitions exist so programs do not each define &ldquo;readmission&rdquo; differently. A
            superseded definition is never edited in place, because that would silently change the meaning of every
            chart built on it. The chair promotes a project&rsquo;s measure into the library from its studio page.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {libraryMeasures.map((m) => (
              <li key={m.id} className="border-t border-grid pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/charts/measures/${m.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                  <span className="flex gap-1.5">
                    <Badge tone="neutral">{m.type}</Badge>
                    <Badge tone="primary">{CHART_NAMES[m.chartType]}</Badge>
                    {m.deprecated && <Badge tone="signal">superseded</Badge>}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Used by {m._count.derivedMeasures} project {m._count.derivedMeasures === 1 ? "measure" : "measures"}
                </p>
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
      </div>
    </>
  );
}
