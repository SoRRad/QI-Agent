"use client";

import { useActionState, useEffect, useState } from "react";
import { tutorAction, type TutorState } from "@/app/ask/actions";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Banner, Button, Eyebrow, PlotFrame, cx } from "@/components/ui/primitives";

interface ProjectOption {
  id: string;
  title: string;
}

/**
 * Socratic coaching: one question at a time, working from the trainee's own
 * project, never writing the aim for them. The conversation lives in the
 * page, not the database.
 */
export function TutorPanel({ projects }: { projects: ProjectOption[] }) {
  const [state, action, pending] = useActionState<TutorState, FormData>(tutorAction, { status: "idle", history: [] });
  const [projectId, setProjectId] = useState("");
  const [reply, setReply] = useState("");
  const [submittedTurns, setSubmittedTurns] = useState("");

  // Clear the reply only once a turn has succeeded. If the PHI guard objects,
  // the trainee needs their text back to edit it.
  useEffect(() => {
    if (state.status === "done") setReply("");
  }, [state]);

  const started = state.history.length > 0;
  const projectTitle = projects.find((p) => p.id === projectId)?.title;

  function onSubmit() {
    const trainee = [...state.history.filter((t) => t.role === "trainee").map((t) => t.text), ...(reply.trim() ? [reply.trim()] : [])];
    setSubmittedTurns(trainee.join("\n"));
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="history" value={JSON.stringify(state.history)} />
        <input type="hidden" name="projectId" value={projectId} />

        {!started ? (
          <PlotFrame label="Start a coaching conversation">
            <p className="text-sm leading-relaxed text-muted">
              The tutor asks one question at a time. It will not write your aim statement for you — the point is
              that you can write the next one without help.
            </p>
            <label htmlFor="tutor-project" className="eyebrow mt-4 block">
              Work from a project (optional)
            </label>
            <select
              id="tutor-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1.5 min-h-11 w-full border border-grid bg-surface px-2 text-sm text-ink"
            >
              <option value="">No project — general coaching</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending} className="mt-4 w-full sm:w-auto">
              {pending ? "Thinking…" : "Start"}
            </Button>
          </PlotFrame>
        ) : (
          <>
            {projectTitle && <Eyebrow>Coaching on: {projectTitle}</Eyebrow>}
            <ol className="flex flex-col gap-3" aria-label="Conversation">
              {state.history.map((turn, i) => (
                <li
                  key={i}
                  className={cx(
                    "max-w-[90%] border px-3 py-2 text-sm leading-relaxed",
                    turn.role === "tutor"
                      ? "self-start border-grid bg-surface text-ink"
                      : "self-end border-primary/30 bg-primary/5 text-ink",
                  )}
                >
                  <span className="eyebrow mb-1 block">{turn.role === "tutor" ? "Coach" : "You"}</span>
                  {turn.text}
                </li>
              ))}
            </ol>

            {state.status === "phi" && <PhiNotice feedback={state} text={submittedTurns} path="turns" />}
            {state.status === "error" && <Banner tone="signal" title="The tutor couldn't continue">{state.message}</Banner>}

            <label htmlFor="tutor-reply" className="sr-only">
              Your reply
            </label>
            <textarea
              id="tutor-reply"
              name="reply"
              rows={3}
              maxLength={2000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Your answer…"
              className="w-full resize-y border border-grid bg-surface px-3 py-2 text-sm text-ink"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <a href="/ask?mode=tutor" className="min-h-11 content-center text-sm text-primary underline-offset-2 hover:underline">
                Start over
              </a>
              <Button type="submit" disabled={pending || (!reply.trim() && state.status !== "phi")} className="w-full sm:w-auto">
                {pending ? "Thinking…" : "Reply"}
              </Button>
            </div>
          </>
        )}
      </form>
      {!started && state.status === "error" && <Banner tone="signal" title="The tutor couldn't start">{state.message}</Banner>}
    </div>
  );
}
