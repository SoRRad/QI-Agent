import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Badge, DataPair, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { ProjectStatusPill } from "@/components/ui/StatusPill";
import { PhaseNote } from "@/components/ui/PhaseNote";

export const dynamic = "force-dynamic";

const STALL_DAYS = 42;
const HANDOFF_ACCEPTANCE_DAYS = 14;

export default async function ProjectsPage() {
  await getCurrentUser();

  // The registry is readable across programs by design: cross-cohort learning
  // is the point, and it is what makes duplicate detection worth anything.
  // Restricted material (data points, PDSA contents, obstacle notes) is not
  // read here. See lib/auth/scope.ts and docs/SECURITY.md.
  const projects = await db.project.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      problemStatement: true,
      status: true,
      cohortYear: true,
      clerDomain: true,
      lastActivityAt: true,
      program: { select: { specialty: true } },
      aimStatements: { orderBy: { version: "desc" }, take: 1, select: { text: true, version: true } },
      handoffs: {
        where: { acceptedAt: null },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
      _count: { select: { measures: true, pdsaCycles: true } },
    },
  });

  const daysSince = (d: Date): number => Math.floor((Date.now() - d.getTime()) / 86_400_000);

  return (
    <>
      <PageHeader
        eyebrow="Projects"
        title="Registry"
        lede="Every project has a permanent record, and archived projects stay searchable forever. Titles, problem statements, aims and outcomes are readable across programs so the next cohort does not repeat work."
      />

      <div className="flex flex-col gap-4">
        <PhaseNote phase="5">
          Intake with aim validation and hard blocks, duplicate detection, the
          project workspace, driver diagrams, the PDSA log and the stall job.
          The seeded registry below is real data read through the scope policy.
        </PhaseNote>

        <ul className="flex flex-col gap-4">
          {projects.map((project) => {
            const idleDays = daysSince(project.lastActivityAt);
            const unaccepted = project.handoffs[0];
            const unacceptedDays = unaccepted ? daysSince(unaccepted.createdAt) : null;
            const aim = project.aimStatements[0];

            return (
              <li key={project.id}>
                <PlotFrame
                  label={project.program.specialty}
                  action={<ProjectStatusPill status={project.status} />}
                >
                  <h2 className="font-display text-lg font-semibold text-ink">{project.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {project.problemStatement}
                  </p>

                  {aim && (
                    <div className="mt-3 border-l-2 border-grid pl-3">
                      <p className="eyebrow">Aim, version {aim.version}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{aim.text}</p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <DataPair label="Cohort" value={project.cohortYear ?? "—"} mono />
                    <DataPair
                      label="CLER domain"
                      value={project.clerDomain?.replaceAll("_", " ") ?? "not set"}
                    />
                    <DataPair label="Measures" value={project._count.measures} mono />
                    <DataPair label="PDSA cycles" value={project._count.pdsaCycles} mono />
                  </div>

                  {(idleDays >= STALL_DAYS ||
                    (unacceptedDays !== null && unacceptedDays >= HANDOFF_ACCEPTANCE_DAYS)) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {idleDays >= STALL_DAYS && (
                        <Badge tone="signal">no activity in {idleDays} days</Badge>
                      )}
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
      </div>
    </>
  );
}
