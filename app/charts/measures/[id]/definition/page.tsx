import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadMeasure, measureName, MeasureNotFoundError } from "@/lib/charts/service";
import { DefinitionForm } from "@/components/charts/DefinitionForm";
import { ReproducibilityCheck } from "@/components/charts/ReproducibilityCheck";
import { Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const name = await measureName((await params).id);
  return { title: `Definition · ${name}` };
}

export default async function DefinitionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  let loaded;
  try {
    loaded = await loadMeasure(user, id);
  } catch (error) {
    if (error instanceof MeasureNotFoundError) notFound();
    throw error;
  }
  const { measure, canEdit } = loaded;
  const latest = measure.definitions[0] ?? null;
  const href = `/charts/measures/${measure.id}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href={href} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {measure.name}
        </Link>
      </nav>
      <div className="mb-5">
        <span className="eyebrow">Operational definition{latest ? ` · version ${latest.version} current` : ""}</span>
        <h1 className="mt-1.5 font-display text-2xl font-bold text-ink sm:text-3xl">{measure.name}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Seven parts, all required: enough for the next resident to pull the same numbers without asking anyone. A
          saved definition is never edited — a change is a new version, and charts plotted under the old one keep
          saying what they meant.
        </p>
      </div>

      {!canEdit ? (
        <Banner title="You can read this definition but not change it">
          {measure.isLibrary
            ? "Library definitions are changed by the chair."
            : "Definitions are written by the owning program, its coach and the chair."}
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          {latest && (
            <PlotFrame label={`Reproducibility check · version ${latest.version}`}>
              <div id="check" className="scroll-mt-24">
                <ReproducibilityCheck
                  measureId={measure.id}
                  version={latest.version}
                  confirmed={
                    latest.reproducibilityConfirmedAt && latest.reproducibilityRestatement
                      ? { query: latest.reproducibilityRestatement, at: latest.reproducibilityConfirmedAt.toISOString() }
                      : null
                  }
                />
              </div>
            </PlotFrame>
          )}

          <PlotFrame label={latest ? `Write version ${latest.version + 1}` : "Write version 1"}>
            <DefinitionForm
              measureId={measure.id}
              measureHref={href}
              nextVersion={(latest?.version ?? 0) + 1}
              initial={{
                numerator: latest?.numerator ?? "",
                denominator: latest?.denominator ?? "",
                inclusions: latest?.inclusions ?? "",
                exclusions: latest?.exclusions ?? "",
                dataSource: latest?.dataSource ?? "",
                puller: latest?.puller ?? "",
                cadence: latest?.cadence ?? "",
              }}
            />
          </PlotFrame>

          {measure.definitions.length > 1 && (
            <PlotFrame label="Earlier versions">
              <ol className="flex flex-col gap-2 text-sm">
                {measure.definitions.slice(1).map((d) => (
                  <li key={d.id} className="flex flex-wrap justify-between gap-2 border-t border-grid pt-2 first:border-t-0 first:pt-0">
                    <span className="text-ink">Version {d.version}</span>
                    <span className="font-mono text-xs text-muted">
                      {d.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                      {d.reproducibilityConfirmedAt ? " · confirmed" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </PlotFrame>
          )}
        </div>
      )}
    </>
  );
}
