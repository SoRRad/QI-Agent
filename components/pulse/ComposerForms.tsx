"use client";

import type { PulseQuestion } from "@/lib/generated/prisma/client";
import {
  addQuestionAction,
  createSurveyAction,
  questionOrderAction,
  surveyIntroAction,
  surveyStatusAction,
  updateQuestionAction,
} from "@/app/pulse/actions";
import { ActionForm, Field, inputClass, textareaClass } from "@/components/projects/ActionForm";
import { KIND_LABEL } from "@/lib/pulse/instrument";

type Question = Pick<PulseQuestion, "id" | "kind" | "core" | "prompt" | "help" | "required" | "options">;

export function CreateSurveyForm({ quarter }: { quarter: string }) {
  return (
    <ActionForm action={createSurveyAction} hidden={{}} submitLabel="Prepare the draft" variant="secondary">
      <Field id="new-quarter" label="Quarter" help="The draft starts from the most recent survey's questions.">
        <input id="new-quarter" name="quarter" defaultValue={quarter} pattern="\d{4}-Q[1-4]" className={inputClass} aria-describedby="new-quarter-help" />
      </Field>
    </ActionForm>
  );
}

export function IntroForm({ surveyId, intro }: { surveyId: string; intro: string | null }) {
  return (
    <ActionForm action={surveyIntroAction} hidden={{ surveyId }} submitLabel="Save introduction" variant="secondary" phiFields={[["intro", "Introduction"]]}>
      <Field id={`intro-${surveyId}`} label="Introduction" help="Shown above the questions. Say how long it takes and what happens to the answers.">
        <textarea id={`intro-${surveyId}`} name="intro" defaultValue={intro ?? ""} rows={3} className={textareaClass} aria-describedby={`intro-${surveyId}-help`} />
      </Field>
    </ActionForm>
  );
}

export function QuestionEditor({ question: q, index, count }: { question: Question; index: number; count: number }) {
  const id = `question-${q.id}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">
        {index + 1}. {KIND_LABEL[q.kind]}
        {q.core ? " · core question" : ""}
      </p>
      <ActionForm action={updateQuestionAction} hidden={{ questionId: q.id }} submitLabel="Save" variant="secondary" phiFields={[["prompt", "Question"]]}>
        <Field id={`${id}-prompt`} label="Question">
          <textarea id={`${id}-prompt`} name="prompt" defaultValue={q.prompt} rows={2} className={textareaClass} />
        </Field>
        <Field id={`${id}-help`} label="Help text (optional)">
          <input id={`${id}-help`} name="help" defaultValue={q.help ?? ""} className={inputClass} />
        </Field>
        {q.kind === "single_choice" && (
          <Field id={`${id}-options`} label="Choices, one per line">
            <textarea id={`${id}-options`} name="options" defaultValue={q.options.join("\n")} rows={4} className={textareaClass} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="required" defaultChecked={q.required} disabled={q.core === "confidence"} className="size-4 accent-primary" />
          Required{q.core === "confidence" ? " (every response carries a confidence rating)" : ""}
        </label>
      </ActionForm>
      <div className="flex flex-wrap gap-2">
        {index > 0 && <OrderButton questionId={q.id} op="up" label={`Move question ${index + 1} up`} text="Move up" />}
        {index < count - 1 && <OrderButton questionId={q.id} op="down" label={`Move question ${index + 1} down`} text="Move down" />}
        {!q.core && <OrderButton questionId={q.id} op="remove" label={`Remove question ${index + 1}`} text="Remove" />}
      </div>
    </div>
  );
}

function OrderButton({ questionId, op, label, text }: { questionId: string; op: "up" | "down" | "remove"; label: string; text: string }) {
  return (
    <ActionForm
      action={questionOrderAction}
      hidden={{ questionId, op }}
      submitLabel={text}
      pendingLabel="…"
      variant={op === "remove" ? "signal" : "secondary"}
      className="gap-1"
      submitClassName="min-h-11"
    >
      <span className="sr-only">{label}</span>
    </ActionForm>
  );
}

export function AddQuestionForm({ surveyId }: { surveyId: string }) {
  return (
    <ActionForm action={addQuestionAction} hidden={{ surveyId }} submitLabel="Add question" variant="secondary" phiFields={[["prompt", "Question"]]}>
      <Field id="add-kind" label="Kind">
        <select id="add-kind" name="kind" defaultValue="single_choice" className={inputClass}>
          <option value="single_choice">{KIND_LABEL.single_choice}</option>
          <option value="scale">{KIND_LABEL.scale}</option>
          <option value="free_text">{KIND_LABEL.free_text}</option>
        </select>
      </Field>
      <Field id="add-prompt" label="Question">
        <textarea id="add-prompt" name="prompt" rows={2} className={textareaClass} />
      </Field>
      <Field id="add-help" label="Help text (optional)">
        <input id="add-help" name="help" className={inputClass} />
      </Field>
      <Field id="add-options" label="Choices, one per line (choice questions only)">
        <textarea id="add-options" name="options" rows={4} className={textareaClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="required" className="size-4 accent-primary" />
        Required
      </label>
    </ActionForm>
  );
}

export function SurveyStatusForm({ surveyId, to, label }: { surveyId: string; to: "open" | "closed"; label: string }) {
  return <ActionForm action={surveyStatusAction} hidden={{ surveyId, to }} submitLabel={label} variant={to === "open" ? "primary" : "secondary"} />;
}
