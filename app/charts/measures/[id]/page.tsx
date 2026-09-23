import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CHART_NAMES, findings, pointReadout } from "@/lib/charts/describe";
import { provenance } from "@/lib/charts/provenance";
import { loadMeasure, measureName, MeasureNotFoundError } from "@/lib/charts/service";
import { baselineChoices, parseStudioParams, studioChart, toObservations } from "@/lib/charts/studio";
import { SpcChart } from "@/components/charts/SpcChart";
import { StudioControls } from "@/components/charts/StudioControls";
import { InterpretPanel } from "@/components/charts/InterpretPanel";
import { DeprecateForm, PromoteForm } from "@/components/charts/LibraryActions";
import { Badge, Banner, DataPair, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const name = await measureName((await params).id);
  return { title: name };
}

const CADENCE: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

function day(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function MeasureStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const { id } = await params;
  const search = await searchParams;

  let loaded;
  try {
    loaded = await loadMeasure(user, id);
  } catch (error) {
    if (error instanceof MeasureNotFoundError) notFound();
    throw error;
  }
  const { measure, points, annotations, canSeeData, canEdit } = loaded;
  const definition = measure.definitions[0] ?? null;
  const basePath = `/charts/measures/${measure.id}`;

  const studio = parseStudioParams(search, measure.chartType, points.length);
  const chart = points.length > 0 ? studioChart(measure.chartType, toObservations(points), studio) : null;
  const chartAnnotations = annotations.map((a) => ({ label: a.label, periodIndex: a.periodIndex, description: a.description }));
  const baselines = baselineChoices(annotations, points.length);
  const found = chart ? findings(chart.analysis) : [];
  const onChart = annotations.filter((a) => a.periodIndex !== null && a.periodIndex >= 1 && a.periodIndex <= points.length);
  const offChart = annotations.filter((a) => !onChart.includes(a));
  const superseded = measure.basedOn?.deprecated ? measure.basedOn : null;

  const replacements =
    user.role === "chair" && measure.isLibrary && !measure.deprecated
      ? await db.measure.findMany({
          where: { isLibrary: true, deprecated: false, id: { not: measure.id } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/charts" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Charts
        </Link>
      </nav>

      <div className="mb-5 flex flex-col gap-2">
        <span className="eyebrow">
          {measure.isLibrary ? "Library measure" : measure.project ? `Measure · ${measure.project.title}` : "Measure"}
        </span>
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{measure.name}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={measure.type === "balancing" ? "confirm" : "neutral"}>{measure.type}</Badge>
          <Badge tone="primary">{CHART_NAMES[measure.chartType]}</Badge>
          {measure.isLibrary && <Badge>library</Badge>}
          {measure.deprecated && <Badge tone="signal">superseded</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {measure.deprecated && measure.deprecatedAt && (
          <Banner tone="signal" title={`This definition was superseded on ${day(measure.deprecatedAt)}`}>
            {measure.deprecationNote}
            {measure.supersededBy && (
              <>
                {" "}
                Replaced by{" "}
                <Link href={`/charts/measures/${measure.supersededBy.id}`} className="text-primary underline underline-offset-2">
                  {measure.supersededBy.name}
                </Link>
                .
              </>
            )}
          </Banner>
        )}

        {superseded && superseded.deprecatedAt && (
          <Banner tone="signal" title={`The library definition behind this chart was superseded on ${day(superseded.deprecatedAt)}`}>
            <p>
              Built on &ldquo;{superseded.name}&rdquo;. {superseded.deprecationNote}
              {superseded.supersededBy && <> Replaced by &ldquo;{superseded.supersededBy.name}&rdquo;.</>}
            </p>
            <p className="mt-1">
              Points plotted here were measured under the old definition. Adding points measured under the new one to
              the same chart would change what it means; start a new measure instead.
            </p>
          </Banner>
        )}

        {!measure.isLibrary && !canSeeData && (
          <Banner title="Data points are restricted">
            Anyone can see what this project measures and how. Its data points and annotations are visible to the
            owning program, its coach and the chair.
          </Banner>
        )}

        {canSeeData && !chart && (
          <EmptyState
            title="No data points yet"
            action={
              canEdit ? (
                <Link href={`${basePath}/data`} className="inline-flex min-h-11 items-center bg-primary px-4 text-sm font-medium text-white hover:bg-ink">
                  Add data
                </Link>
              ) : undefined
            }
          >
            Enter points one at a time or upload a CSV. A run chart&rsquo;s rules need twelve points; it plots from the
            first.
          </EmptyState>
        )}

        {chart && (
          <>
            <PlotFrame
              label={`${CHART_NAMES[chart.kind]} · ${points.length} ${measure.definitions[0]?.cadence === "monthly" ? "months" : "periods"}`}
              action={
                canEdit ? (
                  <Link href={`${basePath}/data`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                    Add data
                  </Link>
                ) : undefined
              }
            >
              <div className="flex flex-col gap-4">
                <StudioControls basePath={basePath} chartType={measure.chartType} params={studio} baselines={baselines} />
                <SpcChart analysis={chart.analysis} unit={chart.unit} annotations={chartAnnotations} title={`${measure.name}: ${CHART_NAMES[chart.kind].toLowerCase()}`} />
                {chart.analysis.notes.length > 0 && (
                  <ul className="flex flex-col gap-1 border-t border-grid pt-3 text-xs leading-relaxed text-muted">
                    {chart.analysis.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </div>
            </PlotFrame>

            <PlotFrame label="Findings">
              {found.length === 0 ? (
                <p className="text-sm leading-relaxed text-ink" data-testid="no-findings">
                  No special-cause signals. The variation so far is consistent with common cause — on a short series a
                  real improvement often produces no signal yet, so keep plotting and annotate each change.
                </p>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="findings">
                  {found.map((f) => (
                    <li key={`${f.rule}-${f.periods}`} className="flex gap-2.5">
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="mt-1 shrink-0">
                        {f.judgement ? (
                          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-signal" />
                        ) : (
                          <path d="M6 0L12 6L6 12L0 6Z" className="fill-signal" />
                        )}
                      </svg>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          {f.judgement ? `${f.title} — a judgement, not a test` : f.title}
                          {f.periods && <span className="font-normal text-muted"> {f.periods}</span>}
                        </p>
                        {f.details.length === 1 ? (
                          <p className="mt-0.5 text-sm leading-relaxed text-muted">{f.details[0]}</p>
                        ) : (
                          <details className="mt-0.5 text-sm text-muted">
                            <summary className="cursor-pointer text-primary">Each point ({f.details.length})</summary>
                            <ul className="mt-1 flex flex-col gap-1 leading-relaxed">
                              {f.details.map((d, i) => (
                                <li key={i}>{d}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </PlotFrame>

            <PlotFrame label="Explain">
              <InterpretPanel
                key={`${studio.view}-${studio.baseline}-${studio.westernElectric}`}
                measureId={measure.id}
                view={studio.view}
                baseline={studio.baseline === null ? "" : String(studio.baseline)}
                we={studio.westernElectric ? "on" : ""}
              />
            </PlotFrame>
          </>
        )}

        {canSeeData && annotations.length > 0 && (
          <PlotFrame label="Changes made">
            <ol className="flex flex-col gap-3">
              {onChart.map((a, i) => (
                <li key={a.id} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-xs font-semibold text-surface" aria-label={`Change ${i + 1}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{a.label}</p>
                    <p className="font-mono text-xs text-muted">{points[(a.periodIndex as number) - 1]?.periodLabel} · {day(a.date)}</p>
                    {a.description && <p className="mt-1 text-sm leading-relaxed text-muted">{a.description}</p>}
                  </div>
                </li>
              ))}
              {offChart.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="size-6 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{a.label}</p>
                    <p className="font-mono text-xs text-muted">{day(a.date)} · not tied to a plotted period</p>
                  </div>
                </li>
              ))}
            </ol>
          </PlotFrame>
        )}

        {chart && (
          <PlotFrame label="Behind the chart">
            <div className="flex flex-col gap-3">
              <details>
                <summary className="cursor-pointer text-sm font-medium text-primary">Data table ({points.length} periods)</summary>
                <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Data table, scrollable">
                  <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
                    <caption className="sr-only">
                      {measure.name}: every plotted value with its centre line, limits and signals
                    </caption>
                    <thead>
                      <tr className="border-b border-grid">
                        <th scope="col" className="py-1.5 pr-3 font-mono font-medium text-muted">Period</th>
                        {measure.chartType === "p" || measure.chartType === "u" ? (
                          <th scope="col" className="py-1.5 pr-3 text-right font-mono font-medium text-muted">Counts</th>
                        ) : null}
                        <th scope="col" className="py-1.5 pr-3 text-right font-mono font-medium text-muted">Value</th>
                        <th scope="col" className="py-1.5 pr-3 text-right font-mono font-medium text-muted">Centre</th>
                        {chart.analysis.limits.upper && (
                          <th scope="col" className="py-1.5 pr-3 text-right font-mono font-medium text-muted">Limits</th>
                        )}
                        <th scope="col" className="py-1.5 font-mono font-medium text-muted">Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((p, i) => {
                        const r = pointReadout(chart.analysis, chart.unit, i);
                        if (!r) return null;
                        return (
                          <tr key={p.periodIndex} className="border-b border-grid/70">
                            <th scope="row" className="py-1.5 pr-3 font-mono font-normal text-ink">{r.period}</th>
                            {measure.chartType === "p" || measure.chartType === "u" ? (
                              <td className="py-1.5 pr-3 text-right font-mono text-muted">{r.counts}</td>
                            ) : null}
                            <td className="py-1.5 pr-3 text-right font-mono font-semibold text-ink">{r.value}</td>
                            <td className="py-1.5 pr-3 text-right font-mono text-muted">{r.centreValue}</td>
                            {chart.analysis.limits.upper && (
                              <td className="py-1.5 pr-3 text-right font-mono text-muted">{r.limits}</td>
                            )}
                            <td className={r.rules.length ? "py-1.5 font-medium text-signal" : "py-1.5 text-muted"}>
                              {r.rules.join(", ") || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>

              <details data-testid="provenance">
                <summary className="cursor-pointer text-sm font-medium text-primary">Where these numbers come from</summary>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Every number on this chart is computed by a tested, deterministic function in lib/spc. No language model
                  is involved. docs/VALIDATION.md lists the published examples each function is tested against.
                </p>
                <dl className="mt-2 flex flex-col divide-y divide-grid border-y border-grid">
                  {provenance(chart.analysis, { measureChartType: measure.chartType, unit: chart.unit, westernElectric: studio.westernElectric }).map((row) => (
                    <div key={row.quantity} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
                      <dt className="eyebrow pt-0.5">{row.quantity}</dt>
                      <dd className="min-w-0 text-xs leading-relaxed text-ink">
                        <span className="font-mono font-semibold">{row.value}</span>
                        <span className="block break-words font-mono text-muted">{row.computedBy}</span>
                        <span className="block text-muted">
                          {row.file} · over {row.over}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          </PlotFrame>
        )}

        <PlotFrame
          label={definition ? `Operational definition · version ${definition.version}` : "Operational definition"}
          action={
            canEdit ? (
              <Link href={`${basePath}/definition`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                {definition ? "New version" : "Write it"}
              </Link>
            ) : undefined
          }
        >
          {definition ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <DataPair label="Numerator" value={definition.numerator} />
                <DataPair label="Denominator" value={definition.denominator} />
                <DataPair label="Inclusions" value={definition.inclusions} />
                <DataPair label="Exclusions" value={definition.exclusions} />
                <DataPair label="Data source" value={definition.dataSource} />
                <DataPair label="Who pulls it" value={definition.puller} />
                <DataPair label="Cadence" value={CADENCE[definition.cadence] ?? definition.cadence} />
                <DataPair
                  label="Reproducibility"
                  value={
                    definition.reproducibilityConfirmedAt ? (
                      <span className="text-confirm">Confirmed {day(definition.reproducibilityConfirmedAt)}</span>
                    ) : (
                      <span className="text-muted">Not yet checked</span>
                    )
                  }
                />
              </div>
              <div className="flex flex-col gap-2 border-t border-grid pt-3 sm:flex-row sm:flex-wrap">
                {canEdit && !definition.reproducibilityConfirmedAt && (
                  <Link href={`${basePath}/definition#check`} className="inline-flex min-h-11 items-center justify-center border border-grid bg-surface px-4 text-sm font-medium text-ink hover:border-muted">
                    Check reproducibility
                  </Link>
                )}
                {canEdit && (
                  <Link href={`${basePath}/request`} className="inline-flex min-h-11 items-center justify-center border border-grid bg-surface px-4 text-sm font-medium text-ink hover:border-muted">
                    Write a data request
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              No definition yet. A chart without one cannot be reproduced by the next resident, so the builder asks for
              all seven parts before it will save.
            </p>
          )}
        </PlotFrame>

        {measure.isLibrary && (
          <PlotFrame label="Library">
            <p className="text-sm text-ink">
              Used by {measure._count.derivedMeasures} project {measure._count.derivedMeasures === 1 ? "measure" : "measures"}.
            </p>
            {user.role === "chair" && !measure.deprecated && (
              <div className="mt-4 border-t border-grid pt-4">
                <DeprecateForm measureId={measure.id} replacements={replacements} />
              </div>
            )}
          </PlotFrame>
        )}

        {!measure.isLibrary && (measure.basedOn || user.role === "chair") && (
          <PlotFrame label="Library">
            {measure.basedOn ? (
              <p className="text-sm text-ink">
                Built on the library definition{" "}
                <Link href={`/charts/measures/${measure.basedOn.id}`} className="text-primary underline underline-offset-2">
                  {measure.basedOn.name}
                </Link>
                .
              </p>
            ) : definition ? (
              <PromoteForm measureId={measure.id} measureName={measure.name} />
            ) : (
              <p className="text-sm text-muted">A measure needs an operational definition before it can be promoted.</p>
            )}
          </PlotFrame>
        )}
      </div>
    </>
  );
}
