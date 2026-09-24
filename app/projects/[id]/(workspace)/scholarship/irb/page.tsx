import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadProjectHeader } from "@/lib/projects/load";
import { OUTCOME_LABEL } from "@/lib/scholarship/irb";
import { IRB_POLICY_SLUG, latestPrecheck } from "@/lib/scholarship/service";
import { IrbForm } from "@/components/scholarship/IrbForm";
import { ScholarshipNav } from "@/components/scholarship/ScholarshipNav";
import { Markdown } from "@/components/ui/Markdown";
import { Badge, Banner, CentreRule, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function IrbPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ screened?: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  if (!loaded.canWork) {
    return <Banner title="Scholarship drafts are part of the working record">They are visible to the owning program, its coach and the chair.</Banner>;
  }
  const [latest, history, policy] = await Promise.all([
    latestPrecheck(loaded.user, id),
    db.irbPrecheck.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, select: { id: true, outcome: true, createdAt: true, policyDocId: true } }),
    db.libraryDoc.findUnique({ where: { slug: IRB_POLICY_SLUG }, select: { title: true, isLocal: true } }),
  ]);
  const { screened } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <ScholarshipNav projectId={id} current="irb" />
      <Banner title="A screening, not a determination">
        Answer the questions and this drafts a memo to send with a determination request. Only the institution&apos;s determining office can say
        whether this is quality improvement or research. Where the answers pull both ways, the screening says so rather than choosing.
        {policy?.isLocal !== false && (
          <>
            {" "}
            <strong className="text-ink">The institution&apos;s determination policy is not yet in the library</strong>, so the memo will say what is
            missing rather than cite it.
          </>
        )}
      </Banner>

      {latest && (
        <PlotFrame
          label={`Latest screening · ${day(latest.createdAt)}${latest.createdBy ? ` · ${latest.createdBy.name}` : ""}`}
          action={<Badge className="shrink-0 whitespace-nowrap" tone={latest.outcome === "likely_qi" ? "confirm" : latest.outcome === "likely_research" ? "signal" : "primary"}>{latest.outcome.replace("_", " ")}</Badge>}
        >
          {screened && <p className="mb-3 text-sm font-semibold text-confirm">Screened. The memo below is a draft to adapt and send.</p>}
          <div id="memo" data-testid="irb-memo" className="text-sm">
            <Markdown source={latest.memo} />
          </div>
          <a
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(latest.memo)}`}
            download="qi-screening-memo.md"
            className="mt-3 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
          >
            Download the memo
          </a>
        </PlotFrame>
      )}

      <PlotFrame label={latest ? "Screen again" : "Screen this project"}>
        <IrbForm projectId={id} />
      </PlotFrame>

      {history.length > 1 && (
        <>
          <CentreRule label="Earlier screenings" />
          <ul className="flex flex-col gap-1 text-sm">
            {history.slice(1).map((h) => (
              <li key={h.id} className="flex justify-between border-b border-grid py-2">
                <span>{OUTCOME_LABEL[h.outcome]}</span>
                <span className="font-mono text-xs text-muted">
                  {day(h.createdAt)} · {h.policyDocId ? "cited local policy" : "policy gap declared"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
