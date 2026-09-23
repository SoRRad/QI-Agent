"use client";

import { acceptHandoffAction, createHandoffAction } from "@/app/projects/actions";
import { ActionForm, Field, inputClass, textareaClass } from "./ActionForm";

export function HandoffForm({ projectId, people }: { projectId: string; people: Array<{ id: string; name: string; role: string }> }) {
  return (
    <ActionForm
      action={createHandoffAction}
      hidden={{ projectId }}
      submitLabel="Send the handoff packet"
      pendingLabel="Sending…"
      phiFields={[
        ["openItems", "Open items"],
        ["dataAccessNotes", "Data access"],
        ["next1", "Next action 1"],
        ["next2", "Next action 2"],
        ["next3", "Next action 3"],
      ]}
    >
      <Field id="handoff-to" label="Handing over to">
        <select id="handoff-to" name="toUserId" defaultValue="" required className={inputClass}>
          <option value="" disabled>Choose…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role})
            </option>
          ))}
        </select>
      </Field>
      <Field id="handoff-open" label="Open items" help="What is unfinished, undecided or waiting on someone.">
        <textarea id="handoff-open" name="openItems" rows={3} required aria-describedby="handoff-open-help" className={textareaClass} />
      </Field>
      <Field id="handoff-data" label="Data access" help="Where the data comes from, who pulls it, how long access takes to set up. The part everyone forgets.">
        <textarea id="handoff-data" name="dataAccessNotes" rows={3} required aria-describedby="handoff-data-help" className={textareaClass} />
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="eyebrow">Next three actions</legend>
        {[1, 2, 3].map((n) => (
          <div key={n}>
            <label htmlFor={`handoff-next${n}`} className="sr-only">
              Next action {n}
            </label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted" aria-hidden="true">
                {n}.
              </span>
              <input id={`handoff-next${n}`} name={`next${n}`} required className={inputClass} />
            </div>
          </div>
        ))}
      </fieldset>
    </ActionForm>
  );
}

export function AcceptHandoff({ projectId, handoffId }: { projectId: string; handoffId: string }) {
  return <ActionForm action={acceptHandoffAction} hidden={{ projectId, handoffId }} submitLabel="Accept — take over this project" pendingLabel="Accepting…" />;
}
