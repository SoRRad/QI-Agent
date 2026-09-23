import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Markdown } from "@/components/ui/Markdown";
import { Badge, Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function LibraryDocPage({ params }: { params: Promise<{ slug: string }> }) {
  await getCurrentUser();
  const { slug } = await params;
  const doc = await db.libraryDoc.findUnique({
    where: { slug },
    select: { title: true, body: true, isLocal: true, localFieldsRequired: true, version: true, updatedAt: true },
  });
  if (!doc) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/ask?mode=library" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Library
        </Link>
      </nav>

      <div className="mb-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Library · version {doc.version}</span>
          {doc.isLocal && <Badge tone="signal">local</Badge>}
        </div>
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{doc.title}</h1>
      </div>

      {doc.isLocal && (
        <div className="mb-4">
          <Banner tone="signal" title="Placeholder: the institution has not yet supplied this policy">
            Ask will not treat this document as policy. It lists what the institution must provide.
          </Banner>
        </div>
      )}

      <PlotFrame>
        <Markdown source={doc.body} />
      </PlotFrame>

      {doc.isLocal && doc.localFieldsRequired.length > 0 && (
        <PlotFrame label="Required from the institution" className="mt-4">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink marker:text-muted">
            {doc.localFieldsRequired.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ol>
        </PlotFrame>
      )}
    </>
  );
}
