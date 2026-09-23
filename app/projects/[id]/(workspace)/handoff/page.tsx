import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentState, HANDOFF_ACCEPTANCE_DAYS } from "@/lib/projects/handoff";
import { loadProjectHeader } from "@/lib/projects/load";
import { AcceptHandoff, HandoffForm } from "@/components/projects/HandoffForms";
import { Badge, Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  const { user, project, canWork } = loaded;
  if (!canWork) {
    return <Banner title="Handoffs are part of the working record">They are visible to the owning program, its coach and the chair.</Banner>;
  }

  const [handoffs, record, people] = await Promise.all([
    db.handoff.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      include: { fromUser: { select: { name: true } }, toUser: { select: { id: true, name: true } } },
    }),
    db.project.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        lastActivityAt: true,
        aimStatements: { orderBy: { version: "desc" }, take: 1, select: { text: true } },
        measures: {
          select: { name: true, type: true, _count: { select: { dataPoints: true } }, dataPoints: { orderBy: { periodIndex: "desc" }, take: 1, select: { periodLabel: true } } },
        },
        pdsaCycles: { orderBy: { number: "asc" }, select: { number: true, completedAt: true, prediction: true, actDecision: true } },
      },
    }),
    db.user.findMany({
      where: { active: true, id: { not: project.ownerId ?? "" } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true },
    }),
  ]);
  const pending = handoffs.find((h) => !h.acceptedAt);
  const state = currentState(
    {
      status: record.status,
      aim: record.aimStatements[0]?.text ?? null,
      lastActivityAt: record.lastActivityAt,
      measures: record.measures.map((m) => ({ name: m.name, type: m.type, points: m._count.dataPoints, lastPeriod: m.dataPoints[0]?.periodLabel ?? null })),
      cycles: record.pdsaCycles.map((c) => ({ number: c.number, completed: !!c.completedAt, hasPrediction: !!c.prediction?.trim(), actDecision: c.actDecision })),
    },
    new Date(),
  );
  const canHandOff = !pending && project.status !== "complete" && project.status !== "archived";

  return (
    <div className="flex flex-col gap-4">
      {pending && (
        <PlotFrame
          label="Waiting to be accepted"
          action={
            <Badge tone={Date.now() - pending.createdAt.getTime() >= HANDOFF_ACCEPTANCE_DAYS * 86_400_000 ? "signal" : "primary"}>
              {Math.floor((Date.now() - pending.createdAt.getTime()) / 86_400_000)} days
            </Badge>
          }
        >
          <Packet handoff={pending} />
          {(pending.toUser?.id === user.id || user.role === "chair") ? (
            <div className="mt-4 border-t border-grid pt-4">
              <AcceptHandoff projectId={id} handoffId={pending.id} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              {pending.toUser?.name ?? "The incoming owner"} accepts it here. After {HANDOFF_ACCEPTANCE_DAYS} days unaccepted, the project is flagged to the committee.
            </p>
          )}
        </PlotFrame>
      )}

      {canHandOff && (
        <>
          <PlotFrame label="Current state, from the record">
            <p className="mb-2 text-sm text-muted">The packet opens with this. It is computed from the project, so it cannot be rosier than the record.</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink" data-testid="handoff-state">
              {state.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </PlotFrame>
          <PlotFrame label="Rotating off? Hand it over">
            <HandoffForm projectId={id} people={people} />
          </PlotFrame>
        </>
      )}

      {handoffs.filter((h) => h.acceptedAt).map((h) => (
        <PlotFrame key={h.id} label={`Handoff · accepted ${day(h.acceptedAt as Date)}`}>
          <Packet handoff={h} />
        </PlotFrame>
      ))}
    </div>
  );
}

function Packet({
  handoff,
}: {
  handoff: {
    createdAt: Date;
    summary: string;
    openItems: string;
    dataAccessNotes: string;
    nextActions: string[];
    coachContact: string | null;
    fromUser: { name: string } | null;
    toUser: { name: string } | null;
  };
}) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed" data-testid="handoff-packet">
      <p className="font-mono text-xs text-muted">
        {handoff.fromUser?.name ?? "—"} → {handoff.toUser?.name ?? "—"} · {day(handoff.createdAt)}
      </p>
      <div>
        <p className="eyebrow">Current state</p>
        <ul className="mt-1 list-disc pl-5 text-ink">
          {handoff.summary.split("\n").map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="eyebrow">Open items</p>
        <p className="mt-1 text-ink">{handoff.openItems}</p>
      </div>
      <div>
        <p className="eyebrow">Data access</p>
        <p className="mt-1 text-ink">{handoff.dataAccessNotes}</p>
      </div>
      <div>
        <p className="eyebrow">Coach</p>
        <p className="mt-1 text-ink">{handoff.coachContact ?? "None assigned"}</p>
      </div>
      <div>
        <p className="eyebrow">Next three actions</p>
        <ol className="mt-1 list-decimal pl-5 text-ink">
          {handoff.nextActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
