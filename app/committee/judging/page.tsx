import Link from "next/link";
import { scoreAction } from "@/app/committee/actions";
import { db } from "@/lib/db";
import { MAX_TOTAL, RUBRIC, SCORE_MAX, SCORE_MIN, weightedTotal, type RubricScores } from "@/lib/committee/rubric";
import { myAssignments } from "@/lib/committee/services/events";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm } from "@/components/projects/ActionForm";
import { Badge, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judging" };

export default async function MyJudgingPage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const [assignments, symposia] = await Promise.all([
    myAssignments(user),
    user.role === "chair"
      ? db.event.findMany({
          where: { type: "symposium" },
          orderBy: { date: "desc" },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="judging"
        title="Judging"
        lede={`Your assignments. Score each criterion from ${SCORE_MIN} to ${SCORE_MAX}; you see your own scores, never another judge's. You are never assigned a project you coach or lead.`}
      />
      <div className="flex flex-col gap-4">
        {symposia.length > 0 && (
          <PlotFrame label="Boards and results">
            <ul className="flex flex-col gap-1">
              {symposia.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/committee/events/${e.id}/judging`}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {e.title ?? "Symposium"}: assign judges and see results
                  </Link>
                </li>
              ))}
            </ul>
          </PlotFrame>
        )}

        {assignments.length === 0 && <EmptyState title="Nothing to judge">The chair assigns judges to submissions.</EmptyState>}

        {assignments.map((a) => {
          const scores = (a.score?.rubricScores ?? null) as RubricScores | null;
          const total = scores ? weightedTotal(scores) : null;
          return (
            <PlotFrame key={a.submissionId} label={a.submission.event.title ?? "Symposium"}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-base font-semibold text-ink">{a.submission.project.title}</h2>
                {total !== null ? (
                  <Badge tone="confirm">
                    scored · {total} of {MAX_TOTAL}
                  </Badge>
                ) : (
                  <Badge>to score</Badge>
                )}
              </div>
              <p className="font-mono text-xs text-muted">
                {a.submission.project.program.name} · {a.submission.presenters}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">{a.submission.abstract}</p>
              <div className="mt-3">
                <ActionForm action={scoreAction} hidden={{ submissionId: a.submissionId }} submitLabel={scores ? "Update scores" : "Save scores"} resetOnSuccess={false}>
                  {RUBRIC.map((c) => (
                    <fieldset key={c.id} className="border-t border-grid pt-3">
                      <legend className="text-sm font-medium text-ink">
                        {c.label} <span className="font-mono text-xs text-muted">×{c.weight}</span>
                      </legend>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        A {SCORE_MAX}: {c.anchor}
                      </p>
                      <div className="mt-2 grid grid-cols-5 gap-1">
                        {Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i).map((v) => (
                          <label
                            key={v}
                            className="flex min-h-11 cursor-pointer items-center justify-center border border-grid bg-surface font-mono text-sm text-ink has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
                          >
                            <input type="radio" name={c.id} value={v} defaultChecked={scores?.[c.id] === v} required className="sr-only" aria-label={`${c.label}: ${v}`} />
                            {v}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </ActionForm>
              </div>
            </PlotFrame>
          );
        })}
      </div>
    </>
  );
}
