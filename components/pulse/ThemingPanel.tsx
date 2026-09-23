"use client";

import { useActionState } from "react";
import { addToBarrierAction, createBarrierAction, proposeThemesAction, type ThemingState } from "@/app/pulse/actions";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { Banner, Button } from "@/components/ui/primitives";
import { TargetSelect } from "./BarrierForms";
import type { EscalationTarget } from "@/lib/generated/prisma/client";

export interface UnthemedResponse {
  id: string;
  text: string;
  meta: string;
}

/**
 * The chair's theming desk. The model proposes; the chair edits each proposal
 * and saves it as a barrier, or adds it to one already open. Nothing the
 * model wrote is stored until the chair saves it, and the paraphrase check
 * runs again on what the chair saves.
 */
export function ThemingPanel({ quarter, responses }: { quarter: string; responses: UnthemedResponse[] }) {
  const [state, propose, pending] = useActionState<ThemingState, FormData>(proposeThemesAction, { status: "idle" });
  const available = new Map(responses.map((r) => [r.id, r]));

  return (
    <div className="flex flex-col gap-4">
      <form action={propose} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="hidden" name="quarter" value={quarter} />
        <Button type="submit" disabled={pending || responses.length === 0} className="w-full sm:w-auto">
          {pending ? "Reading the responses…" : "Propose themes"}
        </Button>
        <p className="text-xs text-muted">The model sees the response text only: no names, programs or dates.</p>
      </form>

      <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
        {state.status === "result" && !state.ok && <Banner tone="signal" title="No themes proposed">{state.reason}</Banner>}
        {state.status === "result" && state.ok && (
          <>
            <Banner tone="primary" title={`${state.proposals.length} themes proposed`}>
              Edit the wording before saving. Counts are the responses you keep ticked, counted by the system.
            </Banner>
            <ol className="flex flex-col gap-4" data-testid="theme-proposals">
              {state.proposals.map((p, i) => {
                const remaining = p.responseIds.filter((id) => available.has(id));
                return (
                  <li key={`${p.label}-${i}`} className="border border-grid bg-surface p-4">
                    {remaining.length === 0 ? (
                      <p className="text-sm text-confirm">Saved: “{p.label}”.</p>
                    ) : (
                      <ProposalForm index={i} proposal={p} responses={remaining.map((id) => available.get(id)!)} />
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function ResponseChecklist({ name, responses, checked }: { name: string; responses: UnthemedResponse[]; checked: boolean }) {
  return (
    <fieldset>
      <legend className="eyebrow">Responses in this theme</legend>
      <ul className="mt-2 flex flex-col gap-2">
        {responses.map((r) => (
          <li key={r.id}>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" name={name} value={r.id} defaultChecked={checked} className="mt-0.5 size-4 shrink-0 accent-primary" />
              <span>
                {r.text}
                <span className="mt-0.5 block font-mono text-xs text-muted">{r.meta}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function ProposalForm({
  index,
  proposal,
  responses,
}: {
  index: number;
  proposal: { label: string; summary: string; escalationTarget: EscalationTarget; barrier: { id: string; label: string } | null };
  responses: UnthemedResponse[];
}) {
  if (proposal.barrier) {
    return (
      <ActionForm action={addToBarrierAction} hidden={{ barrierId: proposal.barrier.id }} submitLabel={`Add to “${proposal.barrier.label}”`}>
        <p className="text-sm text-ink">
          These look like the open barrier <strong className="font-semibold">{proposal.barrier.label}</strong>.
        </p>
        <ResponseChecklist name="responseId" responses={responses} checked />
      </ActionForm>
    );
  }
  const id = `proposal-${index}`;
  return (
    <ActionForm
      action={createBarrierAction}
      hidden={{}}
      submitLabel="Raise as a barrier"
      phiFields={[
        ["themeLabel", "Theme"],
        ["summary", "Summary"],
      ]}
    >
      <Field id={`${id}-label`} label="Theme">
        <input id={`${id}-label`} name="label" defaultValue={proposal.label} maxLength={80} className={inputClass} />
      </Field>
      <Field id={`${id}-summary`} label="Summary">
        <textarea id={`${id}-summary`} name="summary" defaultValue={proposal.summary} rows={4} className={textareaClass} />
      </Field>
      <Field id={`${id}-target`} label="Escalation target">
        <TargetSelect id={`${id}-target`} defaultValue={proposal.escalationTarget} />
      </Field>
      <ResponseChecklist name="responseId" responses={responses} checked />
    </ActionForm>
  );
}

/** Raising a barrier by hand, for when the model is unavailable or the chair disagrees with it. */
export function ManualBarrierForm({ responses }: { responses: UnthemedResponse[] }) {
  return (
    <ActionForm
      action={createBarrierAction}
      hidden={{}}
      submitLabel="Raise as a barrier"
      variant="secondary"
      phiFields={[
        ["themeLabel", "Theme"],
        ["summary", "Summary"],
      ]}
    >
      <Field id="manual-label" label="Theme">
        <input id="manual-label" name="label" maxLength={80} className={inputClass} />
      </Field>
      <Field id="manual-summary" label="Summary" help="In your own words. It may not repeat six or more consecutive words from any response.">
        <textarea id="manual-summary" name="summary" rows={4} className={textareaClass} aria-describedby="manual-summary-help" />
      </Field>
      <Field id="manual-target" label="Escalation target">
        <TargetSelect id="manual-target" defaultValue="committee" />
      </Field>
      <ResponseChecklist name="responseId" responses={responses} checked={false} />
    </ActionForm>
  );
}
