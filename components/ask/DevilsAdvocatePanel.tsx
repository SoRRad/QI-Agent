"use client";

import { useActionState, useState } from "react";
import { devilsAdvocateAction, type DevilState } from "@/app/ask/actions";
import { Badge, Banner, Button, Eyebrow, PlotFrame } from "@/components/ui/primitives";

const CATEGORY_LABEL: Record<string, string> = {
  no_clinical_owner: "clinical owner",
  data_unavailable: "data",
  effect_too_small: "detectability",
  no_balancing_measure: "balancing measure",
  aim_incomplete: "aim",
  untestable_at_trainee_scale: "test scale",
  no_prediction: "prediction",
  sustainability: "sustainability",
  other: "other",
};

export function DevilsAdvocatePanel({ projects }: { projects: Array<{ id: string; title: string }> }) {
  const [state, action, pending] = useActionState<DevilState, FormData>(devilsAdvocateAction, { status: "idle" });
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const title = projects.find((p) => p.id === projectId)?.title ?? "";

  if (projects.length === 0) {
    return (
      <Banner tone="neutral" title="No projects to argue against">
        Devil&apos;s advocate works from a project&apos;s working record, and you do not have access to any yet.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="projectTitle" value={title} />
        <div className="flex-1">
          <label htmlFor="devil-project" className="eyebrow block">
            Project
          </label>
          <select
            id="devil-project"
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-2 text-sm text-ink"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Arguing…" : "Argue against it"}
        </Button>
      </form>

      <div aria-live="polite">
        {state.status === "error" && <Banner tone="signal" title="Devil's advocate couldn't run">{state.message}</Banner>}
        {state.status === "done" && (
          <PlotFrame label={`Why "${state.projectTitle}" could fail · most serious first`}>
            <ol className="flex flex-col divide-y divide-grid">
              {state.risks.map((risk, i) => (
                <li key={i} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                  <span className="font-mono text-sm text-muted" data-numeric="" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="font-display text-base font-semibold text-ink">{risk.title}</h3>
                      <Badge tone="neutral">{CATEGORY_LABEL[risk.category] ?? risk.category}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{risk.argument}</p>
                    <div className="mt-2 border-l-2 border-primary pl-3">
                      <Eyebrow>What to do</Eyebrow>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{risk.mitigation}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </PlotFrame>
        )}
      </div>
    </div>
  );
}
