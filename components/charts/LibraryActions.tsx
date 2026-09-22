"use client";

import { useActionState, useState } from "react";
import { deprecateMeasureAction, promoteMeasureAction, type LibraryState } from "@/app/charts/actions";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Banner, Button } from "@/components/ui/primitives";

/** Chair: copy a project's local measure into the shared library. */
export function PromoteForm({ measureId, measureName }: { measureId: string; measureName: string }) {
  const [state, action, pending] = useActionState<LibraryState, FormData>(promoteMeasureAction, { status: "idle" });
  if (state.status === "done") return <Banner tone="confirm" title="Promoted">{state.message}</Banner>;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="measureId" value={measureId} />
      <p className="text-sm leading-relaxed text-muted">
        Promoting copies the current definition of &ldquo;{measureName}&rdquo; into the institution-wide library,
        so other programs measure the same thing the same way. This project&rsquo;s chart then links to the library
        definition and will be told if it is ever superseded.
      </p>
      {state.status === "error" && <Banner tone="signal" title="Not promoted">{state.message}</Banner>}
      {state.status === "phi" && <PhiNotice feedback={state} text="" path="" />}
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto sm:self-start">
        {pending ? "Promoting…" : "Promote to the library"}
      </Button>
    </form>
  );
}

/** Chair: supersede a library measure with a stated reason and an optional replacement. */
export function DeprecateForm({
  measureId,
  replacements,
}: {
  measureId: string;
  replacements: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<LibraryState, FormData>(deprecateMeasureAction, { status: "idle" });
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState("");
  if (state.status === "done") return <Banner tone="confirm" title="Superseded">{state.message}</Banner>;

  return (
    <form action={action} onSubmit={() => setSubmitted(note)} className="flex flex-col gap-3">
      <input type="hidden" name="measureId" value={measureId} />
      <div>
        <label htmlFor="deprecation-note" className="eyebrow block">
          What changed, and why
        </label>
        <textarea
          id="deprecation-note"
          name="note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          minLength={20}
          className="mt-1.5 w-full resize-y border border-grid bg-surface px-3 py-2 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor="deprecation-replacement" className="eyebrow block">
          Replaced by
        </label>
        <select
          id="deprecation-replacement"
          name="supersededById"
          className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink"
          defaultValue=""
        >
          <option value="">No replacement</option>
          {replacements.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {state.status === "error" && <Banner tone="signal" title="Not superseded">{state.message}</Banner>}
      {state.status === "phi" && <PhiNotice feedback={state} text={submitted} path="deprecationNote" />}
      <Button type="submit" variant="signal" disabled={pending} className="w-full sm:w-auto sm:self-start">
        {pending ? "Saving…" : "Supersede this definition"}
      </Button>
    </form>
  );
}
