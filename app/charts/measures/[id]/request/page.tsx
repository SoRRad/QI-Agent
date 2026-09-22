import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultRange } from "@/lib/charts/dataRequest";
import { loadMeasure, measureName, MeasureNotFoundError } from "@/lib/charts/service";
import { DataRequestForm } from "@/components/charts/DataRequestForm";
import { Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const name = await measureName((await params).id);
  return { title: `Data request · ${name}` };
}

export default async function DataRequestPage({ params }: { params: Promise<{ id: string }> }) {
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
  const href = `/charts/measures/${measure.id}`;
  const today = new Date();
  const range = defaultRange(today);
  const slug = measure.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href={href} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {measure.name}
        </Link>
      </nav>
      <div className="mb-5">
        <span className="eyebrow">Data request</span>
        <h1 className="mt-1.5 font-display text-2xl font-bold text-ink sm:text-3xl">{measure.name}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          A written specification an analyst can act on without a meeting: the question, the date range, the fields,
          the filters and exactly what file to send back. Waiting on data is the most common reason a trainee project
          stalls.
        </p>
      </div>

      {!canEdit || measure.isLibrary ? (
        <Banner title="Data requests are written from a project's measure">
          {measure.isLibrary
            ? "This is a library definition. Open a project measure built on it to request data."
            : "The owning program, its coach and the chair can write a data request for this measure."}
        </Banner>
      ) : !measure.definitions[0] ? (
        <Banner tone="signal" title="Write the operational definition first">
          A data request is built from the definition.{" "}
          <Link href={`${href}/definition`} className="text-primary underline underline-offset-2">
            Write it
          </Link>
          .
        </Banner>
      ) : (
        <PlotFrame label="Date range">
          <DataRequestForm
            measureId={measure.id}
            defaultFrom={range.from}
            defaultTo={range.to}
            maxMonth={range.to}
            fileName={`data-request-${slug}.md`}
          />
        </PlotFrame>
      )}
    </>
  );
}
