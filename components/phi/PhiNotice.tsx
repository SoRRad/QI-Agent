"use client";

import { useState } from "react";
import type { PhiErrorBody } from "@/lib/phi";
import { Banner } from "@/components/ui/primitives";

/**
 * Shown when the PHI guard objects to text the user submitted.
 *
 * The flagged characters are highlighted in the user's OWN text, using the
 * offsets the server returned — the server never echoes the text back.
 *
 * Block tier: there is no button. The user edits the text; that is the only
 * way forward (Q5).
 * Warn tier: the user may confirm nothing identifying is present. Only once
 * they tick the box are the acknowledgement fingerprints added to the form, so
 * a plain resubmit without confirming is refused again.
 */
export function PhiNotice({
  feedback,
  text = "",
  path = "",
  fields,
}: {
  feedback: PhiErrorBody;
  /** The text as it was when submitted — the offsets refer to it. */
  text?: string;
  /** Which field's flags to highlight. */
  path?: string;
  /**
   * For multi-field forms: each field's submitted text, keyed by its path in
   * the write, with a label. Every flagged field is highlighted in turn.
   */
  fields?: Array<{ path: string; label: string; text: string }>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const blocked = feedback.error === "phi_blocked";
  const flags = feedback.flags.filter((f) => f.path === path);
  const messages = [...new Set(feedback.flags.map((f) => f.message))];
  const flaggedFields = (fields ?? [])
    .map((field) => ({ ...field, spans: feedback.flags.filter((f) => f.path === field.path) }))
    .filter((field) => field.spans.length > 0 && field.text);

  return (
    <div className="flex flex-col gap-3" role="alert" aria-live="assertive">
      <Banner
        tone="signal"
        title={blocked ? "This can't be sent: it looks like it contains a patient identifier" : "Please check before sending"}
      >
        <ul className="mt-1 list-disc pl-5">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        {blocked ? (
          <p className="mt-2">
            Edit the highlighted text to remove it. There is deliberately no override for this: identifiers
            never enter this system.
          </p>
        ) : (
          <p className="mt-2">
            If what is highlighted is not about a patient — a project date, a count — you can confirm and send.
            Your confirmation is recorded.
          </p>
        )}
      </Banner>

      {flags.length > 0 && text && <Highlighted text={text} spans={flags} />}
      {flaggedFields.map((field) => (
        <Highlighted key={field.path} text={field.text} spans={field.spans} label={field.label} />
      ))}

      {!blocked && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>I confirm nothing highlighted identifies a patient.</span>
        </label>
      )}
      {!blocked &&
        confirmed &&
        feedback.flags.map((f) =>
          f.fingerprint ? <input key={f.fingerprint} type="hidden" name="ack" value={f.fingerprint} /> : null,
        )}
    </div>
  );
}

function Highlighted({
  text,
  spans,
  label = "What you wrote",
}: {
  text: string;
  spans: Array<{ start: number; end: number }>;
  label?: string;
}) {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ordered.forEach((span, i) => {
    if (span.start < cursor) return;
    parts.push(text.slice(cursor, span.start));
    parts.push(
      <mark key={i} className="bg-signal/15 px-0.5 text-signal underline decoration-signal decoration-2 underline-offset-2">
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  parts.push(text.slice(cursor));

  return (
    <div className="border border-grid bg-surface px-3 py-2 text-sm whitespace-pre-wrap text-ink">
      <span className="eyebrow mb-1 block">{label}</span>
      {parts}
    </div>
  );
}
