"use client";

import { useState } from "react";
import { runPrecheckAction } from "@/app/projects/scholarship-actions";
import { ActionForm } from "@/components/projects/ActionForm";
import { QUESTIONS, type Answers } from "@/lib/scholarship/irb";

/**
 * The screening questionnaire. The follow-up question appears only when its
 * condition is met; the server applies the same rule, so a form submitted
 * without JavaScript is judged on the questions that apply.
 */
export function IrbForm({ projectId }: { projectId: string }) {
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const questions = QUESTIONS.filter((q) => !q.showIf || q.showIf(answers));

  return (
    <ActionForm action={runPrecheckAction} hidden={{ projectId }} submitLabel="Screen and draft the memo" pendingLabel="Screening…">
      <ol className="flex flex-col gap-5">
        {questions.map((q, n) => (
          <li key={q.id}>
            <fieldset>
              <legend className="text-sm font-semibold text-ink">
                <span className="font-mono text-xs text-muted">{n + 1}. </span>
                {q.prompt}
              </legend>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {q.options.map(([value, label]) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-2 border border-grid bg-surface px-3 text-sm text-ink has-[:checked]:border-primary"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={value}
                      required
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: value }))}
                      className="size-4 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
    </ActionForm>
  );
}
