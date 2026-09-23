"use client";

import { createCycleAction, updateCycleAction } from "@/app/projects/actions";
import { ActionForm, Field, inputClass, textareaClass } from "./ActionForm";

export interface CycleView {
  id: string;
  number: number;
  plan: string;
  prediction: string | null;
  doAction: string | null;
  studyResult: string | null;
  actDecision: "adopt" | "adapt" | "abandon" | null;
}

export function NewCycleForm({ projectId, nextNumber }: { projectId: string; nextNumber: number }) {
  return (
    <ActionForm
      action={createCycleAction}
      hidden={{ projectId }}
      submitLabel={`Plan cycle ${nextNumber}`}
      phiFields={[
        ["plan", "Plan"],
        ["prediction", "Prediction"],
      ]}
    >
      <Field id="cycle-plan" label="Plan" help="The change idea you are testing, on whom, where, and for how long. Small and fast beats big and slow.">
        <textarea id="cycle-plan" name="plan" rows={3} required aria-describedby="cycle-plan-help" className={textareaClass} />
      </Field>
      <Field
        id="cycle-prediction"
        label="Prediction"
        help="What you expect to happen, with a number if you can. Required before the cycle can be marked done, and fixed once the Do step is recorded."
      >
        <textarea id="cycle-prediction" name="prediction" rows={3} aria-describedby="cycle-prediction-help" className={textareaClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cycle-start" label="Planned start">
          <input id="cycle-start" name="plannedStart" type="date" className={inputClass} />
        </Field>
        <Field id="cycle-end" label="Planned end">
          <input id="cycle-end" name="plannedEnd" type="date" className={inputClass} />
        </Field>
      </div>
    </ActionForm>
  );
}

export function CycleForm({ projectId, cycle }: { projectId: string; cycle: CycleView }) {
  const locked = !!cycle.doAction?.trim();
  const p = `cycle-${cycle.number}`;
  return (
    <ActionForm
      action={updateCycleAction}
      hidden={{ projectId, cycleId: cycle.id }}
      submitLabel="Save"
      variant="secondary"
      intent={[{ value: "complete", label: "Mark cycle done", variant: "primary" }]}
      phiFields={[
        ["plan", "Plan"],
        ["prediction", "Prediction"],
        ["doAction", "Do"],
        ["studyResult", "Study"],
      ]}
    >
      <Field id={`${p}-plan`} label="Plan">
        <textarea id={`${p}-plan`} name="plan" rows={2} defaultValue={cycle.plan} className={textareaClass} />
      </Field>
      {locked ? (
        <>
          <input type="hidden" name="prediction" value={cycle.prediction ?? ""} />
        </>
      ) : (
        <Field id={`${p}-prediction`} label="Prediction" help="Write it before you run the test. It is fixed once the Do step is recorded.">
          <textarea id={`${p}-prediction`} name="prediction" rows={2} defaultValue={cycle.prediction ?? ""} aria-describedby={`${p}-prediction-help`} className={textareaClass} />
        </Field>
      )}
      <Field id={`${p}-do`} label="Do" help="What actually happened when you ran it — including what did not go to plan.">
        <textarea id={`${p}-do`} name="doAction" rows={2} defaultValue={cycle.doAction ?? ""} aria-describedby={`${p}-do-help`} className={textareaClass} />
      </Field>
      <div>
        <p className="eyebrow">Study — prediction against result</p>
        <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
          <div className="border border-grid bg-surface-sunken/60 px-3 py-2">
            <p className="eyebrow">Predicted{locked ? " · fixed" : ""}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink" data-testid={`${p}-predicted`}>
              {cycle.prediction?.trim() ? cycle.prediction : <span className="text-signal">No prediction written.</span>}
            </p>
          </div>
          <div>
            <label htmlFor={`${p}-study`} className="sr-only">
              What happened, against the prediction
            </label>
            <textarea
              id={`${p}-study`}
              name="studyResult"
              rows={4}
              defaultValue={cycle.studyResult ?? ""}
              placeholder="What happened, against the prediction"
              className={textareaClass}
            />
          </div>
        </div>
      </div>
      <Field id={`${p}-act`} label="Act">
        <select id={`${p}-act`} name="actDecision" defaultValue={cycle.actDecision ?? ""} className={inputClass}>
          <option value="">Not decided</option>
          <option value="adopt">Adopt — keep the change</option>
          <option value="adapt">Adapt — change it and test again</option>
          <option value="abandon">Abandon — it did not work</option>
        </select>
      </Field>
    </ActionForm>
  );
}
