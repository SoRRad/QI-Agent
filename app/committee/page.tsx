import { db } from "@/lib/db";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { Badge, Banner, DataPair, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { PhaseNote } from "@/components/ui/PhaseNote";
import { COMMITTEE_SECTIONS, SectionTabs } from "@/components/ui/SectionTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Committee" };

const STALL_DAYS = 42;

export default async function CommitteePage() {
  // Chair and coach only. Trainees never see this destination in the nav, and
  // the route refuses them regardless of how they arrived.
  try {
    await requireRole("chair", "coach");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return (
        <Banner tone="signal" title="Committee is restricted to coaches and the chair">
          Your role does not include committee access. If that is wrong, the
          chair can change your role.
        </Banner>
      );
    }
    throw error;
  }

  const staleBefore = new Date(Date.now() - STALL_DAYS * 86_400_000);

  const [activeCount, stalledCount, idleCount, unacceptedHandoffs, gaps, pulseCount, programs] =
    await Promise.all([
      db.project.count({ where: { status: "active" } }),
      db.project.count({ where: { status: "stalled" } }),
      db.project.count({
        where: { status: "active", lastActivityAt: { lt: staleBefore } },
      }),
      db.handoff.count({
        where: { acceptedAt: null, createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } },
      }),
      db.knowledgeGap.findMany({
        where: { status: "open" },
        orderBy: { askCount: "desc" },
        select: { id: true, question: true, askCount: true, gapSummary: true },
      }),
      db.pulseResponse.count(),
      db.program.count(),
    ]);

  return (
    <>
      <PageHeader
        eyebrow="Committee"
        title="Chair dashboard"
        lede="The institution's headline trainee-sensitive measure opens this page as an annotated run chart, not a grid of stat cards. Institution-level measures are always plotted over time."
      />
      <SectionTabs label="Committee sections" current="dashboard" items={COMMITTEE_SECTIONS} />

      <div className="flex flex-col gap-4">
        <PhaseNote phase="8">
          The signature element — a live annotated run chart of the headline
          measure — is built here in phase 8, once the SPC engine (phase 1) and
          the chart components (phase 4) exist. Event kits, judging, the
          curriculum tracker, the milestone mapper, the CLER mock, coach
          matching and the annual report generator follow.
        </PhaseNote>

        <PlotFrame label="Attention now">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <DataPair label="Active projects" value={activeCount} mono />
            <DataPair label="Stalled" value={stalledCount} mono />
            <DataPair label="Idle past 42 days" value={idleCount} mono />
            <DataPair label="Pulse responses" value={pulseCount} mono />
          </div>
          {(stalledCount > 0 || unacceptedHandoffs > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {stalledCount > 0 && <Badge tone="signal">{stalledCount} stalled</Badge>}
              {unacceptedHandoffs > 0 && (
                <Badge tone="signal">
                  {unacceptedHandoffs} handoff{unacceptedHandoffs === 1 ? "" : "s"} unaccepted past
                  14 days
                </Badge>
              )}
            </div>
          )}
        </PlotFrame>

        <PlotFrame label={`Knowledge gaps · ${gaps.length} open`}>
          <p className="text-sm leading-relaxed text-muted">
            Questions Ask could not answer from the library. This is the queue
            of documents the institution still owes, ordered by how often the
            question has been asked.
          </p>
          <ul className="mt-3 divide-y divide-grid">
            {gaps.map((gap) => (
              <li key={gap.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium text-ink">{gap.question}</p>
                  <span className="shrink-0 font-mono text-xs text-muted" data-numeric="">
                    ×{gap.askCount}
                  </span>
                </div>
                {gap.gapSummary && (
                  <p className="mt-1 text-sm leading-relaxed text-muted">{gap.gapSummary}</p>
                )}
              </li>
            ))}
          </ul>
        </PlotFrame>

        <PlotFrame label="Institution">
          <DataPair label="Programs" value={programs} mono />
        </PlotFrame>
      </div>
    </>
  );
}
