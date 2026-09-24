"use client";

import { useState } from "react";
import { saveAbstractAction } from "@/app/projects/scholarship-actions";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { abstractText, countAbstract, countWords, type AbstractSection } from "@/lib/scholarship/abstract";
import { Button, cx } from "@/components/ui/primitives";

/**
 * The abstract formatter: the venue's headings, a live count per heading and
 * in total against its limit, and a copy button for the submission portal.
 */
export function AbstractEditor({
  projectId,
  venue,
  initial,
}: {
  projectId: string;
  venue: { id: string; name: string; limit: number };
  initial: { title: string; sections: AbstractSection[] };
}) {
  const [texts, setTexts] = useState(initial.sections.map((s) => s.text));
  const [title, setTitle] = useState(initial.title);
  const [copied, setCopied] = useState(false);
  const sections = initial.sections.map((s, i) => ({ heading: s.heading, text: texts[i] ?? "" }));
  const count = countAbstract(sections, venue.limit);
  const over = count.over > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(abstractText(title, sections));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <ActionForm
      action={saveAbstractAction}
      hidden={{ projectId, venueId: venue.id }}
      submitLabel="Save draft"
      resetOnSuccess={false}
      phiFields={initial.sections.map((s, i) => [`section_${i}`, s.heading])}
    >
      <div
        className={cx("sticky top-0 z-10 flex flex-wrap items-baseline justify-between gap-2 border bg-surface px-3 py-2", over ? "border-signal" : "border-grid")}
        data-testid="abstract-total"
      >
        <span className="font-mono text-sm tabular-nums text-ink" aria-live="polite">
          {count.total} / {venue.limit} words
        </span>
        <span className={cx("text-xs", over ? "font-semibold text-signal" : "text-muted")}>
          {over ? `${count.over} over the limit` : `${venue.limit - count.total} to spare`}
        </span>
      </div>

      <Field id="abstract-title" label="Title (not counted)">
        <input id="abstract-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </Field>

      {initial.sections.map((s, i) => {
        const id = `abstract-${i}`;
        const words = countWords(texts[i] ?? "");
        return (
          <div key={s.heading}>
            <input type="hidden" name="heading" value={s.heading} />
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={id} className="eyebrow">
                {s.heading}
              </label>
              <span className="font-mono text-xs tabular-nums text-muted">{words} words</span>
            </div>
            <textarea
              id={id}
              name={`section_${i}`}
              value={texts[i] ?? ""}
              onChange={(e) => setTexts((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
              rows={s.heading === "Abstract" ? 14 : 5}
              className={`mt-1.5 ${textareaClass}`}
            />
          </div>
        );
      })}

      <div>
        <Button type="button" variant="secondary" onClick={copy} className="w-full sm:w-auto">
          {copied ? "Copied" : "Copy the abstract"}
        </Button>
      </div>
    </ActionForm>
  );
}
