import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { INTAKE_STEPS, reviewIntake, STEP_LABELS, type IntakeStep } from "@/lib/projects/intake";
import { loadProjectHeader } from "@/lib/projects/load";
import { intakeSnapshot } from "@/lib/projects/service";
import { AimRubric } from "@/components/projects/AimRubric";
import { AimForm, ContextForm, MeasureForm, PeopleForm, ProblemForm, RemoveMeasureButton, SubmitForm } from "@/components/projects/IntakeForms";
import { SimilarProjects } from "@/components/projects/SimilarProjects";
import { Badge, Banner, cx, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intake" };

const STEP_TITLES: Record<IntakeStep, string> = {
  problem: "What is the problem?",
  aim: "What exactly will change, and by when?",
  measures: "How will you know?",
  people: "Who owns it?",
  context: "Where does it fit?",
  review: "Ready to submit?",
};

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function IntakePage({
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
  if (!canWork || project.status !== "draft") redirect(`/projects/${id}`);

  const raw = Array.isArray(search["step"]) ? search["step"][0] : search["step"];
  const step: IntakeStep = (INTAKE_STEPS as readonly string[]).includes(raw ?? "") ? (raw as IntakeStep) : "problem";
  const index = INTAKE_STEPS.indexOf(step);
  const next = INTAKE_STEPS[index + 1];
  const previous = INTAKE_STEPS[index - 1];

  const snapshot = await intakeSnapshot(id);
  const review = reviewIntake(snapshot);
  const blockedSteps = new Set(review.blockers.map((b) => b.step));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href={`/projects/${id}`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {project.title}
        </Link>
      </nav>

      <div className="mb-4">
        <span className="eyebrow">
          Intake · step {index + 1} of {INTAKE_STEPS.length} · draft
        </span>
        <h1 className="mt-1.5 font-display text-2xl font-bold text-ink sm:text-3xl">{STEP_TITLES[step]}</h1>
      </div>

      <nav aria-label="Intake steps" className="mb-5">
        <ol className="grid grid-cols-3 border border-grid bg-surface sm:grid-cols-6">
          {INTAKE_STEPS.map((s, i) => (
            <li key={s} className="border-b border-r border-grid sm:border-b-0 [&:nth-child(3n)]:border-r-0 sm:[&:nth-child(3n)]:border-r sm:last:border-r-0">
              <Link
                href={`/projects/${id}/intake?step=${s}`}
                aria-current={s === step ? "step" : undefined}
                className={cx(
                  "flex min-h-11 items-center justify-center gap-1.5 px-2 text-xs font-medium",
                  s === step ? "bg-primary text-white" : "text-primary hover:bg-surface-sunken",
                )}
              >
                <span className="font-mono">{i + 1}</span> {STEP_LABELS[s]}
                {s !== "review" && blockedSteps.has(s) && s !== step && (
                  <span className="text-signal" aria-label="needs attention">●</span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-4">
        {step === "problem" && (
          <>
            <PlotFrame label="Problem">
              <ProblemForm projectId={id} title={project.title} problemStatement={project.problemStatement} />
            </PlotFrame>
            <PlotFrame label="Has anyone tried this before?">
              <Suspense fallback={<p className="text-sm text-muted">Searching the registry across every program and year…</p>}>
                <SimilarProjects projectId={id} title={project.title} problemStatement={project.problemStatement} userId={user.id} />
              </Suspense>
            </PlotFrame>
          </>
        )}

        {step === "aim" && (
          <PlotFrame label="Aim statement">
            <AimForm
              projectId={id}
              outcomeDefinition={snapshot.measures.find((m) => m.type === "outcome")?.definition ?? null}
              initial={await aimDraft(id)}
            />
          </PlotFrame>
        )}

        {step === "measures" && (
          <>
            <PlotFrame label={`Measures · ${snapshot.measures.length}`}>
              <MeasureList projectId={id} />
            </PlotFrame>
            <PlotFrame label="Add a measure">
              <MeasureForm
                projectId={id}
                library={await db.measure.findMany({
                  where: { isLibrary: true, deprecated: false },
                  orderBy: { name: "asc" },
                  select: { id: true, name: true, chartType: true },
                })}
              />
            </PlotFrame>
          </>
        )}

        {step === "people" && (
          <PlotFrame label="People">
            <PeopleForm
              projectId={id}
              coaches={await db.user.findMany({ where: { role: { in: ["coach", "chair"] }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })}
              initial={{
                clinicalOwner: snapshot.clinicalOwner ?? "",
                coachId: snapshot.coachId ?? "",
                sponsor: snapshot.sponsor ?? "",
                analystContact: snapshot.analystContact ?? "",
              }}
            />
          </PlotFrame>
        )}

        {step === "context" && (
          <PlotFrame label="Context">
            <ContextForm projectId={id} initial={{ clerDomain: snapshot.clerDomain ?? "", equityStratificationPlan: snapshot.equityStratificationPlan ?? "" }} />
          </PlotFrame>
        )}

        {step === "review" && (
          <>
            {review.blockers.length > 0 ? (
              <Banner tone="signal" title={`${review.blockers.length} ${review.blockers.length === 1 ? "thing stops" : "things stop"} this project being submitted`}>
                <ul className="mt-1 flex flex-col gap-3" data-testid="intake-blockers">
                  {review.blockers.map((b) => (
                    <li key={b.id}>
                      <strong className="font-semibold text-ink">{b.title}.</strong> {b.explanation}{" "}
                      <Link href={`/projects/${id}/intake?step=${b.step}`} className="text-primary underline underline-offset-2">
                        Go to {STEP_LABELS[b.step].toLowerCase()}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Banner>
            ) : (
              <Banner tone="confirm" title="Nothing blocks submission">
                The committee reviews the aim, the measures and the owner next.
              </Banner>
            )}
            {review.warnings.length > 0 && (
              <PlotFrame label="Worth fixing, but not blocking">
                <ul className="flex flex-col gap-2 text-sm">
                  {review.warnings.map((w) => (
                    <li key={w.id}>
                      <span className="font-medium text-ink">{w.title}.</span> <span className="text-muted">{w.explanation}</span>
                    </li>
                  ))}
                </ul>
              </PlotFrame>
            )}
            {review.aim && (
              <PlotFrame label="Aim statement check">
                <AimRubric validation={review.aim} />
              </PlotFrame>
            )}
            <PlotFrame label="Submit">
              <SubmitForm projectId={id} />
            </PlotFrame>
          </>
        )}

        <div className="flex justify-between gap-3">
          {previous ? (
            <Link href={`/projects/${id}/intake?step=${previous}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline">
              ← {STEP_LABELS[previous]}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/projects/${id}/intake?step=${next}`} className="inline-flex min-h-11 items-center bg-primary px-4 text-sm font-medium text-white hover:bg-ink">
              Next: {STEP_LABELS[next]} →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

async function aimDraft(projectId: string) {
  const aim = await db.aimStatement.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  return {
    text: aim?.text ?? "",
    baselineValue: aim?.baselineValue?.toString() ?? "",
    baselineUnit: aim?.baselineUnit ?? "",
    baselinePeriod: aim?.baselinePeriod ?? "",
    target: aim?.target?.toString() ?? "",
    targetUnit: aim?.targetUnit ?? "",
    deadline: isoDate(aim?.deadline ?? null),
    population: aim?.population ?? "",
  };
}

async function MeasureList({ projectId }: { projectId: string }) {
  const measures = await db.measure.findMany({
    where: { projectId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      chartType: true,
      basedOn: { select: { name: true } },
      _count: { select: { dataPoints: true, definitions: true } },
    },
  });
  const has = (t: string) => measures.some((m) => m.type === t);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-muted">
        Every project needs an outcome measure (the result), usually a process measure (whether the change is
        happening), and a <strong className="font-semibold text-ink">balancing measure</strong> (what might get worse).
        Submission is blocked without a balancing measure.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(["outcome", "process", "balancing"] as const).map((t) => (
          <Badge key={t} tone={has(t) ? "confirm" : t === "balancing" ? "signal" : "neutral"}>
            {has(t) ? "✓" : "✗"} {t}
          </Badge>
        ))}
      </div>
      {measures.length > 0 && (
        <ul className="divide-y divide-grid border-y border-grid">
          {measures.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/charts/measures/${m.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                  {m.name}
                </Link>
                <p className="font-mono text-xs text-muted">
                  {m.type} · {m.chartType} chart{m.basedOn ? ` · library: ${m.basedOn.name}` : ""} ·{" "}
                  {m._count.definitions ? "definition written" : "no definition yet"}
                </p>
              </div>
              {m._count.dataPoints === 0 && <RemoveMeasureButton projectId={projectId} measureId={m.id} name={m.name} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
