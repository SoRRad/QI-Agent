import Link from "next/link";
import { MILESTONES_LAST_REVIEWED, SUBCOMPETENCIES } from "@/lib/committee/milestones";
import { mappableProjects } from "@/lib/committee/services/milestones";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ProjectStatusPill } from "@/components/ui/StatusPill";
import { EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Milestones" };

export default async function MilestonesPage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const projects = await mappableProjects(user);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="milestones"
        title="Milestone mapper"
        lede="Draft evidence text for program directors, mapping a resident's project to Systems-Based Practice and Practice-Based Learning and Improvement. Every draft is marked as requiring program director review; the draft describes evidence and never suggests a level."
      />
      <div className="flex flex-col gap-4">
        <PlotFrame label={user.role === "chair" ? "Projects" : "Projects you coach"}>
          {projects.length === 0 ? (
            <EmptyState title="No projects to map">Drafts are available to the chair, and to a coach for the projects they coach.</EmptyState>
          ) : (
            <ul className="divide-y divide-grid">
              {projects.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/committee/milestones/${p.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                      {p.title}
                    </Link>
                    <ProjectStatusPill status={p.status} />
                  </div>
                  <p className="font-mono text-xs text-muted">
                    {p.program} · {p.trainees.length ? p.trainees.map((t) => t.name).join(", ") : "no trainee on record"}
                    {p.drafts ? ` · ${p.drafts} draft entries` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PlotFrame>
        <PlotFrame label="Subcompetencies mapped">
          <ul className="flex flex-col gap-2 text-sm">
            {SUBCOMPETENCIES.map((s) => (
              <li key={s.code}>
                <span className="font-mono text-xs text-muted">{s.code}</span> <span className="font-medium text-ink">{s.title}</span>
                <span className="block text-xs leading-relaxed text-muted">{s.covers}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            From <code className="font-mono">content/milestones.json</code>, last reviewed {MILESTONES_LAST_REVIEWED}. Numbering can differ in a specialty&apos;s own Milestones;
            confirm each code against the program&apos;s current document. The descriptions are the committee&apos;s paraphrase, not ACGME text.
          </p>
        </PlotFrame>
      </div>
    </>
  );
}
