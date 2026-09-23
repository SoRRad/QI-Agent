import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CHART_NAMES } from "@/lib/charts/describe";
import { outputColumns } from "@/lib/charts/dataRequest";
import { nextPeriodLabel } from "@/lib/charts/importRows";
import { loadMeasure, measureName, MeasureNotFoundError } from "@/lib/charts/service";
import { AnnotationForm, CsvUpload, ManualPointForm, RemoveLatestPoint } from "@/components/charts/DataEntry";
import { Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const name = await measureName((await params).id);
  return { title: `Data · ${name}` };
}

export default async function MeasureDataPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  let loaded;
  try {
    loaded = await loadMeasure(user, id);
  } catch (error) {
    if (error instanceof MeasureNotFoundError) notFound();
    throw error;
  }
  const { measure, points, canEdit } = loaded;
  const href = `/charts/measures/${measure.id}`;
  const cadence = measure.definitions[0]?.cadence ?? null;
  const labels = points.map((p) => p.periodLabel);
  const latest = points.at(-1);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href={href} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {measure.name}
        </Link>
      </nav>
      <div className="mb-5">
        <span className="eyebrow">
          Data · {CHART_NAMES[measure.chartType]} · {points.length} {points.length === 1 ? "point" : "points"}
        </span>
        <h1 className="mt-1.5 font-display text-2xl font-bold text-ink sm:text-3xl">{measure.name}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {measure.chartType === "p"
            ? "Enter the numerator and denominator; the percentage is computed for you, and the denominator sets how far each month's limits reach."
            : measure.chartType === "u"
              ? "Enter the count and the exposure; the rate is computed for you."
              : measure.chartType === "c"
                ? "Enter each period's count."
                : "Enter each period's measured value."}{" "}
          Values are only ever computed by the system, never typed in as a result.
        </p>
      </div>

      {measure.isLibrary || !canEdit ? (
        <Banner title="You cannot add data to this measure">
          {measure.isLibrary
            ? "A library definition has no data of its own. Add points to a project measure built on it."
            : "Data is entered by the owning program, its coach and the chair."}
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          {!cadence && (
            <Banner tone="signal" title="This measure has no operational definition yet">
              You can enter data, but the next resident will not be able to reproduce it.{" "}
              <Link href={`${href}/definition`} className="text-primary underline underline-offset-2">
                Write the definition
              </Link>
              .
            </Banner>
          )}

          <PlotFrame label="Add one point">
            <ManualPointForm
              measureId={measure.id}
              chartType={measure.chartType}
              cadence={cadence}
              existingLabels={labels}
              suggestedLabel={nextPeriodLabel(latest?.periodLabel, cadence) ?? ""}
            />
          </PlotFrame>

          <PlotFrame label="Upload a CSV">
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                One row per period, oldest first; rows are added after the last point on the chart. A file written to
                this measure&rsquo;s data request has the columns{" "}
                {outputColumns(measure.chartType, cadence ?? "monthly").map((c, i, all) => (
                  <span key={c.name}>
                    <code className="font-mono text-xs text-ink">{c.name}</code>
                    {i < all.length - 1 ? ", " : ""}
                  </span>
                ))}{" "}
                and maps itself.
              </p>
              <CsvUpload measureId={measure.id} chartType={measure.chartType} cadence={cadence} existingLabels={labels} />
            </div>
          </PlotFrame>

          <PlotFrame label="Mark a change on the chart">
            <AnnotationForm
              measureId={measure.id}
              periods={points.map((p) => ({ index: p.periodIndex, label: p.periodLabel }))}
              today={today}
            />
          </PlotFrame>

          {latest && (
            <PlotFrame label="Correct a mistake">
              <p className="mb-3 text-sm leading-relaxed text-muted">
                Only the most recent point can be removed, so the chart&rsquo;s history cannot be rewritten from the
                middle. Removals are recorded in the audit log.
              </p>
              <RemoveLatestPoint measureId={measure.id} label={latest.periodLabel} />
            </PlotFrame>
          )}
        </div>
      )}
    </>
  );
}
