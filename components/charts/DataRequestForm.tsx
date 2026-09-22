"use client";

import { useActionState, useState } from "react";
import { dataRequestAction, type DataRequestState } from "@/app/charts/definition-actions";
import { Banner, Button } from "@/components/ui/primitives";

/**
 * The data request generator. The resident picks a date range; the request
 * comes back as a document to copy into an email or ticket, or download. It is
 * not stored: it is a letter to an analyst, not a record.
 */
export function DataRequestForm({
  measureId,
  defaultFrom,
  defaultTo,
  maxMonth,
  fileName,
}: {
  measureId: string;
  defaultFrom: string;
  defaultTo: string;
  maxMonth: string;
  fileName: string;
}) {
  const [state, action, pending] = useActionState<DataRequestState, FormData>(dataRequestAction, { status: "idle" });
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  function download(text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="measureId" value={measureId} />
        <div>
          <label htmlFor="request-from" className="eyebrow block">From (month)</label>
          <input
            id="request-from"
            type="month"
            name="from"
            defaultValue={defaultFrom}
            max={maxMonth}
            required
            className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink sm:w-44"
          />
        </div>
        <div>
          <label htmlFor="request-to" className="eyebrow block">To (month)</label>
          <input
            id="request-to"
            type="month"
            name="to"
            defaultValue={defaultTo}
            max={maxMonth}
            required
            className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink sm:w-44"
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Writing the request…" : "Write the request"}
        </Button>
      </form>

      {state.status === "error" && <Banner tone="signal" title="Could not write the request">{state.message}</Banner>}
      {state.status === "unavailable" && (
        <Banner title="The request is unavailable right now">
          The draft did not pass its own checks, so it was not shown. Try again in a moment.
        </Banner>
      )}

      {state.status === "done" && (
        <div className="flex flex-col gap-3" data-testid="data-request">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => copy(state.markdown)} className="w-full sm:w-auto">
              {copied ? "Copied" : "Copy as text"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => download(state.markdown)} className="w-full sm:w-auto">
              Download (.md)
            </Button>
          </div>
          <article className="border border-grid bg-surface px-4 py-4 text-sm leading-relaxed text-ink">
            <h2 className="font-display text-lg font-bold">Data request: {state.document.measureName}</h2>
            <p className="mt-3">
              <strong>Clinical question.</strong> {state.document.clinicalQuestion}
            </p>
            <p className="mt-2">
              <strong>Requested by.</strong> {state.document.requestedBy}
            </p>
            <p className="mt-2">
              <strong>Date range.</strong>{" "}
              <span data-testid="request-range">
                {state.document.range.fromText} to {state.document.range.toText}: {state.document.range.periods}{" "}
                {state.document.range.periodName}.
              </span>
            </p>

            <h3 className="mt-4 font-semibold">What to return</h3>
            <p className="mt-1">One row per period, as a CSV file with these columns:</p>
            <ul className="mt-1 list-disc pl-5">
              {state.document.columns.map((c) => (
                <li key={c.name}>
                  <code className="font-mono text-xs">{c.name}</code> — {c.description}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted">
              Aggregate counts only. No patient-level rows, names, record numbers or encounter dates: the file is
              uploaded to a system that refuses identifiers.
            </p>

            <h3 className="mt-4 font-semibold">The measure, as defined</h3>
            <ul className="mt-1 list-disc pl-5">
              <li>Numerator: {state.document.definition.numerator}</li>
              <li>Denominator: {state.document.definition.denominator}</li>
              <li>Inclusions: {state.document.definition.inclusions}</li>
              <li>Exclusions: {state.document.definition.exclusions}</li>
            </ul>

            <h3 className="mt-4 font-semibold">Where the data probably lives</h3>
            <p className="mt-1">
              Named source: {state.document.definition.dataSource}. Usually pulled by: {state.document.definition.puller}.
            </p>
            <ul className="mt-1 list-disc pl-5">
              {state.document.systems.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>

            <h3 className="mt-4 font-semibold">Fields needed</h3>
            <ul className="mt-1 list-disc pl-5">
              {state.document.fields.map((f) => (
                <li key={f.name}>
                  {f.name} — {f.purpose}
                </li>
              ))}
            </ul>

            <h3 className="mt-4 font-semibold">Filters</h3>
            <ul className="mt-1 list-disc pl-5">
              {state.document.filters.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>

            {state.document.questions.length > 0 && (
              <>
                <h3 className="mt-4 font-semibold">Please confirm before running</h3>
                <ul className="mt-1 list-disc pl-5">
                  {state.document.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-4 border-t border-grid pt-3 text-xs text-muted">
              The date range, period count and columns were computed by the system. The clinical question, systems,
              fields and filters were drafted by a language model from the definition: check them before sending.
            </p>
          </article>
        </div>
      )}
    </div>
  );
}
