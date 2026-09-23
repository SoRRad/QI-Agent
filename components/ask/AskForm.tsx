"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { askAction, type AskState } from "@/app/ask/actions";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Markdown } from "@/components/ui/Markdown";
import { Badge, Banner, Button, Eyebrow, PlotFrame } from "@/components/ui/primitives";

const EXAMPLES = [
  "What are the five required elements of an aim statement?",
  "Why must I write a prediction before a PDSA cycle?",
  "Do I need an IRB determination before collecting data?",
];

export function AskForm() {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, { status: "idle" });
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <form action={action} onSubmit={() => setSubmitted(question)} className="flex flex-col gap-3">
        <label htmlFor="question" className="eyebrow">
          Your question
        </label>
        <textarea
          id="question"
          name="question"
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What makes a balancing measure?"
          className="w-full resize-y border border-grid bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-primary"
        />

        {state.status === "phi" && <PhiNotice feedback={state} text={submitted} path="question" />}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">Answers come only from the library below. Never include patient details.</p>
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Checking the library…" : state.status === "phi" && state.error === "phi_acknowledgement_required" ? "Confirm and ask" : "Ask"}
          </Button>
        </div>

        {state.status === "idle" && (
          <div className="flex flex-col gap-1.5">
            <Eyebrow>Try</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="border border-grid bg-surface px-2.5 py-1.5 text-left text-xs text-primary hover:border-muted"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>

      <div aria-live="polite">
        {state.status === "error" && <Banner tone="signal" title="Ask couldn't answer">{state.message}</Banner>}
        {state.status === "done" && <AskResultView result={state} />}
      </div>
    </div>
  );
}

function AskResultView({ result }: { result: Extract<AskState, { status: "done" }> }) {
  if (result.kind === "unavailable") {
    return <Banner tone="neutral" title="No grounded answer">{result.message}</Banner>;
  }

  if (result.kind === "not_covered") {
    return (
      <PlotFrame label="Not covered by the library">
        <p className="text-sm leading-relaxed text-ink">{result.gap}</p>
        <div className="mt-3 border-l-2 border-primary pl-3">
          <Eyebrow>The document that should exist</Eyebrow>
          <p className="mt-1 text-sm font-semibold text-ink">{result.suggestedDocument}</p>
        </div>
        <p className="mt-3 text-xs text-muted">
          {result.askedBefore
            ? "Others have asked this too. It has been added to the count in the committee's list of documents the institution still owes."
            : "Logged for the committee chair, in the list of documents the institution still owes."}{" "}
          Ask never answers policy questions from general knowledge.
        </p>
      </PlotFrame>
    );
  }

  return (
    <PlotFrame label="Answer from the library">
      {result.citesLocal && (
        <div className="mb-3">
          <Banner tone="signal" title="This relies on a document the institution has not yet written">
            A cited document is a LOCAL placeholder: it lists what the institution must supply but contains no
            policy yet. Confirm with the committee before acting on it. This has been logged for the chair.
          </Banner>
        </div>
      )}
      {/* Rendered through the safe renderer: a model's answer can contain a
          list, and must never be able to inject markup. */}
      <Markdown source={result.answer} />
      <div className="mt-4 flex flex-col gap-3">
        <Eyebrow>Sources</Eyebrow>
        {result.citations.map((c) => (
          <div key={c.documentId} className="border-t border-grid pt-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <Link href={`/ask/library/${c.slug}`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                {c.title}
              </Link>
              {c.isLocal && <Badge tone="signal">local</Badge>}
            </div>
            <blockquote className="mt-1.5 border-l-2 border-grid pl-3 text-sm text-muted italic">“{c.quote}”</blockquote>
          </div>
        ))}
      </div>
    </PlotFrame>
  );
}
