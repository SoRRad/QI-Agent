"use client";

import { useActionState } from "react";
import { draftDigestAction, publishDigestAction, type DigestState } from "@/app/pulse/actions";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { Banner, Button } from "@/components/ui/primitives";

/**
 * Generate a draft from closed barriers, edit it, publish it. The draft is
 * never stored: what is published is what the chair saw and sent.
 */
export function DigestComposer({ available }: { available: number }) {
  const [state, generate, pending] = useActionState<DigestState, FormData>(draftDigestAction, { status: "idle" });
  return (
    <div className="flex flex-col gap-4">
      <form action={generate}>
        <Button type="submit" disabled={pending || available === 0} className="w-full sm:w-auto">
          {pending ? "Drafting…" : state.status === "draft" ? "Draft again" : "Draft the digest"}
        </Button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
        {state.status === "error" && <Banner tone="signal" title="No draft">{state.message}</Banner>}
        {state.status === "draft" && (
          <>
            <Banner tone="primary" title="Draft — edit before publishing">
              {state.draft.source === "records"
                ? "The model was unavailable, so this draft is assembled from each barrier's own “what changed” text."
                : "Written from the closed barriers' decisions and what changed. Check every sentence against the barrier before publishing."}
            </Banner>
            <ActionForm
              action={publishDigestAction}
              hidden={{}}
              submitLabel="Publish to trainees"
              pendingLabel="Publishing…"
              phiFields={[
                ["headline", "Headline"],
                ["intro", "Introduction"],
              ]}
            >
              <Field id="digest-headline" label="Headline">
                <input id="digest-headline" name="headline" defaultValue={state.draft.headline} className={inputClass} />
              </Field>
              <Field id="digest-intro" label="Introduction">
                <textarea id="digest-intro" name="intro" defaultValue={state.draft.intro} rows={3} className={textareaClass} />
              </Field>
              {state.draft.items.map((item) => (
                <Field key={item.barrierId} id={`digest-item-${item.barrierId}`} label={item.label}>
                  <input type="hidden" name="barrierId" value={item.barrierId} />
                  <textarea id={`digest-item-${item.barrierId}`} name={`item_${item.barrierId}`} defaultValue={item.text} rows={4} className={textareaClass} />
                </Field>
              ))}
            </ActionForm>
          </>
        )}
      </div>
    </div>
  );
}
