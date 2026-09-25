import Link from "next/link";
import { CHART_NAMES, describeChart, findings } from "@/lib/charts/describe";
import { dashboard } from "@/lib/committee/services/dashboard";
import { SpcChart } from "@/components/charts/SpcChart";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { Badge, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Committee" };

const days = (from: Date) => Math.floor((Date.now() - from.getTime()) / 86_400_000);

export default async function CommitteePage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const d = await dashboard(user);
  const headlineFindings = d.headline ? findings(d.headline.chart.analysis) : [];

  return (
    <>
      <CommitteeHeader user={user} current="dashboard" title="Chair dashboard" />

      <div className="flex flex-col gap-4">
        {/* The signature element (§7): the headline measure, annotated with
            the committee's interventions, before anything else. */}
        {d.headline ? (
          <PlotFrame
            label="Headline measure · run chart"
            action={
              <Link href={`/charts/measures/${d.headline.id}`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                Open in the studio
              </Link>
            }
          >
            <section aria-labelledby="headline-title" data-testid="headline-chart">
              <h2 id="headline-title" className="text-base font-semibold text-ink sm:text-lg">
                {d.headline.name}
              </h2>
              <p className="mt-1 font-mono text-xs text-muted" data-numeric="">
                {d.headline.points} months · {d.headline.annotations.length} committee annotation
                {d.headline.annotations.length === 1 ? "" : "s"}
                {d.headline.baseline !== null ? ` · median frozen on the ${d.headline.baseline} months before the first intervention` : ""}
              </p>
              <div className="mt-3">
                <SpcChart analysis={d.headline.chart.analysis} unit={d.headline.chart.unit} annotations={d.headline.annotations} title={`${d.headline.name}: run chart`} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink">{describeChart(d.headline.chart.analysis, d.headline.chart.unit)}</p>
              {headlineFindings.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {headlineFindings.map((f, i) => (
                    <li key={`${f.title}-${i}`}>
                      <Badge tone="signal">{f.title}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {d.headline.annotations.length > 0 && (
                <ol className="mt-3 flex flex-col gap-1 border-t border-grid pt-3 text-sm text-ink" aria-label="Committee interventions on the chart">
                  {d.headline.annotations.map((a) => (
                    <li key={a.label}>
                      <span className="font-mono text-xs text-muted">
                        {a.periodIndex !== null ? `${d.headline!.chart.analysis.observations[a.periodIndex - 1]?.label ?? `period ${a.periodIndex}`} · ` : ""}
                      </span>
                      {a.label}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </PlotFrame>
        ) : (
          <EmptyState title="No headline measure yet">
            The chair sets one institution-level measure from the measure library as the headline. It opens this page as an annotated run chart.
          </EmptyState>
        )}

        {d.others.map((m) => (
          <PlotFrame key={m.id} label={`Institution measure · ${CHART_NAMES.run.toLowerCase()}`}>
            <h2 className="text-base font-semibold text-ink">{m.name}</h2>
            <div className="mt-3">
              <SpcChart analysis={m.chart.analysis} unit={m.chart.unit} annotations={m.annotations} title={`${m.name}: run chart`} />
            </div>
          </PlotFrame>
        ))}

        <PlotFrame label="Pulse response rate">
          {d.pulseChart ? (
            <SpcChart analysis={d.pulseChart.analysis} unit={d.pulseChart.unit} annotations={[]} title="Pulse survey response rate by quarter: run chart" />
          ) : (
            <p className="text-sm leading-relaxed text-muted">One quarter is not a trend: the response rate is plotted as a run chart from the second survey.</p>
          )}
          {d.pulse.length > 0 && (
            <table className="mt-3 w-full text-left text-sm" data-testid="pulse-rates">
              <caption className="sr-only">Pulse response rate by quarter</caption>
              <thead className="font-mono text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-normal">
                    Quarter
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-normal">
                    Responded
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grid">
                {d.pulse.map((p) => (
                  <tr key={p.quarter}>
                    <th scope="row" className="py-1.5 pr-2 font-normal text-ink">
                      {p.label}
                    </th>
                    <td className="py-1.5 pr-2 text-right font-mono" data-numeric="">
                      {p.responded} of {p.trainees}
                    </td>
                    <td className="py-1.5 text-right font-mono" data-numeric="">
                      {p.percent === null ? "—" : `${p.percent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PlotFrame>

        <PlotFrame label={`Stalled queue · ${d.stalled.length}`}>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            {d.activeCount} active project{d.activeCount === 1 ? "" : "s"}; {d.idleCount} with no activity in {d.stallDays} days. Listed: stalled projects, and active ones whose
            handoff has gone unaccepted for {d.handoffStallDays} days — rotation is what kills these projects.
          </p>
          {d.stalled.length === 0 ? (
            <p className="text-sm text-muted">No project is stalled.</p>
          ) : (
            <ul className="divide-y divide-grid" data-testid="stalled-queue">
              {d.stalled.map((p) => (
                <li key={p.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/projects/${p.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                  {p.status === "stalled" && <p className="mt-0.5 text-sm text-ink">{p.stallReason ?? "No recent activity."}</p>}
                  {p.handoffs[0] && (
                    <p className="mt-0.5 text-sm text-ink">
                      Handoff to {p.handoffs[0].toUser?.name ?? "the incoming owner"} unaccepted for {days(p.handoffs[0].createdAt)} days.
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    {p.program.specialty} · {p.owner?.name ?? "no lead"} · coach {p.coach?.name ?? "none"}
                    {p.stalledAt ? ` · stalled ${days(p.stalledAt)} days` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PlotFrame>

        <PlotFrame
          label="Barriers by status"
          action={
            <Link href="/pulse/barriers" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
              Barriers log
            </Link>
          }
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4" data-testid="barriers-by-status">
            {d.barriers.map((b) => (
              <div key={b.status} className="border-l-2 border-grid pl-3">
                <dt className="eyebrow">{b.label}</dt>
                <dd className="font-mono text-lg text-ink" data-numeric="">
                  {b.count}
                </dd>
              </div>
            ))}
          </dl>
        </PlotFrame>

        <PlotFrame label={`Knowledge gaps · ${d.gaps.length} open`}>
          <p className="text-sm leading-relaxed text-muted">Questions Ask could not answer from the library: the documents the institution still owes, most-asked first.</p>
          <ul className="mt-3 divide-y divide-grid">
            {d.gaps.map((gap) => (
              <li key={gap.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium text-ink">{gap.question}</p>
                  <span className="shrink-0 font-mono text-xs text-muted" data-numeric="">
                    ×{gap.askCount}
                  </span>
                </div>
                {gap.gapSummary && <p className="mt-1 text-sm leading-relaxed text-muted">{gap.gapSummary}</p>}
              </li>
            ))}
          </ul>
        </PlotFrame>

        {d.curriculum && (
          <PlotFrame
            label="Curriculum completion"
            action={
              <Link href="/committee/curriculum" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                Tracker
              </Link>
            }
          >
            {d.curriculum.length === 0 ? (
              <p className="text-sm text-muted">No curriculum records yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Curriculum completion by program</caption>
                <thead className="font-mono text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-normal">
                      Program
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-normal">
                      Completed
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      Rate
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-grid">
                  {d.curriculum.map((p) => (
                    <tr key={p.program}>
                      <th scope="row" className="py-1.5 pr-2 font-normal text-ink">
                        {p.program}
                      </th>
                      <td className="py-1.5 pr-2 text-right font-mono" data-numeric="">
                        {p.completed} of {p.possible}
                      </td>
                      <td className="py-1.5 text-right font-mono" data-numeric="">
                        {p.percent === null ? "—" : `${p.percent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PlotFrame>
        )}
      </div>
    </>
  );
}
