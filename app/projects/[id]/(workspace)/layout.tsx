import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProjectHeader } from "@/lib/projects/load";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { Banner } from "@/components/ui/primitives";
import { ProjectStatusPill } from "@/components/ui/StatusPill";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadProjectHeader((await params).id);
  return { title: loaded?.project.title ?? "Project" };
}

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  const { project, canWork } = loaded;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/projects" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Registry
        </Link>
      </nav>
      <div className="mb-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">
            {project.program.specialty}
            {project.cohortYear ? ` · ${project.cohortYear} cohort` : ""}
          </span>
          <ProjectStatusPill status={project.status} />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{project.title}</h1>
        <p className="text-sm text-muted">
          {project.owner ? `Led by ${project.owner.name}` : "No lead named"}
          {project.coach ? ` · coached by ${project.coach.name}` : " · no coach yet"}
        </p>
      </div>
      {project.status === "draft" && canWork && (
        <div className="mb-4">
          <Banner tone="primary" title="This project is still a draft">
            <Link href={`/projects/${id}/intake?step=review`} className="text-primary underline underline-offset-2">
              Continue intake
            </Link>{" "}
            — the review step shows exactly what stands between it and submission.
          </Banner>
        </div>
      )}
      <ProjectTabs projectId={id} />
      {children}
    </>
  );
}
