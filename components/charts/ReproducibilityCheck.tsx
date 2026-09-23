"use client";

import { useActionState } from "react";
import { confirmRestatementAction, restateAction, type RestateState } from "@/app/charts/definition-actions";
import { Banner, Button } from "@/components/ui/primitives";

/**
 * The reproducibility check. A model restates the definition as the query an
 * analyst would run; the author confirms it matches their intent, or goes back
 * and writes a clearer version. The confirmation is stored as evidence and the
 * database will not let it change.
 */
export function ReproducibilityCheck({
  measureId,
  version,
  confirmed,
}: {
  measureId: string;
  version: number;
  confirmed: { query: string; at: string } | null;
}) {
  const [state, restate, restating] = useActionState<RestateState, FormData>(restateAction, { status: "idle" });
  const [final, confirm, confirming] = useActionState<RestateState, FormData>(confirmRestatementAction, { status: "idle" });
  const done = final.status === "confirmed" ? final : state.status === "confirmed" ? state : null;

  if (confirmed || done) {
    const query = confirmed?.query ?? done?.query ?? "";
    const at = confirmed?.at ?? done?.confirmedAt ?? "";
    return (
      <div className="flex flex-col gap-3" data-testid="reproducibility-confirmed">
        <Banner tone="confirm" title={`Version ${version} confirmed ${new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}>
          You confirmed that this restatement matches what the definition means. It is kept as evidence and cannot be
          changed; a definition that means something different is a new version.
        </Banner>
        {query && <blockquote className="border-l-4 border-grid pl-4 text-sm leading-relaxed text-ink">{query}</blockquote>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.status !== "ready" && (
        <form action={restate} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input type="hidden" name="measureId" value={measureId} />
          <p className="text-sm leading-relaxed text-muted">
            A language model reads version {version} and writes the data query it describes. If the query is not what
            you meant, the definition is ambiguous: another resident would pull different data.
          </p>
          <Button type="submit" variant="secondary" disabled={restating} className="w-full shrink-0 sm:w-auto">
            {restating ? "Reading the definition…" : "Restate it as a data query"}
          </Button>
        </form>
      )}

      {state.status === "unavailable" && (
        <Banner title="The check is unavailable right now">
          The restatement did not pass its own checks. Nothing was stored. Try again, or ask your coach to read the
          definition instead.
        </Banner>
      )}
      {state.status === "error" && <Banner tone="signal" title="Could not run the check">{state.message}</Banner>}

      {state.status === "ready" && (
        <div className="flex flex-col gap-3" data-testid="restatement">
          <p className="eyebrow">How an analyst would read version {state.version}</p>
          <blockquote className="border-l-4 border-primary bg-surface py-2 pl-4 pr-3 text-sm leading-relaxed text-ink">
            {state.query}
          </blockquote>
          {final.status === "error" && <Banner tone="signal" title="Not confirmed">{final.message}</Banner>}
          {state.ambiguities.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink">Questions the definition leaves open</p>
              <ul className="mt-1 list-disc pl-5 text-sm leading-relaxed text-muted">
                {state.ambiguities.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <form action={confirm} className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="measureId" value={measureId} />
            <input type="hidden" name="definitionId" value={state.definitionId} />
            <input type="hidden" name="digest" value={state.digest} />
            <Button type="submit" disabled={confirming} className="w-full sm:w-auto">
              {confirming ? "Recording…" : "Yes, this is what I mean"}
            </Button>
            <a
              href="#definition-numerator"
              className="inline-flex min-h-11 items-center justify-center border border-grid bg-surface px-4 text-sm font-medium text-ink hover:border-muted"
            >
              No — rewrite the definition
            </a>
          </form>
        </div>
      )}
    </div>
  );
}
