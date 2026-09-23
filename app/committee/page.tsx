import Link from "next/link";
import { db } from "@/lib/db";
import { STALL_DAYS } from "@/lib/jobs/stall";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { Badge, Banner, DataPair, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { PhaseNote } from "@/components/ui/PhaseNote";
import { COMMITTEE_SECTIONS, SectionTabs } from "@/components/ui/SectionTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Committee" };

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

  const [activeCount, stalledCount, idleCount, unacceptedHandoffs, gaps, pulseCount, programs, stalled] =
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
      db.project.findMany({
        where: {
          OR: [
            { status: "stalled" },
            // A handoff unaccepted for 14 days is a stall signal (addition C1).
            { status: "active", handoffs: { some: { acceptedAt: null, createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } } },
          ],
        },
        orderBy: { stalledAt: "asc" },
        select: {
          id: true,
          title: true,
          stalledAt: true,
          stallReason: true,
          program: { select: { specialty: true } },
          status: true,
          owner: { select: { name: true } },
          coach: { select: { name: true } },
          handoffs: { where: { acceptedAt: null }, take: 1, select: { createdAt: true, toUser: { select: { name: true } } } },
        },
      }),
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

        <PlotFrame label={`Stalled queue · ${stalled.length}`}>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Stalled: no PDSA entry or data point in {STALL_DAYS} days. Also listed: active projects whose handoff has
            gone unaccepted for 14 days — rotation is what kills these projects.
          </p>
          {stalled.length === 0 ? (
            <p className="text-sm text-muted">No project is stalled.</p>
          ) : (
            <ul className="divide-y divide-grid" data-testid="stalled-queue">
              {stalled.map((p) => (
                <li key={p.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/projects/${p.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                  {p.status === "stalled" && <p className="mt-0.5 text-sm text-ink">{p.stallReason ?? "No recent activity."}</p>}
                  {p.handoffs[0] && (
                    <p className="mt-0.5 text-sm text-ink">
                      Handoff to {p.handoffs[0].toUser?.name ?? "the incoming owner"} unaccepted for{" "}
                      {Math.floor((Date.now() - p.handoffs[0].createdAt.getTime()) / 86_400_000)} days.
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    {p.program.specialty} · {p.owner?.name ?? "no lead"} · coach {p.coach?.name ?? "none"}
                    {p.stalledAt ? ` · stalled ${Math.floor((Date.now() - p.stalledAt.getTime()) / 86_400_000)} days` : ""}
                  </p>
                </li>
              ))}
            </ul>
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
