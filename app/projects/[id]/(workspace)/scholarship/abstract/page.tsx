import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProjectHeader } from "@/lib/projects/load";
import { abstractStarter, loadAbstract } from "@/lib/scholarship/service";
import { abstractHeadings, VENUES, venueById } from "@/lib/scholarship/venues";
import { AbstractEditor } from "@/components/scholarship/AbstractEditor";
import { ScholarshipNav } from "@/components/scholarship/ScholarshipNav";
import { Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AbstractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ venue?: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  if (!loaded.canWork) {
    return <Banner title="Scholarship drafts are part of the working record">They are visible to the owning program, its coach and the chair.</Banner>;
  }
  const venue = venueById((await searchParams).venue ?? "");

  if (!venue) {
    return (
      <div className="flex flex-col gap-4">
        <ScholarshipNav projectId={id} current="abstract" />
        <PlotFrame label="Choose where it is going">
          <p className="mb-3 text-sm text-muted">The headings and the word limit come from the venue. The Venues tab ranks them for this project.</p>
          <ul className="flex flex-col gap-1">
            {VENUES.map((v) => (
              <li key={v.id}>
                <Link href={`/projects/${id}/scholarship/abstract?venue=${v.id}`} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
                  {v.name} · {v.abstractWordLimit} words
                </Link>
              </li>
            ))}
          </ul>
        </PlotFrame>
      </div>
    );
  }

  const { headings, fromVenue } = abstractHeadings(venue);
  const saved = await loadAbstract(loaded.user, id, venue.id);
  const sections = saved?.sections ?? (await abstractStarter(loaded.user, id, headings));

  return (
    <div className="flex flex-col gap-4">
      <ScholarshipNav projectId={id} current="abstract" />
      <PlotFrame label={`${venue.name} · ${venue.abstractWordLimit}-word limit`}>
        <div className="mb-4 flex flex-col gap-2 text-sm leading-relaxed text-muted">
          {saved ? (
            <p>Your saved draft for {venue.name}.</p>
          ) : (
            <p>
              A starting point from the record: the problem statement, what was tested, and the engine&apos;s reading of the outcome chart.
              Conclusions are yours. Nothing is saved until you save it.
            </p>
          )}
          {!fromVenue && (
            <p>
              The venue list does not give {venue.name}&apos;s headings, so these are the common four. Check its author instructions before
              submitting.
            </p>
          )}
          <p>
            Counting: every run of characters between spaces is a word, so “34%” and “p-chart” count as one. Headings and the title are not
            counted. Where a venue counts differently, its rules win.
          </p>
        </div>
        <AbstractEditor
          key={venue.id}
          projectId={id}
          venue={{ id: venue.id, name: venue.name, limit: venue.abstractWordLimit }}
          initial={{ title: saved?.title ?? "", sections }}
        />
      </PlotFrame>
    </div>
  );
}
