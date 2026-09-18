import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { CentreRule, Eyebrow, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { BarrierStatusPill } from "@/components/ui/StatusPill";
import { PhaseNote } from "@/components/ui/PhaseNote";

export const dynamic = "force-dynamic";

export default async function PulsePage() {
  await getCurrentUser();

  // "You reported, we changed" leads the page (addition C2). The loop must be
  // visible before the ask, or reporting rates decay.
  const closed = await db.barrier.findMany({
    where: { status: "closed", whatChanged: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { id: true, themeLabel: true, whatChanged: true, decision: true, closedAt: true },
  });

  const open = await db.barrier.findMany({
    where: { status: { not: "closed" } },
    orderBy: { raisedAt: "desc" },
    select: { id: true, themeLabel: true, summary: true, status: true, count: true },
  });

  return (
    <>
      <PageHeader
        eyebrow="Pulse"
        title="You reported, we changed"
        lede="What trainees raised, and what happened as a result. This comes before the survey form deliberately: a reporting system that never visibly closes the loop stops being used."
      />

      <div className="flex flex-col gap-4">
        {closed.length > 0 && (
          <ul className="flex flex-col gap-4">
            {closed.map((barrier) => (
              <li key={barrier.id}>
                <PlotFrame
                  label={
                    barrier.closedAt
                      ? `Closed ${barrier.closedAt.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`
                      : "Closed"
                  }
                  action={<BarrierStatusPill status="closed" />}
                >
                  <h2 className="font-display text-lg font-semibold text-ink">
                    {barrier.themeLabel}
                  </h2>
                  <div className="mt-3 border-l-2 border-confirm pl-3">
                    <Eyebrow>What changed</Eyebrow>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{barrier.whatChanged}</p>
                  </div>
                  {barrier.decision && (
                    <div className="mt-3">
                      <Eyebrow>Decision recorded</Eyebrow>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{barrier.decision}</p>
                    </div>
                  )}
                </PlotFrame>
              </li>
            ))}
          </ul>
        )}

        <CentreRule label="Open barriers" />

        <PlotFrame label={`${open.length} in progress`}>
          <ul className="divide-y divide-grid">
            {open.map((barrier) => (
              <li key={barrier.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{barrier.themeLabel}</span>
                  <BarrierStatusPill status={barrier.status} />
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{barrier.summary}</p>
                <p className="mt-1.5 font-mono text-xs text-muted">
                  {barrier.count} responses in this theme
                </p>
              </li>
            ))}
          </ul>
        </PlotFrame>

        <PhaseNote phase="6">
          The survey instrument, theming into paraphrased summaries, the
          barrier lifecycle, the generated digest and response rate by program.
          Free text is PHI-scanned on submit; the themes above are seeded.
        </PhaseNote>
      </div>
    </>
  );
}
