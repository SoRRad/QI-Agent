import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CLER_LABEL } from "@/lib/cler";
import { db } from "@/lib/db";
import { STATUS_LABEL, STATUS_ORDER, TARGET_LABEL } from "@/lib/pulse/lifecycle";
import { quarterLabel } from "@/lib/pulse/quarter";
import { EditBarrierForm, TransitionForm } from "@/components/pulse/BarrierForms";
import { Banner, CentreRule, Eyebrow, PageHeader, PlotFrame, cx } from "@/components/ui/primitives";
import { BarrierStatusPill } from "@/components/ui/StatusPill";

export const dynamic = "force-dynamic";

async function load(id: string) {
  return db.barrier.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      pulseResponses: {
        orderBy: { submittedOn: "asc" },
        select: { id: true, quarter: true, barrierText: true, clerDomain: true, confidence: true, respondentName: true, program: { select: { name: true } } },
      },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const barrier = await db.barrier.findUnique({ where: { id: (await params).id }, select: { themeLabel: true } });
  return { title: barrier?.themeLabel ?? "Barrier" };
}

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);

export default async function BarrierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const barrier = await load((await params).id);
  if (!barrier) notFound();
  const chair = user.role === "chair";
  const canMove = chair || barrier.ownerId === user.id;
  const stamps: Record<string, Date | null> = { raised: barrier.raisedAt, at_gmec: barrier.atGmecAt, decided: barrier.decidedAt, closed: barrier.closedAt };
  const owners = chair
    ? await db.user.findMany({ where: { active: true, role: { in: ["chair", "coach"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/pulse/barriers" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Barriers log
        </Link>
      </nav>
      <PageHeader
        eyebrow={`Barrier · ${TARGET_LABEL[barrier.escalationTarget]}${barrier.quarter ? ` · ${quarterLabel(barrier.quarter)}` : ""}`}
        title={barrier.themeLabel}
        action={<BarrierStatusPill status={barrier.status} />}
      />

      <div className="flex flex-col gap-4">
        <PlotFrame label={`${barrier.count} ${barrier.count === 1 ? "response" : "responses"} in this theme`}>
          <p className="text-sm leading-relaxed text-ink">{barrier.summary}</p>
          <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Lifecycle">
            {STATUS_ORDER.map((s) => {
              const reached = STATUS_ORDER.indexOf(s) <= STATUS_ORDER.indexOf(barrier.status);
              return (
                <li key={s} className={cx("border px-2 py-2", reached ? "border-primary" : "border-grid border-dashed")} aria-current={s === barrier.status ? "step" : undefined}>
                  <span className={cx("block text-xs font-semibold", reached ? "text-ink" : "text-muted")}>{STATUS_LABEL[s]}</span>
                  <span className="block font-mono text-[0.6875rem] text-muted">{date(stamps[s] ?? null) ?? "—"}</span>
                </li>
              );
            })}
          </ol>
          {barrier.decision && (
            <div className="mt-4">
              <Eyebrow>Decision recorded</Eyebrow>
              <p className="mt-1 text-sm leading-relaxed text-ink">{barrier.decision}</p>
            </div>
          )}
          {barrier.whatChanged && (
            <div className="mt-3 border-l-2 border-confirm pl-3">
              <Eyebrow>What changed</Eyebrow>
              <p className="mt-1 text-sm leading-relaxed text-ink">{barrier.whatChanged}</p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">{barrier.owner ? `Owner: ${barrier.owner.name}` : "No owner yet."}</p>
        </PlotFrame>

        {canMove && barrier.status !== "closed" && (
          <PlotFrame label="Move it along">
            <TransitionForm barrier={barrier} />
          </PlotFrame>
        )}

        {chair && barrier.status !== "closed" && (
          <PlotFrame label="Edit">
            <EditBarrierForm barrier={barrier} owners={owners} />
          </PlotFrame>
        )}

        {chair ? (
          <>
            <CentreRule label="The responses behind this theme · chair only" />
            <ul className="flex flex-col gap-2" data-testid="barrier-responses">
              {barrier.pulseResponses.map((r) => (
                <li key={r.id} className="border border-grid bg-surface px-4 py-3">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{r.barrierText}</p>
                  <p className="mt-1.5 font-mono text-xs text-muted">
                    {r.quarter} · confidence {r.confidence}
                    {r.clerDomain && ` · ${CLER_LABEL[r.clerDomain]}`}
                    {r.program && ` · ${r.program.name}`}
                    {r.respondentName ? ` · ${r.respondentName} (asked for follow-up)` : " · anonymous"}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Banner title="The responses behind this theme are seen only by the chair">
            This page shows the committee&apos;s summary. What individual trainees wrote stays with the chair, so that nobody is
            recognisable by how they write.
          </Banner>
        )}
      </div>
    </>
  );
}
