import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProjectHeader } from "@/lib/projects/load";
import { countAbstract, type AbstractSection } from "@/lib/scholarship/abstract";
import { OUTCOME_LABEL } from "@/lib/scholarship/irb";
import { latestPrecheck, listAbstracts, venueProfile } from "@/lib/scholarship/service";
import { matchVenues, VENUES_LAST_REVIEWED, type Fit } from "@/lib/scholarship/venues";
import { ScholarshipNav } from "@/components/scholarship/ScholarshipNav";
import { Badge, Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const FIT: Record<Fit, { label: string; tone: "confirm" | "neutral" | "primary" | "signal" }> = {
  fits: { label: "fits", tone: "confirm" },
  check: { label: "check scope", tone: "neutral" },
  stretch: { label: "stretch", tone: "primary" },
  excluded: { label: "out of scope", tone: "signal" },
};

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function ScholarshipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  if (!loaded.canWork) {
    return <Banner title="Scholarship drafts are part of the working record">They are visible to the owning program, its coach and the chair.</Banner>;
  }
  const { user } = loaded;
  const [profile, abstracts, screening] = await Promise.all([venueProfile(user, id), listAbstracts(user, id), latestPrecheck(user, id)]);
  const matches = matchVenues(profile, new Date());
  const drafts = new Map(abstracts.map((a) => [a.venueId, a]));

  return (
    <div className="flex flex-col gap-4">
      <ScholarshipNav projectId={id} current="" />

      <div className="grid gap-4 sm:grid-cols-2">
        <PlotFrame label="Ethics screening">
          {screening ? (
            <p className="text-sm text-ink">
              {OUTCOME_LABEL[screening.outcome]}, {day(screening.createdAt)}.{" "}
              <Link href={`/projects/${id}/scholarship/irb`} className="text-primary underline underline-offset-2">
                The memo
              </Link>
            </p>
          ) : (
            <p className="text-sm text-ink">
              Not screened yet. Most venues ask for a QI determination; the{" "}
              <Link href={`/projects/${id}/scholarship/irb`} className="text-primary underline underline-offset-2">
                pre-check
              </Link>{" "}
              drafts the request.
            </p>
          )}
        </PlotFrame>
        <PlotFrame label="Manuscript">
          <p className="text-sm text-ink">
            The{" "}
            <Link href={`/projects/${id}/scholarship/squire`} className="text-primary underline underline-offset-2">
              SQUIRE 2.0 draft
            </Link>{" "}
            is assembled from this project&apos;s record each time you open it.
          </p>
        </PlotFrame>
      </div>

      <PlotFrame label="Where to send it">
        <p className="mb-3 text-sm text-muted">
          Ranked by fit with this project, then by the nearest deadline. Deadlines are the binding constraint: work that would have been
          accepted and missed the deadline is the commonest way trainee QI goes unpublished.
        </p>
        <ul className="flex flex-col divide-y divide-grid" data-testid="venue-matches">
          {matches.map((m) => {
            const draft = drafts.get(m.venue.id);
            const words = draft ? countAbstract(draft.sections as unknown as AbstractSection[], m.venue.abstractWordLimit).total : null;
            const soon = m.deadline.monthsAway !== null && m.deadline.monthsAway <= 2;
            return (
              <li key={m.venue.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{m.venue.name}</span>
                  <Badge tone={FIT[m.fit].tone}>{FIT[m.fit].label}</Badge>
                  {m.venue.isLocal && <Badge tone="primary">local</Badge>}
                </div>
                <p className="mt-1 font-mono text-xs text-muted">
                  {m.venue.type === "journal" ? "Journal" : "Meeting"} · {m.deadline.label}
                  {m.deadline.monthsAway === 0 ? " · this month" : m.deadline.monthsAway !== null ? ` · in ${m.deadline.monthsAway} ${m.deadline.monthsAway === 1 ? "month" : "months"}` : ""}
                  {" · "}abstract {m.venue.abstractWordLimit} words
                </p>
                {soon && <p className="mt-1 text-xs font-semibold text-ink">Deadline soon: confirm the exact date on the venue&apos;s site.</p>}
                <p className="mt-1.5 text-sm leading-relaxed text-ink">{m.summary}</p>
                {m.venue.notes && <p className="mt-1 text-sm leading-relaxed text-muted">{m.venue.notes}</p>}
                <details className="mt-1.5 text-sm">
                  <summary className="cursor-pointer text-primary">Scope, tag by tag</summary>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {m.readings.map((r) => (
                      <li key={r.tag}>
                        <span className="font-mono text-xs">{r.tag}</span> — {FIT[r.fit].label}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
                {m.fit !== "excluded" && (
                  <Link href={`/projects/${id}/scholarship/abstract?venue=${m.venue.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
                    {draft ? `Continue the abstract (${words} of ${m.venue.abstractWordLimit} words)` : `Write the abstract for ${m.venue.name}`}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          The committee maintains this list in <code>content/venues.json</code>; last reviewed {VENUES_LAST_REVIEWED}. Deadlines are the usual month;
          always confirm on the venue&apos;s own site.
        </p>
      </PlotFrame>
    </div>
  );
}
