import Link from "next/link";
import type { ClerDomain, Prisma, ProjectStatus } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STALL_DAYS } from "@/lib/jobs/stall";
import { HANDOFF_ACCEPTANCE_DAYS } from "@/lib/projects/handoff";
import { Badge, DataPair, EmptyState, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { ProjectStatusPill } from "@/components/ui/StatusPill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

const STATUSES: ProjectStatus[] = ["draft", "submitted", "active", "stalled", "complete", "archived"];
const CLER: ClerDomain[] = ["patient_safety", "health_care_quality", "care_transitions", "supervision", "well_being", "professionalism"];
const clerLabel = (c: string) => c.replaceAll("_", " ");

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await getCurrentUser();
  const search = await searchParams;
  const q = one(search["q"]).trim().slice(0, 100);
  const program = one(search["program"]);
  const status = one(search["status"]) as ProjectStatus | "";
  const cler = one(search["cler"]) as ClerDomain | "";
  const cohort = Number(one(search["cohort"])) || null;
  const coach = one(search["coach"]);

  // The registry is readable across programs by design: cross-cohort learning
  // is the point. Archived projects are included unless filtered out — they
  // stay searchable forever. Restricted material (data, PDSA, obstacle notes)
  // is not read here. See lib/auth/scope.ts.
  const where: Prisma.ProjectWhereInput = {
    ...(program ? { programId: program } : {}),
    ...(STATUSES.includes(status as ProjectStatus) ? { status: status as ProjectStatus } : {}),
    ...(CLER.includes(cler as ClerDomain) ? { clerDomain: cler as ClerDomain } : {}),
    ...(cohort ? { cohortYear: cohort } : {}),
    ...(coach ? { coachId: coach } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { problemStatement: { contains: q, mode: "insensitive" } },
            { outcomeSummary: { contains: q, mode: "insensitive" } },
            { aimStatements: { some: { text: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [projects, programs, coaches, cohorts] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        problemStatement: true,
        status: true,
        cohortYear: true,
        clerDomain: true,
        lastActivityAt: true,
        endReason: true,
        stallReason: true,
        program: { select: { specialty: true } },
        coach: { select: { name: true } },
        aimStatements: { orderBy: { version: "desc" }, take: 1, select: { text: true, version: true } },
        handoffs: { where: { acceptedAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
        _count: { select: { measures: true, pdsaCycles: true } },
      },
    }),
    db.program.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { role: { in: ["coach", "chair"] }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.project.findMany({ where: { cohortYear: { not: null } }, distinct: ["cohortYear"], orderBy: { cohortYear: "desc" }, select: { cohortYear: true } }),
  ]);

  const daysSince = (d: Date): number => Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const filtered = !!(q || program || status || cler || cohort || coach);
  const select = "min-h-11 w-full border border-grid bg-surface px-2 text-sm text-ink";

  return (
    <>
      <PageHeader
        eyebrow="Projects"
        title="Registry"
        lede="Every project has a permanent record, and archived projects stay searchable forever. Titles, problem statements, aims and outcomes are readable across programs so the next cohort does not repeat work."
        action={
          <Link href="/projects/new" className="inline-flex min-h-11 w-full items-center justify-center bg-primary px-4 text-sm font-medium text-white hover:bg-ink sm:w-auto">
            Start a project
          </Link>
        }
      />

      <form method="get" className="plot-frame mb-4 grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Filter the registry">
        <div className="col-span-2 sm:col-span-3 lg:col-span-6">
          <label htmlFor="registry-q" className="eyebrow block">Search titles, problems, aims and outcomes</label>
          <input id="registry-q" name="q" defaultValue={q} type="search" className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink" />
        </div>
        <div>
          <label htmlFor="registry-program" className="eyebrow block">Program</label>
          <select id="registry-program" name="program" defaultValue={program} className={`mt-1.5 ${select}`}>
            <option value="">All</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="registry-status" className="eyebrow block">Status</label>
          <select id="registry-status" name="status" defaultValue={status} className={`mt-1.5 ${select}`}>
            <option value="">All, including archived</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="registry-cler" className="eyebrow block">CLER domain</label>
          <select id="registry-cler" name="cler" defaultValue={cler} className={`mt-1.5 ${select}`}>
            <option value="">All</option>
            {CLER.map((c) => (
              <option key={c} value={c}>{clerLabel(c)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="registry-cohort" className="eyebrow block">Cohort</label>
          <select id="registry-cohort" name="cohort" defaultValue={cohort ? String(cohort) : ""} className={`mt-1.5 ${select}`}>
            <option value="">All</option>
            {cohorts.map((c) => (
              <option key={c.cohortYear} value={String(c.cohortYear)}>{c.cohortYear}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="registry-coach" className="eyebrow block">Coach</label>
          <select id="registry-coach" name="coach" defaultValue={coach} className={`mt-1.5 ${select}`}>
            <option value="">All</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="min-h-11 flex-1 bg-primary px-3 text-sm font-medium text-white hover:bg-ink">Filter</button>
          {filtered && (
            <Link href="/projects" className="inline-flex min-h-11 items-center px-2 text-sm text-primary underline-offset-2 hover:underline">
              Clear
            </Link>
          )}
        </div>
      </form>

      <p className="mb-3 text-sm text-muted" aria-live="polite">
        {projects.length} {projects.length === 1 ? "project" : "projects"}
        {filtered ? " match" : ""}
      </p>

      {projects.length === 0 ? (
        <EmptyState title="Nothing matches">Try fewer filters. Archived projects are included unless you filter them out.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {projects.map((project) => {
            const idleDays = daysSince(project.lastActivityAt);
            const unaccepted = project.handoffs[0];
            const unacceptedDays = unaccepted ? daysSince(unaccepted.createdAt) : null;
            const aim = project.aimStatements[0];
            return (
              <li key={project.id}>
                <PlotFrame label={project.program.specialty} action={<ProjectStatusPill status={project.status} />}>
                  <h2 className="font-display text-lg font-semibold text-ink">
                    <Link href={`/projects/${project.id}`} className="underline-offset-2 hover:underline">
                      {project.title}
                    </Link>
                  </h2>
                  <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted">{project.problemStatement}</p>

                  {aim && (
                    <div className="mt-3 border-l-2 border-grid pl-3">
                      <p className="eyebrow">Aim, version {aim.version}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{aim.text}</p>
                    </div>
                  )}
                  {project.endReason && project.status === "archived" && (
                    <p className="mt-3 text-sm leading-relaxed text-ink">
                      <span className="eyebrow mr-1.5">Why it ended</span>
                      {project.endReason}
                    </p>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <DataPair label="Cohort" value={project.cohortYear ?? "—"} mono />
                    <DataPair label="CLER domain" value={project.clerDomain ? clerLabel(project.clerDomain) : "not set"} />
                    <DataPair label="Coach" value={project.coach?.name ?? "not assigned"} />
                    <DataPair label="Measures · PDSA" value={`${project._count.measures} · ${project._count.pdsaCycles}`} mono />
                  </div>

                  {(project.status === "stalled" ||
                    (project.status === "active" && idleDays > STALL_DAYS) ||
                    (unacceptedDays !== null && unacceptedDays >= HANDOFF_ACCEPTANCE_DAYS)) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {project.status === "stalled" && project.stallReason && <Badge tone="signal">{project.stallReason}</Badge>}
                      {project.status === "active" && idleDays > STALL_DAYS && <Badge tone="signal">no activity in {idleDays} days</Badge>}
                      {unacceptedDays !== null && unacceptedDays >= HANDOFF_ACCEPTANCE_DAYS && (
                        <Badge tone="signal">handoff unaccepted {unacceptedDays} days</Badge>
                      )}
                    </div>
                  )}
                </PlotFrame>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
