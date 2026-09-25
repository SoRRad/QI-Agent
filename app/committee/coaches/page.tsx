import Link from "next/link";
import { assignCoachAction } from "@/app/committee/actions";
import { CLER_LABEL } from "@/lib/cler";
import { WEIGHTS } from "@/lib/committee/coaches";
import { coachBoard } from "@/lib/committee/services/coaches";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm } from "@/components/projects/ActionForm";
import { ProjectStatusPill } from "@/components/ui/StatusPill";
import { Badge, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coaches" };

export default async function CoachesPage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const { coaches, projects } = await coachBoard(user);
  const isChair = user.role === "chair";

  return (
    <>
      <CommitteeHeader
        user={user}
        current="coaches"
        title="Coach matching"
        lede={`Suggestions from declared expertise and current load: experience in the project's CLER focus area scores ${WEIGHTS.expertise}, the same program ${WEIGHTS.sameProgram}, and each active project a coach already has costs ${WEIGHTS.perActiveProject}. The chair assigns.`}
      />
      <div className="flex flex-col gap-4">
        <PlotFrame label="Coaches">
          <ul className="divide-y divide-grid" data-testid="coach-load">
            {coaches.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted" data-numeric="">
                    {c.load} active
                  </span>
                </div>
                <span className="text-xs text-muted">
                  {c.program ?? "No program"} · {c.expertise.length ? c.expertise.map((d) => CLER_LABEL[d]).join(", ") : "no expertise declared"}
                </span>
              </li>
            ))}
          </ul>
        </PlotFrame>

        {projects.map((p) => (
          <PlotFrame key={p.id} label={p.coach ? `Coach: ${p.coach.name}` : "No coach"}>
            <div className="flex flex-wrap items-baseline gap-2">
              <Link href={`/projects/${p.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                {p.title}
              </Link>
              <ProjectStatusPill status={p.status} />
              {!p.coach && <Badge tone="signal">needs a coach</Badge>}
            </div>
            <p className="font-mono text-xs text-muted">
              {p.program.name} · {p.clerDomain ? CLER_LABEL[p.clerDomain] : "no CLER focus area"}
            </p>
            <ol className="mt-3 flex flex-col gap-3" aria-label={`Suggested coaches for ${p.title}`}>
              {p.suggestions.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 border-l-2 border-grid pl-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      <span className="font-medium">{s.name}</span> <span className="font-mono text-xs text-muted">score {s.score}</span>
                      {s.isCurrent && (
                        <span className="ml-2">
                          <Badge tone="confirm">current coach</Badge>
                        </span>
                      )}
                    </p>
                    <ul className="mt-0.5 text-xs leading-relaxed text-muted">
                      {s.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                  {isChair && !s.isCurrent && (
                    <ActionForm
                      action={assignCoachAction}
                      hidden={{ projectId: p.id, coachId: s.id }}
                      submitLabel={`Assign ${s.name}`}
                      variant="secondary"
                      pendingLabel="Assigning…"
                    />
                  )}
                </li>
              ))}
            </ol>
          </PlotFrame>
        ))}
      </div>
    </>
  );
}
