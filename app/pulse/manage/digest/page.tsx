import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { undigestedClosedBarriers } from "@/lib/pulse/digest";
import { DigestComposer } from "@/components/pulse/DigestComposer";
import { ChairOnly, ManageNav } from "@/components/pulse/ManageNav";
import { CentreRule, PageHeader, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pulse digest" };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function DigestPage() {
  const user = await getCurrentUser();
  if (user.role !== "chair") {
    return (
      <>
        <PageHeader eyebrow="Pulse" title="Digest" />
        <ChairOnly />
      </>
    );
  }
  const [pending, published] = await Promise.all([
    undigestedClosedBarriers(),
    db.pulseDigest.findMany({ where: { publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, select: { id: true, headline: true, publishedAt: true, barrierIds: true } }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Pulse · chair"
        title="“You reported, we changed”"
        lede="The digest reports closed barriers only, each once. It is drafted from each barrier's decision and what changed — never from a response — and you edit it before it goes to trainees."
      />
      <ManageNav current="/pulse/manage/digest" />
      <div className="flex flex-col gap-4">
        <PlotFrame label={`${pending.length} closed ${pending.length === 1 ? "barrier" : "barriers"} not yet reported`}>
          {pending.length > 0 ? (
            <ul className="mb-4 flex flex-col gap-1.5 text-sm" data-testid="digest-pending">
              {pending.map((b) => (
                <li key={b.id}>
                  <Link href={`/pulse/barriers/${b.id}`} className="text-primary underline underline-offset-2">
                    {b.themeLabel}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-muted">Close a barrier, with what changed, and it will be ready to report here.</p>
          )}
          <DigestComposer available={pending.length} />
        </PlotFrame>

        {published.length > 0 && (
          <>
            <CentreRule label="Published" />
            <ul className="flex flex-col gap-2 text-sm">
              {published.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-2 border-b border-grid py-2">
                  <span>{d.headline}</span>
                  <span className="font-mono text-xs text-muted">
                    {d.publishedAt ? day(d.publishedAt) : ""} · {d.barrierIds.length} barriers
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
