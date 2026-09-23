"use client";

import { useMemo, useState } from "react";
import {
  addMeasureAction,
  createProjectAction,
  removeMeasureAction,
  saveAimAction,
  saveContextAction,
  savePeopleAction,
  saveProblemAction,
  submitProjectAction,
} from "@/app/projects/actions";
import { validateAim } from "@/lib/aim/validate";
import { ActionForm, Field, inputClass, textareaClass } from "./ActionForm";
import { AimRubric } from "./AimRubric";
import { CLER_OPTIONS } from "@/lib/cler";

// ---------------------------------------------------------------- problem

export function ProblemForm({ projectId, title = "", problemStatement = "" }: { projectId?: string; title?: string; problemStatement?: string }) {
  return (
    <ActionForm
      action={projectId ? saveProblemAction : createProjectAction}
      hidden={projectId ? { projectId } : {}}
      submitLabel={projectId ? "Save" : "Save and check the registry"}
      phiFields={[
        ["title", "Title"],
        ["problemStatement", "Problem"],
      ]}
    >
      <Field id="project-title" label="Title" help="Short and specific: what, where. “Discharge summary completion within 48 hours”, not “Improve discharge”.">
        <input id="project-title" name="title" defaultValue={title} required minLength={6} aria-describedby="project-title-help" className={inputClass} />
      </Field>
      <Field
        id="project-problem"
        label="The problem"
        help="What goes wrong, for whom, and how you know — what you have seen, counted or been told. No patient details: describe the pattern, not a case."
      >
        <textarea id="project-problem" name="problemStatement" defaultValue={problemStatement} rows={5} required minLength={40} aria-describedby="project-problem-help" className={textareaClass} />
      </Field>
    </ActionForm>
  );
}

// ---------------------------------------------------------------- aim

export interface AimDraft {
  text: string;
  baselineValue: string;
  baselineUnit: string;
  baselinePeriod: string;
  target: string;
  targetUnit: string;
  deadline: string;
  population: string;
}

export function AimForm({
  projectId,
  initial,
  outcomeDefinition,
  submitLabel = "Save aim",
}: {
  projectId: string;
  initial: AimDraft;
  outcomeDefinition: { numerator: string; denominator: string } | null;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (key: keyof AimDraft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
  const validation = useMemo(
    () =>
      validateAim({
        text: draft.text,
        baselineValue: num(draft.baselineValue),
        baselinePeriod: draft.baselinePeriod || null,
        target: num(draft.target),
        deadline: draft.deadline ? new Date(`${draft.deadline}T00:00:00Z`) : null,
        population: draft.population || null,
        measure: outcomeDefinition,
      }),
    [draft, outcomeDefinition],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <ActionForm
        action={saveAimAction}
        hidden={{ projectId }}
        submitLabel={submitLabel}
        phiFields={[
          ["text", "Aim"],
          ["population", "Population"],
          ["baselinePeriod", "Baseline period"],
        ]}
      >
        <Field
          id="aim-text"
          label="Aim statement"
          help="One sentence: reduce or increase what, for whom, from what baseline to what number, by when. The library's aim statement standard has an annotated example."
        >
          <textarea id="aim-text" name="text" rows={4} value={draft.text} onChange={set("text")} required aria-describedby="aim-text-help" className={textareaClass} />
        </Field>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">The numbers, as fields</legend>
          <Field id="aim-baseline" label="Baseline value">
            <input id="aim-baseline" name="baselineValue" inputMode="decimal" value={draft.baselineValue} onChange={set("baselineValue")} className={`${inputClass} font-mono`} />
          </Field>
          <Field id="aim-baseline-unit" label="Unit">
            <input id="aim-baseline-unit" name="baselineUnit" value={draft.baselineUnit} onChange={set("baselineUnit")} placeholder="% or minutes" className={inputClass} />
          </Field>
          <Field id="aim-baseline-period" label="Baseline period">
            <input id="aim-baseline-period" name="baselinePeriod" value={draft.baselinePeriod} onChange={set("baselinePeriod")} placeholder="1 Oct 2024 – 30 Sep 2025" className={inputClass} />
          </Field>
          <Field id="aim-target" label="Target value">
            <input id="aim-target" name="target" inputMode="decimal" value={draft.target} onChange={set("target")} className={`${inputClass} font-mono`} />
          </Field>
          <Field id="aim-target-unit" label="Target unit">
            <input id="aim-target-unit" name="targetUnit" value={draft.targetUnit} onChange={set("targetUnit")} className={inputClass} />
          </Field>
          <Field id="aim-deadline" label="Deadline">
            <input id="aim-deadline" name="deadline" type="date" value={draft.deadline} onChange={set("deadline")} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="aim-population" label="Population">
              <input id="aim-population" name="population" value={draft.population} onChange={set("population")} placeholder="Adult patients discharged from the Hospitalist service" className={inputClass} />
            </Field>
          </div>
        </fieldset>
      </ActionForm>
      <aside className="border border-grid bg-surface p-4 lg:self-start" aria-live="polite" aria-label="Aim statement check">
        <p className="eyebrow mb-2">Checked as you type</p>
        <AimRubric validation={validation} />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- measures

export function MeasureForm({
  projectId,
  library,
}: {
  projectId: string;
  library: Array<{ id: string; name: string; chartType: string }>;
}) {
  const [source, setSource] = useState<"local" | "library">("local");
  return (
    <ActionForm action={addMeasureAction} hidden={{ projectId }} submitLabel="Add measure" phiFields={[["name", "Measure name"]]}>
      <Field id="measure-type" label="Kind of measure" help="Outcome: the result you want. Process: whether the change is happening. Balancing: what might get worse.">
        <select id="measure-type" name="type" defaultValue="" required aria-describedby="measure-type-help" className={inputClass}>
          <option value="" disabled>Choose…</option>
          <option value="outcome">Outcome</option>
          <option value="process">Process</option>
          <option value="balancing">Balancing</option>
        </select>
      </Field>
      <fieldset>
        <legend className="eyebrow">Definition</legend>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:gap-4">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="radio" name="source" value="local" checked={source === "local"} onChange={() => setSource("local")} className="size-4 accent-primary" />
            Declare our own
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="radio" name="source" value="library" checked={source === "library"} onChange={() => setSource("library")} className="size-4 accent-primary" />
            Use a library definition
          </label>
        </div>
      </fieldset>
      {source === "library" ? (
        <Field id="measure-library" label="Library measure" help="The shared definition, so this program measures it the way others do.">
          <select id="measure-library" name="libraryMeasureId" defaultValue="" required className={inputClass}>
            <option value="" disabled>Choose…</option>
            {library.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.chartType} chart)
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field id="measure-name" label="Name">
            <input id="measure-name" name="name" placeholder="Discharge summaries signed >48h after discharge" className={inputClass} />
          </Field>
          <Field
            id="measure-chart"
            label="Chart type"
            help={
              <>
                Not sure? The <a href="/charts/advisor" className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">chart advisor</a> works it out from four questions.
              </>
            }
          >
            <select id="measure-chart" name="chartType" defaultValue="run" className={inputClass}>
              <option value="run">Run chart</option>
              <option value="p">p chart (proportion)</option>
              <option value="u">u chart (rate)</option>
              <option value="c">c chart (count)</option>
              <option value="xmr">XmR chart (measurement)</option>
            </select>
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveMeasureButton({ projectId, measureId, name }: { projectId: string; measureId: string; name: string }) {
  return (
    <ActionForm action={removeMeasureAction} hidden={{ projectId, measureId }} submitLabel={`Remove ${name}`} pendingLabel="Removing…" variant="secondary" className="gap-2" submitClassName="min-h-9 text-xs" />
  );
}

// ---------------------------------------------------------------- people and context

export function PeopleForm({
  projectId,
  initial,
  coaches,
}: {
  projectId: string;
  initial: { clinicalOwner: string; coachId: string; sponsor: string; analystContact: string };
  coaches: Array<{ id: string; name: string }>;
}) {
  return (
    <ActionForm action={savePeopleAction} hidden={{ projectId }} submitLabel="Save" phiFields={[]}>
      <Field
        id="people-owner"
        label="Clinical owner"
        help="The clinician who owns the process you are changing — usually the unit's medical or nursing director. They keep the change in place after you rotate off. Name and role."
      >
        <input id="people-owner" name="clinicalOwner" defaultValue={initial.clinicalOwner} aria-describedby="people-owner-help" className={inputClass} />
      </Field>
      <Field id="people-coach" label="Coach">
        <select id="people-coach" name="coachId" defaultValue={initial.coachId} className={inputClass}>
          <option value="">Not assigned yet</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field id="people-sponsor" label="Sponsor (optional)" help="A leader who can clear obstacles — often the program director.">
        <input id="people-sponsor" name="sponsor" defaultValue={initial.sponsor} aria-describedby="people-sponsor-help" className={inputClass} />
      </Field>
      <Field id="people-analyst" label="Data contact (optional)" help="Who pulls the data. If you do not know yet, the data request generator will help you ask.">
        <input id="people-analyst" name="analystContact" defaultValue={initial.analystContact} aria-describedby="people-analyst-help" className={inputClass} />
      </Field>
    </ActionForm>
  );
}


export function ContextForm({ projectId, initial }: { projectId: string; initial: { clerDomain: string; equityStratificationPlan: string } }) {
  return (
    <ActionForm action={saveContextAction} hidden={{ projectId }} submitLabel="Save" phiFields={[["equityStratificationPlan", "Equity stratification plan"]]}>
      <Field id="context-cler" label="CLER focus area">
        <select id="context-cler" name="clerDomain" defaultValue={initial.clerDomain} className={inputClass}>
          <option value="">Choose…</option>
          {CLER_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <Field
        id="context-equity"
        label="Equity stratification plan"
        help="Which groups you will stratify the outcome by, and why — so an average improvement cannot hide a widening gap."
      >
        <textarea id="context-equity" name="equityStratificationPlan" rows={3} defaultValue={initial.equityStratificationPlan} aria-describedby="context-equity-help" className={textareaClass} />
      </Field>
    </ActionForm>
  );
}

export function SubmitForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm
      action={submitProjectAction}
      hidden={{ projectId }}
      submitLabel="Submit for committee review"
      pendingLabel="Checking…"
      blockerHref={(step) => `/projects/${projectId}/intake?step=${step}`}
    />
  );
}
