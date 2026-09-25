import Link from "next/link";
import { notFound } from "next/navigation";
import { assignJudgeAction, unassignJudgeAction } from "@/app/committee/actions";
import { rankLabel } from "@/lib/committee/judging";
import { MAX_TOTAL, RUBRIC } from "@/lib/committee/rubric";
import { CommitteeAccessError, CommitteeNotFoundError } from "@/lib/committee/services/access";
import { judgingBoard } from "@/lib/committee/services/events";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, inputClass } from "@/components/projects/ActionForm";
import { Badge, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judging" };

const two = (n: number | null) => (n === null ? "—" : n.toFixed(2));

export default async function JudgingBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  if (user.role !== "chair") return <Restricted chairOnly />;
  const { id } = await params;
  let board;
  try {
    board = await judgingBoard(user, id);
  } catch (error) {
    if (error instanceof CommitteeNotFoundError) notFound();
    if (error instanceof CommitteeAccessError) return <Restricted chairOnly />;
    throw error;
  }
  const tied = board.results.some((r) => r.tied);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="judging"
        title={`Judging · ${board.event.title ?? "Symposium"}`}
        lede={`Each judge scores six criteria from 1 to 5, weighted to a total out of ${MAX_TOTAL}. A submission's result is the mean of its judges' totals, and it is ranked only once every assigned judge has scored.`}
        action={
          <Link href={`/committee/events/${board.event.id}`} className="text-sm text-primary underline underline-offset-2">
            Back to the event
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <PlotFrame
          label="Results"
          action={
            <a href={`/api/committee/events/${board.event.id}/results`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
              Export CSV
            </a>
          }
        >
          {tied && (
            <p className="mb-3 text-sm leading-relaxed text-ink">
              <strong className="font-semibold">Shared places are shown as shared</strong> (=1). Breaking a tie is the committee&apos;s decision; the system does not invent an
              order.
            </p>
          )}
          <ol className="divide-y divide-grid" data-testid="judging-results">
            {board.results.map((r) => (
              <li key={r.submissionId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="shrink-0 font-mono text-sm font-semibold text-ink sm:w-24" data-numeric="">
                  {rankLabel(r)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {r.title} {r.tied && <Badge tone="primary">shared place</Badge>}
                  </p>
                  <p className="font-mono text-xs text-muted" data-numeric="">
                    {r.program} · mean {two(r.mean)} of {MAX_TOTAL} · {r.scoredJudges} of {r.assignedJudges} judges scored
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <details className="mt-3 border-t border-grid pt-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">Mean score by criterion</summary>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Mean score by criterion for each submission</caption>
                <thead className="font-mono text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-normal">
                      Submission
                    </th>
                    {RUBRIC.map((c) => (
                      <th key={c.id} scope="col" className="py-1 pr-2 text-right font-normal">
                        {c.label} ×{c.weight}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-grid">
                  {board.results.map((r) => (
                    <tr key={r.submissionId}>
                      <th scope="row" className="py-1.5 pr-2 font-normal text-ink">
                        {r.title}
                      </th>
                      {RUBRIC.map((c) => (
                        <td key={c.id} className="py-1.5 pr-2 text-right font-mono" data-numeric="">
                          {two(r.criterionMeans[c.id] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </PlotFrame>

        {board.submissions.map((s) => {
          const assignable = s.eligible.filter((j) => !j.conflict);
          const conflicted = s.eligible.filter((j) => j.conflict);
          return (
            <PlotFrame key={s.id} label="Judges">
              <h2 className="text-base font-semibold text-ink">{s.title}</h2>
              <p className="font-mono text-xs text-muted">{s.program}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {s.assigned.length === 0 && <li className="text-sm text-muted">No judges assigned.</li>}
                {s.assigned.map((a) => (
                  <li key={a.judgeId} className="flex flex-col gap-2 border-l-2 border-grid pl-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm text-ink">
                      {a.name} ·{" "}
                      {a.scored ? (
                        <span className="font-mono" data-numeric="">
                          {a.total} of {MAX_TOTAL}
                        </span>
                      ) : (
                        <span className="text-muted">not yet scored</span>
                      )}
                    </span>
                    {!a.scored && (
                      <ActionForm
                        action={unassignJudgeAction}
                        hidden={{
                          eventId: board.event.id,
                          submissionId: s.id,
                          judgeId: a.judgeId,
                        }}
                        submitLabel={`Remove ${a.name}`}
                        variant="secondary"
                        pendingLabel="Removing…"
                      />
                    )}
                  </li>
                ))}
              </ul>
              {assignable.length > 0 && (
                <div className="mt-3">
                  <ActionForm action={assignJudgeAction} hidden={{ eventId: board.event.id, submissionId: s.id }} submitLabel="Assign judge" variant="secondary">
                    <Field id={`judge-${s.id}`} label="Judge">
                      <select id={`judge-${s.id}`} name="judgeId" className={inputClass}>
                        {assignable.map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </ActionForm>
                </div>
              )}
              {conflicted.length > 0 && <p className="mt-2 text-xs text-muted">Not assignable: {conflicted.map((j) => `${j.name} (${j.conflict})`).join("; ")}.</p>}
            </PlotFrame>
          );
        })}
      </div>
    </>
  );
}
