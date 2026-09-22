"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveDefinitionAction, type DefinitionState } from "@/app/charts/definition-actions";
import { CADENCE_LABELS, CADENCES, DEFINITION_FIELDS, missingFields, type DefinitionField } from "@/lib/charts/definitionFields";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Banner, Button, cx } from "@/components/ui/primitives";

type Draft = Record<DefinitionField, string>;

/**
 * The operational definition builder. Seven parts, all required. The save
 * button stays disabled with a checklist of what is missing, and the server
 * refuses an incomplete definition regardless — the button is a courtesy, the
 * schema is the rule.
 */
export function DefinitionForm({
  measureId,
  measureHref,
  initial,
  nextVersion,
}: {
  measureId: string;
  measureHref: string;
  initial: Draft;
  nextVersion: number;
}) {
  const [state, action, pending] = useActionState<DefinitionState, FormData>(saveDefinitionAction, { status: "idle" });
  const [draft, setDraft] = useState<Draft>(initial);
  const [submitted, setSubmitted] = useState<Draft>(initial);
  const missing = missingFields(draft);
  const done = DEFINITION_FIELDS.length - missing.length;
  const errors = state.status === "invalid" ? state.fieldErrors : {};

  if (state.status === "saved") {
    return (
      <Banner tone="confirm" title={`Saved as version ${state.version}`}>
        <p>
          The earlier version stays on record: charts plotted under it still say what they meant then. Now check that
          the definition reads the way you intend, below.
        </p>
        <p className="mt-2">
          <Link href={measureHref} className="text-primary underline underline-offset-2">
            Back to the chart
          </Link>
        </p>
      </Banner>
    );
  }

  return (
    <form action={action} onSubmit={() => setSubmitted(draft)} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="measureId" value={measureId} />

      <div className="border border-grid bg-surface px-4 py-3" aria-live="polite">
        <p className="text-sm font-semibold text-ink">
          <span data-numeric="" className="font-mono">
            {done} of {DEFINITION_FIELDS.length}
          </span>{" "}
          parts complete
        </p>
        {missing.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            Still needed: {missing.map((id) => DEFINITION_FIELDS.find((f) => f.id === id)?.label).join(", ")}.
          </p>
        )}
      </div>

      {DEFINITION_FIELDS.map((field) => {
        const id = `definition-${field.id}`;
        const complete = !missing.includes(field.id);
        const error = errors[field.id];
        return (
          <div key={field.id}>
            <label htmlFor={id} className="flex items-center gap-2">
              <span className="eyebrow">{field.label}</span>
              <span className={cx("font-mono text-[0.625rem] uppercase tracking-wider", complete ? "text-confirm" : "text-muted")}>
                {complete ? "✓ done" : "required"}
              </span>
            </label>
            <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-muted">
              {field.help}
            </p>
            {field.id === "cadence" ? (
              <select
                id={id}
                name="cadence"
                value={draft.cadence}
                onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}
                aria-describedby={`${id}-help`}
                aria-invalid={!!error}
                className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink sm:w-64"
              >
                <option value="">Choose…</option>
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {CADENCE_LABELS[c]}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                id={id}
                name={field.id}
                rows={field.id === "dataSource" || field.id === "puller" ? 1 : 3}
                value={draft[field.id]}
                onChange={(e) => setDraft({ ...draft, [field.id]: e.target.value })}
                placeholder={field.placeholder}
                aria-describedby={`${id}-help`}
                aria-invalid={!!error}
                className="mt-1.5 w-full resize-y border border-grid bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70"
              />
            )}
            {error && <p className="mt-1 text-xs text-signal">{error}</p>}
          </div>
        );
      })}

      {state.status === "phi" && (
        <PhiNotice
          feedback={state}
          fields={DEFINITION_FIELDS.filter((f) => f.id !== "cadence").map((f) => ({ path: f.id, label: f.label, text: submitted[f.id] }))}
        />
      )}
      {state.status === "error" && <Banner tone="signal" title="Not saved">{state.message}</Banner>}
      {state.status === "invalid" && (
        <Banner tone="signal" title="Not saved: the definition is incomplete">
          Every part is required. An operational definition with a gap is one the next resident cannot reproduce.
        </Banner>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-xs text-muted sm:mr-auto">Saving writes version {nextVersion}. Earlier versions are never changed.</p>
        <Button type="submit" disabled={pending || missing.length > 0} className="w-full sm:w-auto">
          {pending ? "Saving…" : `Save version ${nextVersion}`}
        </Button>
      </div>
    </form>
  );
}
