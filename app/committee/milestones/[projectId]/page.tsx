import Link from "next/link";
import { notFound } from "next/navigation";
import { draftMilestonesAction, recordPdReviewAction } from "@/app/committee/actions";
import { db } from "@/lib/db";
import { DRAFT_LABEL, PROJECT_LEVEL_CAVEAT } from "@/lib/committee/milestones";
import { CommitteeAccessError, CommitteeNotFoundError } from "@/lib/committee/services/access";
import { mappableProjects, milestoneDrafts } from "@/lib/committee/services/milestones";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, inputClass } from "@/components/projects/ActionForm";
import { Badge, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Milestone drafts" };

const day = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function MilestoneProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const { projectId } = await params;
  let drafts;
  try {
    drafts = await milestoneDrafts(user, projectId);
  } catch (error) {
    if (error instanceof CommitteeNotFoundError) notFound();
    if (error instanceof CommitteeAccessError) {
      return <Restricted chairOnly={false} />;
    }
    throw error;
  }
  const project = (await mappableProjects(user)).find((p) => p.id === projectId);
  const title =
    project?.title ??
    (
      await db.project.findUnique({
        where: { id: projectId },
        select: { title: true },
      })
    )?.title ??
    "Project";
  const trainees = project?.trainees ?? [];

  return (
    <>
      <CommitteeHeader
        user={user}
        current="milestones"
        title={title}
        lede="Milestone evidence drafts for the program director."
        action={
          <Link href="/committee/milestones" className="text-sm text-primary underline underline-offset-2">
            All projects
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <PlotFrame label="Draft for a trainee">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            The draft is built from keyed facts in the project record, and every paragraph cites the facts it rests on. {PROJECT_LEVEL_CAVEAT} Drafting again replaces unreviewed
            drafts for that trainee; reviewed ones are kept.
          </p>
          {trainees.length === 0 ? (
            <p className="text-sm text-muted">The record connects no trainee to this project.</p>
          ) : (
            <ActionForm action={draftMilestonesAction} hidden={{ projectId }} submitLabel="Draft evidence" pendingLabel="Drafting…">
              <Field id="milestone-trainee" label="Trainee">
                <select id="milestone-trainee" name="traineeId" className={inputClass}>
                  {trainees.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          )}
        </PlotFrame>

        {drafts.length === 0 ? (
          <EmptyState title="No drafts yet">Choose a trainee above to draft evidence.</EmptyState>
        ) : (
          drafts.map((d) => (
            <PlotFrame key={d.id} label={`${d.milestoneCode} · ${d.subcompetency?.domain ?? "Milestone"}`}>
              <article data-testid="milestone-draft" aria-labelledby={`ms-${d.id}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 id={`ms-${d.id}`} className="text-base font-semibold text-ink">
                    {d.subcompetency?.title ?? d.milestoneCode} · {d.user.name}
                  </h2>
                  {d.pdReviewedAt ? <Badge tone="confirm">PD review recorded</Badge> : <Badge tone="signal">{DRAFT_LABEL}</Badge>}
                </div>
                <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{d.evidenceText}</div>
                <p className="mt-2 font-mono text-xs text-muted">
                  Drafted {day(d.generatedAt)}
                  {d.pdReviewedAt ? ` · program director review recorded ${day(d.pdReviewedAt)} by ${d.pdReviewedBy?.name ?? "a committee member"}` : ""}
                </p>
                {!d.pdReviewedAt && (
                  <div className="mt-3">
                    <ActionForm
                      action={recordPdReviewAction}
                      hidden={{ projectId, mapId: d.id }}
                      submitLabel="Record program director review"
                      variant="secondary"
                      pendingLabel="Recording…"
                    />
                  </div>
                )}
              </article>
            </PlotFrame>
          ))
        )}
      </div>
    </>
  );
}
