"use client";

import { useActionState } from "react";
import { interpretAction, type InterpretState } from "@/app/charts/actions";
import { Banner, Button } from "@/components/ui/primitives";

/**
 * "Explain this chart". The explanation is written by a language model from
 * the findings the engine already computed; it cannot add a number, and says
 * so. Rendered with a `key` of the current view, so changing the chart clears
 * an explanation that described a different one.
 */
export function InterpretPanel({
  measureId,
  view,
  baseline,
  we,
}: {
  measureId: string;
  view: string;
  baseline: string;
  we: string;
}) {
  const [state, action, pending] = useActionState<InterpretState, FormData>(interpretAction, { status: "idle" });

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input type="hidden" name="measureId" value={measureId} />
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="baseline" value={baseline} />
        <input type="hidden" name="we" value={we} />
        <p className="text-sm text-muted">
          A plain-language reading of the findings. It is written from the rules the engine computed, and cannot
          add a number of its own.
        </p>
        <Button type="submit" variant="secondary" disabled={pending} className="w-full shrink-0 sm:w-auto">
          {pending ? "Reading the chart…" : "Explain this chart"}
        </Button>
      </form>

      <div aria-live="polite">
        {state.status === "done" && (
          <div className="border-l-4 border-primary bg-surface px-4 py-3" data-testid="interpretation">
            <p className="eyebrow mb-1">Interpretation · written by a language model</p>
            <p className="text-sm leading-relaxed text-ink">{state.text}</p>
          </div>
        )}
        {state.status === "unavailable" && (
          <Banner title="Interpretation unavailable">{state.message}</Banner>
        )}
        {state.status === "error" && (
          <Banner tone="signal" title="Could not explain this chart">
            {state.message}
          </Banner>
        )}
      </div>
    </div>
  );
}
