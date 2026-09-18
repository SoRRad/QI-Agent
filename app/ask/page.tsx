import { db } from "@/lib/db";
import { Badge, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { PhaseNote } from "@/components/ui/PhaseNote";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const docs = await db.libraryDoc.findMany({
    orderBy: [{ isLocal: "asc" }, { title: "asc" }],
    select: { id: true, slug: true, title: true, isLocal: true, localFieldsRequired: true },
  });

  const localDocs = docs.filter((d) => d.isLocal);

  return (
    <>
      <PageHeader
        eyebrow="Ask"
        title="Library-grounded answers"
        lede="Answers come only from the documents below. Where the library does not cover a question, Ask says so and names the document that should be written — it never falls back on general knowledge for a policy question."
      />

      <div className="flex flex-col gap-4">
        <PhaseNote phase="3">
          Retrieval, citation, the not-covered path and the knowledge-gap queue,
          plus tutor and devil&apos;s advocate modes. The library itself is
          already seeded and readable below.
        </PhaseNote>

        {localDocs.length > 0 && (
          <PlotFrame label={`${localDocs.length} documents require institutional content`}>
            <p className="text-sm leading-relaxed text-muted">
              These are placeholders. Until the institution supplies their
              content, Ask will report questions on these topics as not covered
              rather than answer them, and any answer citing one carries a
              banner saying so.
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {localDocs.map((doc) => (
                <li key={doc.id} className="border-l-2 border-signal pl-3">
                  <p className="text-sm font-semibold text-ink">{doc.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    {doc.localFieldsRequired.length} fields required from the institution
                  </p>
                </li>
              ))}
            </ul>
          </PlotFrame>
        )}

        <PlotFrame label="Institutional library">
          <ul className="divide-y divide-grid">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0 text-sm text-ink">{doc.title}</span>
                {doc.isLocal ? (
                  <Badge tone="signal">local</Badge>
                ) : (
                  <Badge tone="neutral">standard</Badge>
                )}
              </li>
            ))}
          </ul>
        </PlotFrame>
      </div>
    </>
  );
}
