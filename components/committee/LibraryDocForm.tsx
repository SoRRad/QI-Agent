"use client";

import { useActionState, useState } from "react";
import { saveLibraryDoc, type SaveState } from "@/app/committee/library/actions";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Banner, Button } from "@/components/ui/primitives";

export interface LibraryDocDraft {
  slug: string | null;
  title: string;
  body: string;
  isLocal: boolean;
  localFieldsRequired: string[];
}

export function LibraryDocForm({ doc }: { doc: LibraryDocDraft }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveLibraryDoc, { status: "idle" });
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [isLocal, setIsLocal] = useState(doc.isLocal);
  const [fields, setFields] = useState(doc.localFieldsRequired.join("\n"));
  const [submitted, setSubmitted] = useState({ title: "", body: "" });
  const errors = state.status === "error" ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} onSubmit={() => setSubmitted({ title, body })} className="flex flex-col gap-4">
      {doc.slug && <input type="hidden" name="slug" value={doc.slug} />}

      <div>
        <label htmlFor="doc-title" className="eyebrow block">Title</label>
        <input
          id="doc-title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          aria-invalid={!!errors["title"]}
          className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink"
        />
        {errors["title"] && <p className="mt-1 text-xs text-signal">{errors["title"]}</p>}
      </div>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="isLocal"
          checked={isLocal}
          onChange={(e) => setIsLocal(e.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          <strong className="font-semibold">LOCAL placeholder.</strong> The document does not yet contain
          institutional policy. Ask treats it as unwritten policy and flags any answer that cites it.
        </span>
      </label>

      {isLocal && (
        <div>
          <label htmlFor="doc-fields" className="eyebrow block">Required from the institution — one per line</label>
          <textarea
            id="doc-fields"
            name="localFieldsRequired"
            rows={5}
            value={fields}
            onChange={(e) => setFields(e.target.value)}
            className="mt-1.5 w-full resize-y border border-grid bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>
      )}

      <div>
        <label htmlFor="doc-body" className="eyebrow block">Body (Markdown)</label>
        <textarea
          id="doc-body"
          name="body"
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          aria-invalid={!!errors["body"]}
          className="mt-1.5 w-full resize-y border border-grid bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink"
        />
        {errors["body"] && <p className="mt-1 text-xs text-signal">{errors["body"]}</p>}
      </div>

      {state.status === "phi" && (
        <>
          <PhiNotice feedback={state} text={submitted.body} path="body" />
          {state.flags.some((f) => f.path === "title") && (
            <p className="text-xs text-signal">The title is flagged too.</p>
          )}
        </>
      )}
      {state.status === "error" && !Object.keys(errors).length && <Banner tone="signal" title="Not saved">{state.message}</Banner>}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : doc.slug ? "Save new version" : "Create document"}
        </Button>
      </div>
    </form>
  );
}
