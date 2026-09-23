"use client";

import type { BarrierStatus, EscalationTarget } from "@/lib/generated/prisma/client";
import { transitionBarrierAction, updateBarrierAction } from "@/app/pulse/actions";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { allowedTransitions, STATUS_LABEL, TARGET_LABEL } from "@/lib/pulse/lifecycle";

const TARGETS: EscalationTarget[] = ["committee", "gmec", "program"];

export function TargetSelect({ id, defaultValue }: { id: string; defaultValue: EscalationTarget }) {
  return (
    <select id={id} name="escalationTarget" defaultValue={defaultValue} className={inputClass}>
      {TARGETS.map((t) => (
        <option key={t} value={t}>
          {TARGET_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

export function EditBarrierForm({
  barrier,
  owners,
}: {
  barrier: { id: string; themeLabel: string; summary: string; escalationTarget: EscalationTarget; ownerId: string | null };
  owners: Array<{ id: string; name: string }>;
}) {
  return (
    <ActionForm
      action={updateBarrierAction}
      hidden={{ barrierId: barrier.id }}
      submitLabel="Save"
      variant="secondary"
      phiFields={[
        ["themeLabel", "Theme"],
        ["summary", "Summary"],
      ]}
    >
      <Field id={`label-${barrier.id}`} label="Theme">
        <input id={`label-${barrier.id}`} name="label" defaultValue={barrier.themeLabel} maxLength={80} className={inputClass} />
      </Field>
      <Field id={`summary-${barrier.id}`} label="Summary" help="In the committee's words. It may not repeat six or more consecutive words from any response.">
        <textarea id={`summary-${barrier.id}`} name="summary" defaultValue={barrier.summary} rows={4} className={textareaClass} aria-describedby={`summary-${barrier.id}-help`} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`target-${barrier.id}`} label="Escalation target">
          <TargetSelect id={`target-${barrier.id}`} defaultValue={barrier.escalationTarget} />
        </Field>
        <Field id={`owner-${barrier.id}`} label="Owner">
          <select id={`owner-${barrier.id}`} name="ownerId" defaultValue={barrier.ownerId ?? ""} className={inputClass}>
            <option value="">No owner</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </ActionForm>
  );
}

export function TransitionForm({
  barrier,
}: {
  barrier: { id: string; status: BarrierStatus; escalationTarget: EscalationTarget; decision: string | null; whatChanged: string | null };
}) {
  const next = allowedTransitions(barrier.status, barrier.escalationTarget);
  if (next.length === 0) return null;
  const needsDecision = next.some((s) => s === "decided" || s === "closed");
  const closing = next.includes("closed");
  return (
    <ActionForm
      action={transitionBarrierAction}
      hidden={{ barrierId: barrier.id }}
      submitLabel={`Move to ${STATUS_LABEL[next[0]!].toLowerCase()}`}
      phiFields={[
        ["decision", "Decision"],
        ["whatChanged", "What changed"],
      ]}
      intent={undefined}
    >
      {next.length > 1 ? (
        <Field id={`to-${barrier.id}`} label="Next step">
          <select id={`to-${barrier.id}`} name="to" defaultValue={next[0]} className={inputClass}>
            {next.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <input type="hidden" name="to" value={next[0]} />
      )}
      {needsDecision && (
        <Field id={`decision-${barrier.id}`} label="Decision" help="What was decided, and by whom. Required to mark it decided.">
          <textarea id={`decision-${barrier.id}`} name="decision" defaultValue={barrier.decision ?? ""} rows={3} className={textareaClass} aria-describedby={`decision-${barrier.id}-help`} />
        </Field>
      )}
      {closing && (
        <Field
          id={`changed-${barrier.id}`}
          label="What changed, for trainees"
          help="Plain words a resident will read in the “You reported, we changed” digest. Required to close."
        >
          <textarea id={`changed-${barrier.id}`} name="whatChanged" defaultValue={barrier.whatChanged ?? ""} rows={3} className={textareaClass} aria-describedby={`changed-${barrier.id}-help`} />
        </Field>
      )}
    </ActionForm>
  );
}
