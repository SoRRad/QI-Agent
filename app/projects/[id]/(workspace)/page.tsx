import { notFound } from "next/navigation";
import { validateAim } from "@/lib/aim/validate";
import { db } from "@/lib/db";
import { loadProjectHeader } from "@/lib/projects/load";
import { AimRubric } from "@/components/projects/AimRubric";
import { AimForm } from "@/components/projects/IntakeForms";
import { ArchiveForm, CompletionForm, ReviewDecision } from "@/components/projects/LifecycleForms";
import { Banner, DataPair, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function ProjectAimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  const { user, project, canWork } = loaded;

  const [aims, restricted, outcome, measures, plan] = await Promise.all([
    db.aimStatement.findMany({ where: { projectId: id }, orderBy: { version: "desc" }, include: { author: { select: { name: true } } } }),
    canWork
      ? db.project.findUnique({
          where: { id },
          select: { clinicalOwner: true, sponsor: true, analystContact: true, equityStratificationPlan: true, stallReason: true, obstacleNotes: true },
        })
      : null,
    db.measure.findFirst({
      where: { projectId: id, type: "outcome" },
      select: { definitions: { orderBy: { version: "desc" }, take: 1, select: { numerator: true, denominator: true } } },
    }),
    db.measure.findMany({ where: { projectId: id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.sustainabilityPlan.findUnique({ where: { projectId: id }, include: { continuingMeasure: { select: { name: true } } } }),
  ]);
  const current = aims[0] ?? null;
  const outcomeDefinition = outcome?.definitions[0] ?? null;
  const validation = current
    ? validateAim({
        text: current.text,
        baselineValue: current.baselineValue,
        baselinePeriod: current.baselinePeriod,
        target: current.target,
        deadline: current.deadline,
        population: current.population,
        measure: outcomeDefinition,
      })
    : null;
  const reviewer = user.role === "chair" || (user.role === "coach" && project.coachId === user.id);

  return (
    <div className="flex flex-col gap-4">
      {search["submitted"] && project.status === "submitted" && (
        <Banner tone="confirm" title="Submitted for committee review">
          Your coach or the chair approves it next. You can keep refining the aim in the meantime; every save is a new
          version.
        </Banner>
      )}
      {project.status === "stalled" && (
        <Banner tone="signal" title="This project is stalled">
          {restricted?.stallReason ?? "No PDSA entry or data point recently."} Any new PDSA entry or data point returns it to
          active.
        </Banner>
      )}
      {project.status === "archived" && project.endReason && (
        <Banner title={`Archived${project.archivedAt ? ` on ${day(project.archivedAt)}` : ""}`}>
          <p>
            <strong className="font-semibold text-ink">Why it ended.</strong> {project.endReason}
          </p>
          {project.outcomeSummary && (
            <p className="mt-1">
              <strong className="font-semibold text-ink">What it achieved.</strong> {project.outcomeSummary}
            </p>
          )}
        </Banner>
      )}

      <PlotFrame label="Problem">
        <p className="text-sm leading-relaxed text-ink">{project.problemStatement}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DataPair label="Program" value={project.program.name} />
          <DataPair label="CLER domain" value={project.clerDomain?.replaceAll("_", " ") ?? "not set"} />
          {restricted && <DataPair label="Clinical owner" value={restricted.clinicalOwner ?? "not named"} />}
          {restricted?.sponsor && <DataPair label="Sponsor" value={restricted.sponsor} />}
          {restricted?.analystContact && <DataPair label="Data contact" value={restricted.analystContact} />}
        </div>
        {restricted?.equityStratificationPlan && (
          <div className="mt-4">
            <DataPair label="Equity stratification plan" value={restricted.equityStratificationPlan} />
          </div>
        )}
      </PlotFrame>

      <PlotFrame label={current ? `Aim · version ${current.version}` : "Aim"}>
        {current && validation ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
            <div>
              <p className="text-base leading-relaxed text-ink">{current.text}</p>
              <p className="mt-2 font-mono text-xs text-muted">
                {current.author?.name ? `${current.author.name} · ` : ""}
                {day(current.createdAt)}
              </p>
            </div>
            <div className="border border-grid bg-surface p-4 lg:self-start">
              <p className="eyebrow mb-2">Critique rubric</p>
              <AimRubric validation={validation} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No aim statement yet.</p>
        )}
      </PlotFrame>

      {canWork && project.status !== "archived" && project.status !== "complete" && (
        <PlotFrame label={current ? `Write version ${current.version + 1}` : "Write the aim"}>
          <AimForm
            projectId={id}
            outcomeDefinition={outcomeDefinition}
            submitLabel={current ? `Save as version ${current.version + 1}` : "Save aim"}
            initial={{
              text: current?.text ?? "",
              baselineValue: current?.baselineValue?.toString() ?? "",
              baselineUnit: current?.baselineUnit ?? "",
              baselinePeriod: current?.baselinePeriod ?? "",
              target: current?.target?.toString() ?? "",
              targetUnit: current?.targetUnit ?? "",
              deadline: current?.deadline ? current.deadline.toISOString().slice(0, 10) : "",
              population: current?.population ?? "",
            }}
          />
        </PlotFrame>
      )}

      {aims.length > 1 && (
        <PlotFrame label="Earlier versions">
          <ol className="flex flex-col gap-3">
            {aims.slice(1).map((a) => (
              <li key={a.id} className="border-t border-grid pt-3 first:border-t-0 first:pt-0">
                <p className="eyebrow">
                  Version {a.version} · {day(a.createdAt)}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{a.text}</p>
              </li>
            ))}
          </ol>
        </PlotFrame>
      )}

      {project.status === "submitted" && reviewer && (
        <PlotFrame label="Committee review">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Submission already checked the aim, the balancing measure and the clinical owner. Approving makes the
            project active and starts the stall clock.
          </p>
          <ReviewDecision projectId={id} />
        </PlotFrame>
      )}

      {plan && (
        <PlotFrame label="Sustainability plan">
          <div className="grid gap-4 sm:grid-cols-2">
            <DataPair label="Owns the change" value={plan.changeOwner} />
            <DataPair label="Reviewed by" value={plan.reviewer} />
            <DataPair label="Continuing measure" value={plan.continuingMeasure?.name ?? "none"} />
            <DataPair label="Cadence" value={plan.cadence} />
          </div>
          {plan.notes && <p className="mt-3 text-sm leading-relaxed text-muted">{plan.notes}</p>}
        </PlotFrame>
      )}

      {canWork && (project.status === "active" || project.status === "stalled") && (
        <PlotFrame label="Finish">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">Complete the project, with its sustainability plan</summary>
            <div className="mt-4">
              <CompletionForm projectId={id} measures={measures} />
            </div>
          </details>
        </PlotFrame>
      )}

      {user.role === "chair" && project.status !== "archived" && (
        <PlotFrame label="Chair">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">Archive this project</summary>
            <div className="mt-4">
              <ArchiveForm projectId={id} />
            </div>
          </details>
        </PlotFrame>
      )}
    </div>
  );
}
