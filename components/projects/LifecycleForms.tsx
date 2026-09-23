"use client";

import { approveProjectAction, archiveProjectAction, completeProjectAction } from "@/app/projects/actions";
import { ActionForm, Field, inputClass, textareaClass } from "./ActionForm";

export function ReviewDecision({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <ActionForm action={approveProjectAction} hidden={{ projectId, decision: "approve" }} submitLabel="Approve — make it active" />
      <ActionForm action={approveProjectAction} hidden={{ projectId, decision: "return" }} submitLabel="Return for changes" variant="secondary" />
    </div>
  );
}

export function CompletionForm({ projectId, measures }: { projectId: string; measures: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm
      action={completeProjectAction}
      hidden={{ projectId }}
      submitLabel="Complete the project"
      phiFields={[
        ["outcomeSummary", "What changed"],
        ["notes", "Notes"],
      ]}
    >
      <p className="text-sm leading-relaxed text-muted">
        A project that completes without someone owning the change has only stopped. The sustainability plan says who
        keeps it in place, what is still measured, how often, and who looks at it.
      </p>
      <Field id="complete-outcome" label="What changed" help="The result, with the numbers from your chart, in a sentence or two. The next cohort reads this in the registry.">
        <textarea id="complete-outcome" name="outcomeSummary" rows={3} required aria-describedby="complete-outcome-help" className={textareaClass} />
      </Field>
      <Field id="complete-owner" label="Who owns the change now" help="A named role — usually the clinical owner.">
        <input id="complete-owner" name="changeOwner" required aria-describedby="complete-owner-help" className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="complete-measure" label="Measure that continues">
          <select id="complete-measure" name="continuingMeasureId" defaultValue="" className={inputClass}>
            <option value="">None</option>
            {measures.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
        <Field id="complete-cadence" label="How often">
          <select id="complete-cadence" name="cadence" defaultValue="quarterly" className={inputClass}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
      </div>
      <Field id="complete-reviewer" label="Who reviews it" help="A person or a standing committee agenda item.">
        <input id="complete-reviewer" name="reviewer" required aria-describedby="complete-reviewer-help" className={inputClass} />
      </Field>
      <Field id="complete-notes" label="Notes (optional)">
        <textarea id="complete-notes" name="notes" rows={2} className={textareaClass} />
      </Field>
    </ActionForm>
  );
}

export function ArchiveForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm
      action={archiveProjectAction}
      hidden={{ projectId }}
      submitLabel="Archive"
      variant="signal"
      phiFields={[
        ["endReason", "Why it ended"],
        ["outcomeSummary", "What it achieved"],
      ]}
    >
      <Field id="archive-reason" label="Why it ended" help="Plainly: finished, owner graduated, data never arrived, change not feasible. Duplicate detection shows this to every future team on the same problem.">
        <textarea id="archive-reason" name="endReason" rows={3} required aria-describedby="archive-reason-help" className={textareaClass} />
      </Field>
      <Field id="archive-outcome" label="What it achieved (optional)">
        <textarea id="archive-outcome" name="outcomeSummary" rows={2} className={textareaClass} />
      </Field>
    </ActionForm>
  );
}
