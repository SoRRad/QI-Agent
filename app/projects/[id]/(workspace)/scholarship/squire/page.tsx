import { notFound } from "next/navigation";
import { loadProjectHeader } from "@/lib/projects/load";
import { assembleSquire, AUTHOR_MARK } from "@/lib/scholarship/squire";
import { squireRecord } from "@/lib/scholarship/service";
import { ScholarshipNav } from "@/components/scholarship/ScholarshipNav";
import { Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function SquirePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  if (!loaded.canWork) {
    return <Banner title="Scholarship drafts are part of the working record">They are visible to the owning program, its coach and the chair.</Banner>;
  }
  const draft = assembleSquire(await squireRecord(loaded.user, id));
  const needing = draft.sections.filter((s) => s.author.length > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <ScholarshipNav projectId={id} current="squire" />
      <Banner tone="primary" title={`SQUIRE 2.0 draft · ${needing} of ${draft.sections.length} sections need your writing`}>
        Assembled just now from this project&apos;s record, PDSA log and charts. No language model wrote any of it, and it states no
        result that is not in the record. Sections marked “{AUTHOR_MARK}” are yours to write.{" "}
        <a href={`/api/projects/${id}/squire`} className="text-primary underline underline-offset-2">
          Download as Markdown
        </a>
        .
      </Banner>

      <ol className="flex flex-col gap-4" data-testid="squire-sections">
        {draft.sections.map((s) => (
          <li key={s.number} data-testid={`squire-${s.number}`}>
            <PlotFrame label={`${s.part} · ${s.number}`}>
              <h2 className="font-display text-lg font-semibold text-ink">{s.title}</h2>
              <p className="mt-0.5 text-xs italic text-muted">{s.asks}</p>
              {s.fromRecord.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5 text-sm leading-relaxed text-ink">
                  {s.fromRecord.map((line, i) => (
                    <p key={i} className={line.trimStart().startsWith("- ") ? "pl-3" : undefined} style={{ marginLeft: `${(line.length - line.trimStart().length) * 0.5}rem` }}>
                      {line.trimStart().replace(/^- /, "• ")}
                    </p>
                  ))}
                </div>
              )}
              {s.author.map((prompt, i) => (
                <div key={i} className="mt-3 border-l-4 border-primary bg-surface-sunken px-3 py-2 text-sm leading-relaxed text-ink">
                  <strong className="font-mono text-xs uppercase tracking-wide">{AUTHOR_MARK}</strong>
                  <p className="mt-0.5">{prompt}</p>
                </div>
              ))}
            </PlotFrame>
          </li>
        ))}
      </ol>
    </div>
  );
}
