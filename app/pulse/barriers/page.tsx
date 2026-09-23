import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import type { BarrierStatus } from "@/lib/generated/prisma/client";
import { listBarriers } from "@/lib/pulse/barriers";
import { STATUS_LABEL, STATUS_ORDER, TARGET_LABEL } from "@/lib/pulse/lifecycle";
import { EmptyState, PageHeader, PlotFrame, cx } from "@/components/ui/primitives";
import { BarrierStatusPill } from "@/components/ui/StatusPill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Barriers log" };

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

export default async function BarriersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await getCurrentUser();
  const { status } = await searchParams;
  const filter = STATUS_ORDER.includes(status as BarrierStatus) ? (status as BarrierStatus) : undefined;
  const barriers = await listBarriers(filter);

  return (
    <>
      <PageHeader
        eyebrow="Pulse"
        title="Barriers log"
        lede="Every theme trainees raised, where it has got to, and what was decided. Themes are the committee's paraphrase; the responses behind them are seen only by the chair."
      />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {[undefined, ...STATUS_ORDER].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/pulse/barriers?status=${s}` : "/pulse/barriers"}
            aria-current={filter === s ? "page" : undefined}
            className={cx(
              "flex min-h-11 items-center border px-3 text-sm",
              filter === s ? "border-primary bg-primary text-white" : "border-grid bg-surface text-primary hover:border-muted",
            )}
          >
            {s ? STATUS_LABEL[s] : "All"}
          </Link>
        ))}
      </nav>

      {barriers.length === 0 ? (
        <EmptyState title={filter ? `No barriers are ${STATUS_LABEL[filter].toLowerCase()}` : "No barriers yet"} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="barriers-log">
          {barriers.map((b) => (
            <li key={b.id}>
              <PlotFrame label={`${TARGET_LABEL[b.escalationTarget]} · ${b.count} ${b.count === 1 ? "response" : "responses"}`} action={<BarrierStatusPill status={b.status} />}>
                <h2 className="font-display text-lg font-semibold text-ink">
                  <Link href={`/pulse/barriers/${b.id}`} className="underline-offset-2 hover:underline">
                    {b.themeLabel}
                  </Link>
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{b.summary}</p>
                <p className="mt-2 font-mono text-xs text-muted">
                  Raised {date(b.raisedAt)}
                  {b.atGmecAt && ` · to GMEC ${date(b.atGmecAt)}`}
                  {b.decidedAt && ` · decided ${date(b.decidedAt)}`}
                  {b.closedAt && ` · closed ${date(b.closedAt)}`}
                  {b.owner && ` · owner ${b.owner.name}`}
                </p>
              </PlotFrame>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
