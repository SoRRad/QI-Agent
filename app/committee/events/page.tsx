import Link from "next/link";
import { createEventAction } from "@/app/committee/actions";
import { EVENT_TYPE_LABEL } from "@/lib/committee/eventKit";
import { EVENT_TYPES, listEvents } from "@/lib/committee/services/events";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { Badge, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

const day = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function EventsPage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const events = await listEvents(user);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="events"
        title="Events"
        lede="Symposia, committee meetings, workshops and mock CLER walkarounds. Each gets a kit — agenda, invitation, slide skeleton, rubric and feedback form — filled from the record, and an after-action note."
      />
      <div className="flex flex-col gap-4">
        <PlotFrame label={`${events.length} events`}>
          {events.length === 0 ? (
            <EmptyState title="No events yet">The chair creates the first one below.</EmptyState>
          ) : (
            <ul className="divide-y divide-grid" data-testid="events">
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={e.type === "cler_mock" ? `/committee/cler/${e.id}` : `/committee/events/${e.id}`}
                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {e.title ?? EVENT_TYPE_LABEL[e.type]}
                    </Link>
                    <Badge>{EVENT_TYPE_LABEL[e.type]}</Badge>
                    {e.kitGeneratedAt && <Badge tone="confirm">kit ready</Badge>}
                  </div>
                  <p className="font-mono text-xs text-muted" data-numeric="">
                    {day(e.date)} · {e.quarter}
                    {e._count.submissions ? ` · ${e._count.submissions} submissions` : ""}
                    {e._count.clerQuestions ? ` · ${e._count.clerQuestions} questions` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PlotFrame>

        {user.role === "chair" && (
          <PlotFrame label="New event">
            <p className="mb-3 text-sm leading-relaxed text-muted">
              For a mock CLER walkaround, use{" "}
              <Link href="/committee/cler" className="text-primary underline underline-offset-2">
                CLER mock
              </Link>
              , which drafts the interviewer questions as well.
            </p>
            <ActionForm
              action={createEventAction}
              hidden={{}}
              submitLabel="Create event"
              phiFields={[
                ["title", "Title"],
                ["agenda", "Notes"],
              ]}
            >
              <Field id="event-title" label="Title">
                <input id="event-title" name="title" required minLength={4} maxLength={140} className={inputClass} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="event-type" label="Kind of event">
                  <select id="event-type" name="type" defaultValue="symposium" className={inputClass}>
                    {EVENT_TYPES.filter((t) => t !== "cler_mock").map((t) => (
                      <option key={t} value={t}>
                        {EVENT_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="event-date" label="Date">
                  <input id="event-date" name="date" type="date" required className={inputClass} />
                </Field>
              </div>
              <Field id="event-agenda" label="Notes (optional)" help="Anything the kit's agenda should carry, such as the format. No patient information.">
                <textarea id="event-agenda" name="agenda" rows={3} maxLength={1000} className={textareaClass} aria-describedby="event-agenda-help" />
              </Field>
            </ActionForm>
          </PlotFrame>
        )}
      </div>
    </>
  );
}
