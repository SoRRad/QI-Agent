import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { generateKitAction, saveAfterActionAction } from "@/app/committee/actions";
import { EVENT_TYPE_LABEL, eventDate, parseKit } from "@/lib/committee/eventKit";
import { CommitteeNotFoundError } from "@/lib/committee/services/access";
import { eventDetail } from "@/lib/committee/services/events";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, textareaClass } from "@/components/projects/ActionForm";
import { Badge, Banner, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event" };

const stamp = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const { id } = await params;
  let detail;
  try {
    detail = await eventDetail(user, id);
  } catch (error) {
    if (error instanceof CommitteeNotFoundError) notFound();
    throw error;
  }
  const { event, kitStale } = detail;
  if (event.type === "cler_mock") redirect(`/committee/cler/${event.id}`);
  const isChair = user.role === "chair";
  const kit = parseKit(event.kit);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="events"
        title={event.title ?? EVENT_TYPE_LABEL[event.type]}
        lede={`${EVENT_TYPE_LABEL[event.type]} · ${eventDate(event.date)} · ${event.quarter}`}
      />
      <div className="flex flex-col gap-4">
        {event.type === "symposium" && (
          <PlotFrame
            label={`Submissions · ${event.submissions.length}`}
            action={
              isChair ? (
                <Link href={`/committee/events/${event.id}/judging`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                  Judging and results
                </Link>
              ) : undefined
            }
          >
            {event.submissions.length === 0 ? (
              <p className="text-sm text-muted">No submissions yet.</p>
            ) : (
              <ul className="divide-y divide-grid">
                {event.submissions.map((s) => (
                  <li key={s.id} className="py-2 first:pt-0 last:pb-0">
                    <Link href={`/projects/${s.project.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                      {s.project.title}
                    </Link>
                    <p className="font-mono text-xs text-muted">
                      {s.project.program.name} · {s.presenters}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </PlotFrame>
        )}

        <PlotFrame
          label="Event kit"
          action={
            event.kit ? (
              <a href={`/api/committee/events/${event.id}/kit`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                Download as Markdown
              </a>
            ) : undefined
          }
        >
          {kitStale && (
            <div className="mb-3">
              <Banner tone="signal" title="Out of date">
                A submission arrived after this kit was generated. Generate it again to include it; the version below is the one on record until you do.
              </Banner>
            </div>
          )}
          {kit.length === 0 ? (
            <EmptyState title="No kit yet">
              {isChair ? "Generate one from the current record: agenda, invitation, slide skeleton, rubric and feedback form." : "The chair generates the kit."}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4" data-testid="event-kit">
              <p className="font-mono text-xs text-muted">Generated {stamp(event.kitGeneratedAt!)} from the record. Text in [square brackets] is for the organiser to fill.</p>
              {kit.map((s) => (
                <section key={s.heading} aria-labelledby={`kit-${s.heading}`} className="border-t border-grid pt-3">
                  <h2 id={`kit-${s.heading}`} className="text-base font-semibold text-ink">
                    {s.heading}
                  </h2>
                  <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{s.body}</div>
                </section>
              ))}
            </div>
          )}
          {isChair && (
            <div className="mt-4">
              <ActionForm
                action={generateKitAction}
                hidden={{ eventId: event.id }}
                submitLabel={event.kit ? "Generate again" : "Generate the kit"}
                variant={event.kit ? "secondary" : "primary"}
                pendingLabel="Generating…"
              />
            </div>
          )}
        </PlotFrame>

        <PlotFrame label="After-action note">
          {isChair ? (
            <ActionForm
              action={saveAfterActionAction}
              hidden={{ eventId: event.id }}
              submitLabel="Save the note"
              resetOnSuccess={false}
              phiFields={[["afterActionNote", "After-action note"]]}
            >
              <Field id="after-action" label="What worked, what to change next time" help="Kept with the event for whoever organises the next one. No patient information.">
                <textarea
                  id="after-action"
                  name="afterActionNote"
                  rows={5}
                  maxLength={4000}
                  defaultValue={event.afterActionNote ?? ""}
                  className={textareaClass}
                  aria-describedby="after-action-help"
                />
              </Field>
            </ActionForm>
          ) : event.afterActionNote ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{event.afterActionNote}</p>
          ) : (
            <p className="text-sm text-muted">No note yet.</p>
          )}
        </PlotFrame>
        {event.agenda && (
          <p className="text-sm text-muted">
            <Badge>notes</Badge> {event.agenda}
          </p>
        )}
      </div>
    </>
  );
}
