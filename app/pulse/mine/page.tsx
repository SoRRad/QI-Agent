import Link from "next/link";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { CLER_LABEL } from "@/lib/cler";
import { parseReceipts, RECEIPT_COOKIE } from "@/lib/pulse/receipts";
import { quarterLabel } from "@/lib/pulse/quarter";
import { myResponses } from "@/lib/pulse/survey";
import { Banner, CentreRule, EmptyState, Eyebrow, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { BarrierStatusPill } from "@/components/ui/StatusPill";

export const dynamic = "force-dynamic";
export const metadata = { title: "My pulse responses" };

export default async function MyResponsesPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const user = await getCurrentUser();
  const { submitted } = await searchParams;
  const receipts = parseReceipts((await cookies()).get(RECEIPT_COOKIE)?.value);
  const { quarters, responses } = await myResponses(user, receipts);
  const shown = new Set(responses.map((r) => r.surveyId));
  const hidden = quarters.filter((q) => !shown.has(q.id));

  return (
    <>
      <PageHeader
        eyebrow="Pulse"
        title="My responses"
        lede="What you told the committee, and which barrier it became part of. Anonymous responses can be seen again only in the browser you sent them from: the server cannot connect them to you."
      />
      {submitted && (
        <Banner tone="confirm" title="Thank you. Your response was sent." className="mb-4">
          The chair groups responses into themes each quarter; when yours becomes part of a barrier, it shows here with where that
          barrier has got to.
        </Banner>
      )}

      {quarters.length === 0 ? (
        <EmptyState title="You have not responded to a pulse survey yet" action={<Link href="/pulse/survey" className="text-sm text-primary underline underline-offset-2">Go to the survey</Link>} />
      ) : (
        <div className="flex flex-col gap-4">
          {responses.map((r) => (
            <PlotFrame key={r.id} label={`${quarterLabel(r.quarter)} · ${r.identified ? "with your name" : "anonymous"}`}>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="eyebrow">Confidence</dt>
                  <dd className="mt-1 font-mono text-ink">{r.confidence} of 5</dd>
                </div>
                <div>
                  <dt className="eyebrow">Focus area</dt>
                  <dd className="mt-1 text-ink">{r.clerDomain ? CLER_LABEL[r.clerDomain] : "Not given"}</dd>
                </div>
                {r.barrierText && (
                  <div className="sm:col-span-2">
                    <dt className="eyebrow">What you wrote</dt>
                    <dd className="mt-1 whitespace-pre-line leading-relaxed text-ink">{r.barrierText}</dd>
                  </div>
                )}
                {[...r.answers]
                  .sort((a, b) => a.question.position - b.question.position)
                  .map((a) => (
                    <div key={a.question.prompt} className="sm:col-span-2">
                      <dt className="eyebrow">{a.question.prompt}</dt>
                      <dd className="mt-1 text-ink">{a.text ?? a.number}</dd>
                    </div>
                  ))}
              </dl>
              <div className="mt-4 border-t border-grid pt-3">
                <Eyebrow>Where it went</Eyebrow>
                {r.barriers.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">Not yet part of a theme. The chair themes responses during the quarter.</p>
                ) : (
                  r.barriers.map((b) => (
                    <div key={b.id} className="mt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/pulse/barriers/${b.id}`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                          {b.themeLabel}
                        </Link>
                        <BarrierStatusPill status={b.status} />
                      </div>
                      {b.whatChanged && <p className="mt-1 text-sm leading-relaxed text-ink">What changed: {b.whatChanged}</p>}
                    </div>
                  ))
                )}
              </div>
            </PlotFrame>
          ))}

          {hidden.length > 0 && (
            <>
              <CentreRule label="Anonymous, sent from another browser" />
              <ul className="flex flex-col gap-2 text-sm text-muted">
                {hidden.map((q) => (
                  <li key={q.id}>
                    You responded to the {quarterLabel(q.quarter)} survey. It was anonymous and sent from another browser, or this
                    browser&apos;s cookies have been cleared, so it cannot be shown here. That is the anonymity working.
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
