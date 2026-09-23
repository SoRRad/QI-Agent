import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadProjectHeader } from "@/lib/projects/load";
import { CycleForm, NewCycleForm } from "@/components/projects/PdsaForms";
import { Badge, Banner, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

export default async function PdsaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  if (!loaded.canWork) {
    return <Banner title="The PDSA log is part of the working record">It is visible to the owning program, its coach and the chair.</Banner>;
  }
  const cycles = await db.pdsaCycle.findMany({ where: { projectId: id }, orderBy: { number: "desc" } });
  const open = cycles.filter((c) => !c.completedAt);
  const done = cycles.filter((c) => c.completedAt);
  const canLog = loaded.project.status === "active" || loaded.project.status === "stalled";

  return (
    <div className="flex flex-col gap-4">
      {cycles.length === 0 && <EmptyState title="No cycles yet">Each cycle tests one change idea from the driver diagram, with a prediction written first.</EmptyState>}

      {open.map((c) => (
        <PlotFrame key={c.id} label={`Cycle ${c.number} · open`} action={c.prediction?.trim() ? undefined : <Badge tone="signal">no prediction</Badge>}>
          {canLog ? (
            <CycleForm
              projectId={id}
              cycle={{ id: c.id, number: c.number, plan: c.plan, prediction: c.prediction, doAction: c.doAction, studyResult: c.studyResult, actDecision: c.actDecision }}
            />
          ) : (
            <p className="text-sm text-muted">{c.plan}</p>
          )}
        </PlotFrame>
      ))}

      {canLog ? (
        <PlotFrame label={`Plan cycle ${(cycles[0]?.number ?? 0) + 1}`}>
          <NewCycleForm projectId={id} nextNumber={(cycles[0]?.number ?? 0) + 1} />
        </PlotFrame>
      ) : (
        loaded.project.status !== "complete" &&
        loaded.project.status !== "archived" && (
          <Banner title="Cycles are logged once the project is approved">Submit it through intake; the committee approves it next.</Banner>
        )
      )}

      {done.map((c) => (
        <PlotFrame key={c.id} label={`Cycle ${c.number} · done ${day(c.completedAt) ?? ""}`} action={c.actDecision ? <Badge tone="primary">{c.actDecision}</Badge> : undefined}>
          <p className="text-sm leading-relaxed text-ink">{c.plan}</p>
          {c.doAction && <p className="mt-2 text-sm leading-relaxed text-muted"><span className="eyebrow mr-1.5">Do</span>{c.doAction}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="border border-grid bg-surface-sunken/60 px-3 py-2">
              <p className="eyebrow">Predicted</p>
              <p className="mt-1 text-sm leading-relaxed text-ink">{c.prediction}</p>
            </div>
            <div className="border border-grid px-3 py-2">
              <p className="eyebrow">What happened</p>
              <p className="mt-1 text-sm leading-relaxed text-ink">{c.studyResult}</p>
            </div>
          </div>
        </PlotFrame>
      ))}
    </div>
  );
}
