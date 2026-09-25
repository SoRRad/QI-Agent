import { notFound } from "next/navigation";
import { recordClerResponseAction } from "@/app/committee/actions";
import { CLER_LABEL } from "@/lib/cler";
import { RATING_LABEL, READING_LABEL } from "@/lib/committee/cler";
import { eventDate } from "@/lib/committee/eventKit";
import { CommitteeNotFoundError } from "@/lib/committee/services/access";
import { clerMock, RATINGS } from "@/lib/committee/services/cler";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { Badge, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "CLER mock" };

const TONE = {
  gap: "signal",
  partial: "neutral",
  clear: "confirm",
  unanswered: "neutral",
  not_asked: "neutral",
} as const;

export default async function ClerMockPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const { id } = await params;
  let mock;
  try {
    mock = await clerMock(user, id);
  } catch (error) {
    if (error instanceof CommitteeNotFoundError) notFound();
    throw error;
  }
  const { event, gaps } = mock;

  return (
    <>
      <CommitteeHeader user={user} current="cler" title={event.title ?? "Mock walkaround"} lede={`${eventDate(event.date)}${event.agenda ? ` · ${event.agenda}` : ""}`} />
      <div className="flex flex-col gap-4">
        <PlotFrame label="Gap reading by focus area">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Counted from the ratings recorded below. A focus area is a gap when any answer was rated &ldquo;could not answer&rdquo;: in a real visit, one resident who cannot say
            how to reach their attending is the finding.
          </p>
          <table className="w-full text-left text-sm" data-testid="cler-gaps">
            <caption className="sr-only">Gap reading by CLER focus area</caption>
            <thead className="font-mono text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 pr-2 font-normal">
                  Focus area
                </th>
                <th scope="col" className="py-1 pr-2 font-normal">
                  Reading
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Answered
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grid">
              {gaps.map((g) => (
                <tr key={g.domain}>
                  <th scope="row" className="py-1.5 pr-2 font-normal text-ink">
                    {g.label}
                  </th>
                  <td className="py-1.5 pr-2">
                    <Badge tone={TONE[g.reading]}>{READING_LABEL[g.reading]}</Badge>
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs" data-numeric="">
                    {g.answered} of {g.asked}
                    {g.answered > 0 && (
                      <span className="block text-muted">
                        {g.counts.clear}✓ {g.counts.partial}~ {g.counts.unable}✗
                        <span className="sr-only">
                          : {g.counts.clear} clear, {g.counts.partial} partial, {g.counts.unable} could not answer
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PlotFrame>

        {event.clerQuestions.map((q) => (
          <PlotFrame key={q.id} label={CLER_LABEL[q.domain]}>
            <section aria-labelledby={`q-${q.id}`}>
              <h2 id={`q-${q.id}`} className="text-base font-semibold leading-snug text-ink">
                {q.question}
              </h2>
              {q.response ? (
                <div className="mt-2 border-l-2 border-grid pl-3">
                  <p className="text-sm leading-relaxed text-ink">{q.response}</p>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {q.respondent} · {q.rating ? RATING_LABEL[q.rating] : "not rated"}
                    {q.recordedBy ? ` · recorded by ${q.recordedBy.name}` : ""}
                  </p>
                  {q.notes && <p className="mt-1 text-sm text-muted">{q.notes}</p>}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">Not yet asked.</p>
              )}
              <details className="mt-3 border-t border-grid pt-2" open={!q.response}>
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">{q.response ? "Change the record" : "Record the answer"}</summary>
                <ActionForm
                  action={recordClerResponseAction}
                  hidden={{ eventId: event.id, questionId: q.id }}
                  submitLabel="Save"
                  resetOnSuccess={false}
                  phiFields={[
                    ["respondent", "Who answered"],
                    ["response", "Answer"],
                    ["notes", "Notes"],
                  ]}
                >
                  <Field id={`resp-${q.id}`} label="Who answered" help="By role only, e.g. PGY-2 resident. Never a name.">
                    <input
                      id={`resp-${q.id}`}
                      name="respondent"
                      defaultValue={q.respondent ?? ""}
                      required
                      maxLength={60}
                      className={inputClass}
                      aria-describedby={`resp-${q.id}-help`}
                    />
                  </Field>
                  <Field id={`ans-${q.id}`} label="Answer" help="What they said, in a sentence or two. No patient information.">
                    <textarea
                      id={`ans-${q.id}`}
                      name="response"
                      defaultValue={q.response ?? ""}
                      rows={3}
                      required
                      maxLength={1500}
                      className={textareaClass}
                      aria-describedby={`ans-${q.id}-help`}
                    />
                  </Field>
                  <fieldset>
                    <legend className="eyebrow">How well was it answered?</legend>
                    <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:gap-4">
                      {RATINGS.map((r) => (
                        <label key={r} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                          <input type="radio" name="rating" value={r} defaultChecked={q.rating === r} required className="h-4 w-4" />
                          {RATING_LABEL[r]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Field id={`notes-${q.id}`} label="Notes (optional)">
                    <textarea id={`notes-${q.id}`} name="notes" defaultValue={q.notes ?? ""} rows={2} maxLength={1000} className={textareaClass} />
                  </Field>
                </ActionForm>
              </details>
            </section>
          </PlotFrame>
        ))}
      </div>
    </>
  );
}
