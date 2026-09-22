import Link from "next/link";
import { db } from "@/lib/db";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { COMMITTEE_SECTIONS, SectionTabs } from "@/components/ui/SectionTabs";
import { Badge, Banner, PageHeader, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function LibraryAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  let user;
  try {
    user = await requireRole("chair", "coach");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return <Banner tone="signal" title="Committee is restricted to coaches and the chair">Your role does not include committee access.</Banner>;
    }
    throw error;
  }
  const { saved } = await searchParams;
  const canEdit = user.role === "chair";

  const docs = await db.libraryDoc.findMany({
    orderBy: [{ isLocal: "desc" }, { title: "asc" }],
    select: {
      slug: true,
      title: true,
      isLocal: true,
      version: true,
      updatedAt: true,
      localFieldsRequired: true,
      updatedBy: { select: { name: true } },
    },
  });
  const local = docs.filter((d) => d.isLocal);

  return (
    <>
      <PageHeader
        eyebrow="Committee"
        title="Library"
        lede="The documents Ask answers from — and only from. Every edit creates a new version."
        action={
          canEdit ? (
            <Link href="/committee/library/new" className="inline-flex min-h-11 items-center justify-center bg-primary px-4 text-sm font-medium text-white hover:bg-ink">
              New document
            </Link>
          ) : undefined
        }
      />
      <SectionTabs label="Committee sections" current="library" items={COMMITTEE_SECTIONS} />

      <div className="flex flex-col gap-4">
        {saved && <Banner tone="confirm" title="Saved">The new version is live in Ask.</Banner>}

        {local.length > 0 && (
          <Banner tone="signal" title={`${local.length} documents still need institutional content`}>
            Until they are written, Ask reports questions on these topics as not covered, and flags any answer
            that relies on one. Replacing a placeholder with real policy is the single most useful thing the
            library needs.
          </Banner>
        )}

        <PlotFrame label={`${docs.length} documents`}>
          <ul className="divide-y divide-grid">
            {docs.map((doc) => (
              <li key={doc.slug} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={canEdit ? `/committee/library/${doc.slug}` : `/ask/library/${doc.slug}`}
                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {doc.title}
                    </Link>
                    {doc.isLocal && <Badge tone="signal">local</Badge>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted" data-numeric="">
                    v{doc.version} · {doc.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {doc.updatedBy ? ` · ${doc.updatedBy.name}` : " · seeded"}
                    {doc.isLocal ? ` · ${doc.localFieldsRequired.length} items required` : ""}
                  </p>
                </div>
                {canEdit && (
                  <Link href={`/committee/library/${doc.slug}`} className="text-xs text-primary underline-offset-2 hover:underline">
                    Edit
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </PlotFrame>
      </div>
    </>
  );
}
