import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { CLER_LABEL } from "@/lib/cler";
import { db } from "@/lib/db";
import { isQuarter, quarterLabel } from "@/lib/pulse/quarter";
import { unthemedResponses } from "@/lib/pulse/theming";
import { ChairOnly, ManageNav } from "@/components/pulse/ManageNav";
import { ManualBarrierForm, ThemingPanel } from "@/components/pulse/ThemingPanel";
import { CentreRule, EmptyState, PageHeader, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Theme pulse responses" };

export default async function ThemesPage({ searchParams }: { searchParams: Promise<{ quarter?: string }> }) {
  const user = await getCurrentUser();
  if (user.role !== "chair") {
    return (
      <>
        <PageHeader eyebrow="Pulse" title="Theme responses" />
        <ChairOnly />
      </>
    );
  }
  const surveys = await db.pulseSurvey.findMany({ where: { status: { not: "draft" } }, orderBy: { quarter: "desc" }, select: { quarter: true } });
  const requested = (await searchParams).quarter;
  const quarter = requested && isQuarter(requested) ? requested : surveys[0]?.quarter;

  const responses = quarter
    ? (await unthemedResponses(quarter)).map((r) => ({
        id: r.id,
        text: r.barrierText ?? "",
        meta: [
          `confidence ${r.confidence}`,
          r.clerDomain ? CLER_LABEL[r.clerDomain] : null,
          r.program?.name ?? null,
          r.respondentName ? `${r.respondentName} (asked for follow-up)` : "anonymous",
        ]
          .filter(Boolean)
          .join(" · "),
      }))
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Pulse · chair"
        title="Theme responses"
        lede="Group this quarter's free text into a few themes. Themes are what everyone else sees, so they paraphrase: no run of six or more words from any response, whoever writes it."
      />
      <ManageNav current="/pulse/manage/themes" />

      {surveys.length > 1 && (
        <nav aria-label="Quarter" className="mb-4 flex flex-wrap gap-2 text-sm">
          {surveys.map((s) => (
            <Link key={s.quarter} href={`/pulse/manage/themes?quarter=${s.quarter}`} aria-current={s.quarter === quarter ? "page" : undefined} className="text-primary underline underline-offset-2">
              {s.quarter}
            </Link>
          ))}
        </nav>
      )}

      {!quarter || responses.length === 0 ? (
        <EmptyState title={quarter ? `Every response from ${quarterLabel(quarter)} is in a barrier` : "No survey has been run yet"} />
      ) : (
        <div className="flex flex-col gap-4">
          <PlotFrame label={`${quarterLabel(quarter)} · ${responses.length} responses not yet in a barrier`}>
            <ThemingPanel quarter={quarter} responses={responses} />
          </PlotFrame>
          <CentreRule label="Or group them by hand" />
          <PlotFrame>
            <ManualBarrierForm responses={responses} />
          </PlotFrame>
        </div>
      )}
    </>
  );
}
