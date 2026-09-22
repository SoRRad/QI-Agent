"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addAnnotationAction,
  addPointsAction,
  removeLatestPointAction,
  type PointsState,
  type SimpleState,
} from "@/app/charts/data-actions";
import type { Cadence } from "@/lib/charts/definitionFields";
import {
  cellsFromRows,
  guessMapping,
  importRows,
  nextPeriodLabel,
  requiredFields,
  type Cells,
  type ColumnMapping,
  type InputField,
} from "@/lib/charts/importRows";
import { INPUT_LABELS } from "@/lib/charts/points";
import { parseCsv, type CsvResult } from "@/lib/csv";
import type { ChartKind } from "@/lib/spc";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Banner, Button } from "@/components/ui/primitives";

const FIELD_LABEL: Record<InputField, string> = { period: "Period", numerator: "Numerator", denominator: "Denominator", value: "Value" };

function fieldLabel(chartType: ChartKind, field: InputField): string {
  return field === "period" ? "Period" : INPUT_LABELS[chartType][field] ?? FIELD_LABEL[field];
}

function Outcome({ state }: { state: PointsState }) {
  if (state.status === "done") {
    return (
      <Banner tone="confirm" title={state.added === 1 ? `Added ${state.first}` : `Added ${state.added} points, ${state.first} to ${state.last}`}>
        The chart and its findings are recomputed from the new data.
      </Banner>
    );
  }
  if (state.status === "error") return <Banner tone="signal" title="Nothing was added">{state.message}</Banner>;
  if (state.status === "rejected") {
    const bad = state.rows.filter((r) => r.error);
    return (
      <Banner tone="signal" title={`Nothing was added: ${bad.length} ${bad.length === 1 ? "row needs" : "rows need"} fixing`}>
        <ul className="list-disc pl-5">
          {bad.slice(0, 8).map((r) => (
            <li key={r.row}>
              Row {r.row}: {r.error}
            </li>
          ))}
        </ul>
      </Banner>
    );
  }
  if (state.status === "phi") return <PhiNotice feedback={state} />;
  return null;
}

// ---------------------------------------------------------------- manual entry

export function ManualPointForm({
  measureId,
  chartType,
  cadence,
  existingLabels,
  suggestedLabel,
}: {
  measureId: string;
  chartType: ChartKind;
  cadence: Cadence | null;
  existingLabels: string[];
  suggestedLabel: string;
}) {
  const [state, action, pending] = useActionState<PointsState, FormData>(addPointsAction, { status: "idle" });
  const [cells, setCells] = useState<Cells>({ period: suggestedLabel });
  const fields = requiredFields(chartType).filter((f) => f !== "period") as Array<Exclude<InputField, "period">>;
  const preview = useMemo(
    () => importRows([cells], chartType, cadence, new Set(existingLabels))[0],
    [cells, chartType, cadence, existingLabels],
  );

  // After a point is added, clear the numbers and suggest the next period.
  useEffect(() => {
    if (state.status === "done") setCells({ period: nextPeriodLabel(state.last, cadence) ?? "" });
  }, [state, cadence]);
  const ready = !!cells.period.trim() && fields.every((f) => (cells[f] ?? "").trim() !== "");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="measureId" value={measureId} />
      <input type="hidden" name="cells" value={JSON.stringify([cells])} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="manual-period" className="eyebrow block">Period</label>
          <input
            id="manual-period"
            value={cells.period}
            onChange={(e) => setCells({ ...cells, period: e.target.value })}
            placeholder="e.g. Oct 2026"
            className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink"
          />
        </div>
        {fields.map((field) => (
          <div key={field}>
            <label htmlFor={`manual-${field}`} className="eyebrow block">{fieldLabel(chartType, field)}</label>
            <input
              id={`manual-${field}`}
              inputMode="decimal"
              value={cells[field] ?? ""}
              onChange={(e) => setCells({ ...cells, [field]: e.target.value })}
              className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 font-mono text-sm text-ink"
            />
          </div>
        ))}
      </div>
      {ready && preview && (
        <p className={preview.error ? "text-sm text-signal" : "text-sm text-muted"} aria-live="polite">
          {preview.error ?? `Will plot ${preview.label} at ${formatPreview(preview.point?.value, chartType)}.`}
        </p>
      )}
      <Outcome state={state} />
      <Button type="submit" disabled={pending || !ready || !!preview?.error} className="w-full sm:w-auto sm:self-start">
        {pending ? "Adding…" : "Add point"}
      </Button>
    </form>
  );
}

function formatPreview(value: number | undefined, chartType: ChartKind): string {
  if (value === undefined) return "";
  if (chartType === "p") return `${value.toFixed(1)}%`;
  if (chartType === "c") return String(value);
  return Number(value.toPrecision(4)).toString();
}

// ---------------------------------------------------------------- CSV upload

export function CsvUpload({
  measureId,
  chartType,
  cadence,
  existingLabels,
}: {
  measureId: string;
  chartType: ChartKind;
  cadence: Cadence | null;
  existingLabels: string[];
}) {
  const [state, action, pending] = useActionState<PointsState, FormData>(addPointsAction, { status: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<CsvResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const needed = requiredFields(chartType);

  const rows = useMemo(() => {
    if (!csv || csv.error) return [];
    return importRows(cellsFromRows(csv.rows, mapping), chartType, cadence, new Set(existingLabels));
  }, [csv, mapping, chartType, cadence, existingLabels]);
  const mapped = needed.every((f) => mapping[f] !== undefined);
  const errors = rows.filter((r) => r.error);

  async function choose(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    setCsv(parsed);
    setMapping(parsed.error ? {} : guessMapping(parsed.headers, chartType));
  }

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-3">
        <Outcome state={state} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="csv-file" className="eyebrow block">CSV file</label>
        <p id="csv-file-help" className="mt-1 text-xs leading-relaxed text-muted">
          The file is read in your browser and never uploaded. Only the columns you map below are sent, and nothing is
          stored until you add the rows.
        </p>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-describedby="csv-file-help"
          onChange={(e) => choose(e.target.files?.[0])}
          className="mt-2 block w-full text-sm text-ink file:mr-3 file:min-h-11 file:border file:border-grid file:bg-surface file:px-4 file:text-sm file:font-medium file:text-primary"
        />
      </div>

      {csv?.error && <Banner tone="signal" title={`Could not read ${fileName ?? "the file"}`}>{csv.error}</Banner>}

      {csv && !csv.error && (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold text-ink">
              Which column is which? <span className="font-normal text-muted">({csv.rows.length} rows in {fileName})</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {needed.map((field) => (
                <div key={field}>
                  <label htmlFor={`map-${field}`} className="eyebrow block">{fieldLabel(chartType, field)}</label>
                  <select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink"
                  >
                    <option value="">Choose a column…</option>
                    {csv.headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {csv.warnings.length > 0 && <p className="text-xs text-muted">{csv.warnings[0]}{csv.warnings.length > 1 ? ` (and ${csv.warnings.length - 1} more)` : ""}</p>}
          </fieldset>

          {mapped && rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink" aria-live="polite">
                {errors.length === 0
                  ? `${rows.length} rows ready to add.`
                  : `${errors.length} of ${rows.length} rows need fixing in the file before anything can be added.`}
              </p>
              <div className="max-h-72 overflow-auto border border-grid" tabIndex={0} role="region" aria-label="Preview of the rows to add">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-grid">
                      <th scope="col" className="px-2 py-1.5 font-mono font-medium text-muted">Row</th>
                      <th scope="col" className="px-2 py-1.5 font-mono font-medium text-muted">Period</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-mono font-medium text-muted">Plots as</th>
                      <th scope="col" className="px-2 py-1.5 font-mono font-medium text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} className="border-b border-grid/70">
                        <td className="px-2 py-1 font-mono text-muted">{r.row}</td>
                        <td className="px-2 py-1 font-mono text-ink">{r.label || "—"}</td>
                        <td className="px-2 py-1 text-right font-mono text-ink">{r.point ? formatPreview(r.point.value, chartType) : "—"}</td>
                        <td className={r.error ? "px-2 py-1 text-signal" : "px-2 py-1 text-muted"}>{r.error ?? "ok"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="measureId" value={measureId} />
            <input type="hidden" name="cells" value={JSON.stringify(mapped ? cellsFromRows(csv.rows, mapping) : [])} />
            <Outcome state={state} />
            <Button type="submit" disabled={pending || !mapped || rows.length === 0 || errors.length > 0} className="w-full sm:w-auto sm:self-start">
              {pending ? "Adding…" : `Add ${rows.length} ${rows.length === 1 ? "point" : "points"}`}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- annotations

export function AnnotationForm({
  measureId,
  periods,
  today,
}: {
  measureId: string;
  periods: Array<{ index: number; label: string }>;
  today: string;
}) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(addAnnotationAction, { status: "idle" });
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState({ label: "", description: "" });

  if (state.status === "done") return <Banner tone="confirm" title={state.message}>It appears on the chart as a numbered flag.</Banner>;

  return (
    <form action={action} onSubmit={() => setSubmitted({ label, description })} className="flex flex-col gap-3">
      <input type="hidden" name="measureId" value={measureId} />
      <div>
        <label htmlFor="annotation-label" className="eyebrow block">What changed</label>
        <input
          id="annotation-label"
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Discharge summary moved into the afternoon huddle"
          required
          minLength={3}
          className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="annotation-period" className="eyebrow block">First period affected</label>
          <select id="annotation-period" name="periodIndex" defaultValue="" className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink">
            <option value="">Not tied to a plotted period</option>
            {periods.map((p) => (
              <option key={p.index} value={p.index}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="annotation-date" className="eyebrow block">Date of the change</label>
          <input id="annotation-date" name="date" type="date" defaultValue={today} max={today} required className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink" />
        </div>
      </div>
      <div>
        <label htmlFor="annotation-description" className="eyebrow block">Details (optional)</label>
        <textarea
          id="annotation-description"
          name="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1.5 w-full resize-y border border-grid bg-surface px-3 py-2 text-sm text-ink"
        />
      </div>
      {state.status === "error" && <Banner tone="signal" title="Not added">{state.message}</Banner>}
      {state.status === "phi" && (
        <PhiNotice
          feedback={state}
          fields={[
            { path: "label", label: "What changed", text: submitted.label },
            { path: "description", label: "Details", text: submitted.description },
          ]}
        />
      )}
      <Button type="submit" disabled={pending || label.trim().length < 3} className="w-full sm:w-auto sm:self-start">
        {pending ? "Adding…" : "Mark the change"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- undo

export function RemoveLatestPoint({ measureId, label }: { measureId: string; label: string }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(removeLatestPointAction, { status: "idle" });
  const [armed, setArmed] = useState(false);
  if (state.status === "done") return <p className="text-sm text-muted">{state.message}</p>;
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="measureId" value={measureId} />
      {armed ? (
        <>
          <Button type="submit" variant="signal" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Removing…" : `Remove ${label}`}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setArmed(false)} className="w-full sm:w-auto">
            Keep it
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setArmed(true)} className="w-full sm:w-auto">
          Remove the latest point ({label})
        </Button>
      )}
      {state.status === "error" && <p className="text-sm text-signal">{state.message}</p>}
    </form>
  );
}
