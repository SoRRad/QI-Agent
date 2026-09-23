"use client";

import type { PulseQuestion } from "@/lib/generated/prisma/client";
import { submitSurveyAction } from "@/app/pulse/actions";
import { ActionForm, textareaClass } from "@/components/projects/ActionForm";
import { CLER_OPTIONS } from "@/lib/cler";
import { SCALE_VALUES } from "@/lib/pulse/instrument";

type Question = Pick<PulseQuestion, "id" | "kind" | "core" | "prompt" | "help" | "required" | "options">;

/**
 * The quarterly survey. Name and program are opt-in, off by default, and say
 * exactly who sees them and why (§6.4: "genuinely optional and visibly
 * labeled, with a stated purpose: follow-up only").
 */
export function SurveyForm({ surveyId, questions, programName }: { surveyId: string; questions: Question[]; programName: string | null }) {
  const barrier = questions.find((q) => q.core === "barrier");
  return (
    <ActionForm
      action={submitSurveyAction}
      hidden={{ surveyId, ...(barrier ? { barrierQuestionId: barrier.id } : {}) }}
      submitLabel="Send my response"
      pendingLabel="Sending…"
      phiFields={barrier ? [["barrierText", barrier.prompt]] : []}
    >
      <ol className="flex flex-col gap-6">
        {questions.map((q, i) => (
          <li key={q.id}>
            <QuestionField question={q} number={i + 1} />
          </li>
        ))}
      </ol>

      <fieldset className="border border-grid bg-surface p-4">
        <legend className="eyebrow px-1">Who sees this response</legend>
        <p className="text-sm leading-relaxed text-ink">
          Your response is anonymous unless you choose otherwise below. The chair reads responses to group them into themes;
          everyone else sees only the themes, written in the committee&apos;s own words.
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="identify" className="mt-0.5 size-4 accent-primary" />
          <span>
            <strong className="font-semibold">Put my name on this response.</strong> Only so the chair can follow up with me about it. Nobody
            else sees my name.
          </span>
        </label>
        {programName && (
          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="shareProgram" className="mt-0.5 size-4 accent-primary" />
            <span>
              <strong className="font-semibold">Say I am in {programName}.</strong> Lets the committee send a program-level problem to
              the right program director. In a small program this may identify you.
            </span>
          </label>
        )}
      </fieldset>
    </ActionForm>
  );
}

function QuestionField({ question: q, number }: { question: Question; number: number }) {
  const id = `q-${q.id}`;
  const legend = (
    <>
      <span className="font-mono text-xs text-muted">{number}. </span>
      {q.prompt}
      {q.required ? <span className="text-muted"> (required)</span> : <span className="text-muted"> (optional)</span>}
    </>
  );
  const help = q.help ? <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-muted">{q.help}</p> : null;

  if (q.kind === "scale" || q.kind === "single_choice") {
    const values = q.kind === "scale" ? SCALE_VALUES.map(String) : q.options;
    return (
      <fieldset aria-describedby={q.help ? `${id}-help` : undefined}>
        <legend className="text-sm font-semibold text-ink">{legend}</legend>
        {help}
        <div className={q.kind === "scale" ? "mt-2 grid grid-cols-5 gap-2" : "mt-2 flex flex-col gap-2"}>
          {values.map((value) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center gap-2 border border-grid bg-surface px-3 text-sm text-ink has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input type="radio" name={`q_${q.id}`} value={value} required={q.required} className="size-4 accent-primary" />
              <span>{value}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (q.kind === "cler_domain") {
    return (
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {legend}
        </label>
        {help}
        <select id={id} name={`q_${q.id}`} required={q.required} defaultValue="" className="mt-2 min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink">
          <option value="">{q.required ? "Choose one" : "Not sure, or prefer not to say"}</option>
          {CLER_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {legend}
      </label>
      {help}
      <textarea
        id={id}
        name={q.core === "barrier" ? "barrierText" : `q_${q.id}`}
        rows={5}
        maxLength={2000}
        required={q.required}
        aria-describedby={q.help ? `${id}-help` : undefined}
        className={`mt-2 ${textareaClass}`}
      />
    </div>
  );
}
