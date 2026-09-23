import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { latestDigest } from "@/lib/pulse/digest";
import { quarterLabel } from "@/lib/pulse/quarter";
import { hasResponded, openSurvey } from "@/lib/pulse/survey";
import { Banner, CentreRule, Eyebrow, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { BarrierStatusPill } from "@/components/ui/StatusPill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pulse" };

const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ published?: string }> }) {
  const user = await getCurrentUser();
  const { published } = await searchParams;

  // "You reported, we changed" leads the page (addition C2). The loop must be
  // visible before the ask, or reporting rates decay.
  const [digest, closed, open, survey] = await Promise.all([
    latestDigest(),
    db.barrier.findMany({
      where: { status: "closed", whatChanged: { not: null } },
      orderBy: { closedAt: "desc" },
      select: { id: true, themeLabel: true, whatChanged: true, decision: true, closedAt: true },
    }),
    db.barrier.findMany({
      where: { status: { not: "closed" } },
      orderBy: { raisedAt: "desc" },
      select: { id: true, themeLabel: true, status: true, count: true },
    }),
    openSurvey(),
  ]);
  const responded = survey && user.role === "trainee" ? await hasResponded(user.id, survey.id) : false;
  const labels = new Map(closed.map((b) => [b.id, b.themeLabel]));

  return (
    <>
      <PageHeader
        eyebrow="Pulse"
        title="You reported, we changed"
        lede="What trainees raised, and what happened as a result. This comes before the survey deliberately: a reporting system that never visibly closes the loop stops being used."
      />
      {published && <Banner tone="confirm" title="Digest published. Trainees see it here, and it was sent to them by email." className="mb-4" />}

      <div className="flex flex-col gap-4">
        {digest && (
          <PlotFrame label={`Digest · ${digest.publishedAt ? monthYear(digest.publishedAt) : ""}`}>
            <h2 className="font-display text-xl font-semibold text-ink">{digest.headline}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{digest.intro}</p>
            <ul className="mt-3 flex flex-col gap-3" data-testid="digest-items">
              {digest.items.map((item) => (
                <li key={item.barrierId} className="border-l-2 border-confirm pl-3 text-sm leading-relaxed text-ink">
                  {item.text}{" "}
                  {labels.has(item.barrierId) && (
                    <Link href={`/pulse/barriers/${item.barrierId}`} className="text-primary underline underline-offset-2">
                      Details
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </PlotFrame>
        )}

        {closed.length > 0 && (
          <ul className="flex flex-col gap-4" data-testid="closed-barriers">
            {closed.map((barrier) => (
              <li key={barrier.id}>
                <PlotFrame label={barrier.closedAt ? `Closed ${monthYear(barrier.closedAt)}` : "Closed"} action={<BarrierStatusPill status="closed" />}>
                  <h2 className="font-display text-lg font-semibold text-ink">
                    <Link href={`/pulse/barriers/${barrier.id}`} className="underline-offset-2 hover:underline">
                      {barrier.themeLabel}
                    </Link>
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

        {survey && (
          <Banner tone="primary" title={`The ${quarterLabel(survey.quarter)} survey is open`}>
            {user.role !== "trainee" ? (
              <>
                Residents and fellows respond on the{" "}
                <Link href="/pulse/survey" className="text-primary underline underline-offset-2">
                  Survey tab
                </Link>
                .
              </>
            ) : responded ? (
              <>You have responded this quarter. Thank you.</>
            ) : (
              <>
                Five minutes, anonymous unless you choose otherwise.{" "}
                <Link href="/pulse/survey" className="text-primary underline underline-offset-2">
                  Take the survey
                </Link>
                .
              </>
            )}
          </Banner>
        )}

        <CentreRule label="In progress" />
        <PlotFrame label={`${open.length} barriers being worked on`}>
          <ul className="divide-y divide-grid">
            {open.map((barrier) => (
              <li key={barrier.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <Link href={`/pulse/barriers/${barrier.id}`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                  {barrier.themeLabel}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">{barrier.count} responses</span>
                  <BarrierStatusPill status={barrier.status} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href="/pulse/barriers" className="text-primary underline underline-offset-2">
              The full barriers log
            </Link>
          </p>
        </PlotFrame>
      </div>
    </>
  );
}
