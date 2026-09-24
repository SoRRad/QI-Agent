"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { FormState } from "@/app/projects/actions";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Banner, Button, cx } from "@/components/ui/primitives";

/**
 * A server-action form with the project area's standard outcomes: a
 * confirmation, a specific error, intake blockers with links to the step that
 * fixes each one, or the PHI notice with the flagged text highlighted in the
 * user's own words.
 *
 * Inputs are uncontrolled children, so a failed save keeps what was typed.
 * React resets a `<form action>` after every action, success or not; that
 * would wipe a half-completed survey because the PHI guard objected to one
 * sentence. So with JavaScript the submit is dispatched by hand and the form
 * is reset only after a success. Without JavaScript the native form post
 * still reaches the same server action.
 */
export function ActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "primary",
  phiFields = [],
  blockerHref,
  children,
  className,
  submitClassName,
  intent,
  resetOnSuccess = true,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "signal";
  /** Free-text fields to highlight if the PHI guard objects: [name, label]. */
  phiFields?: Array<[string, string]>;
  /** Builds the link to an intake step, for blockers. */
  blockerHref?: (step: string) => string;
  children?: ReactNode;
  className?: string;
  submitClassName?: string;
  /** Extra submit buttons that set `intent`. */
  intent?: Array<{ value: string; label: string; variant?: "primary" | "secondary" | "signal" }>;
  /** False for forms that keep editing in place after a save, like a draft with a live word count. */
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { status: "idle" });
  const [submitted, setSubmitted] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "done" && resetOnSuccess) form.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
        setSubmitted(Object.fromEntries(phiFields.map(([name]) => [name, String(data.get(name) ?? "")])));
        startTransition(() => formAction(data));
      }}
      className={cx("flex flex-col gap-4", className)}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}

      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {state.status === "done" && <Banner tone="confirm" title={state.message} />}
        {state.status === "error" && (
          <Banner tone="signal" title="Not saved">
            {state.message}
            {state.fieldErrors && Object.keys(state.fieldErrors).length > 1 && (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(state.fieldErrors).map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            )}
          </Banner>
        )}
        {state.status === "blocked" && (
          <Banner tone="signal" title="Not submitted — the committee needs these first">
            <ul className="mt-1 flex flex-col gap-2">
              {state.blockers.map((b) => (
                <li key={b.id}>
                  <strong className="font-semibold text-ink">{b.title}.</strong> {b.explanation}{" "}
                  {blockerHref && (
                    <Link href={blockerHref(b.step)} className="text-primary underline underline-offset-2">
                      Fix it
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Banner>
        )}
        {state.status === "phi" && (
          <PhiNotice feedback={state} fields={phiFields.map(([name, label]) => ({ path: name, label, text: submitted[name] ?? "" }))} />
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="submit" variant={variant} disabled={pending} className={cx("w-full sm:w-auto", submitClassName)}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {intent?.map((i) => (
          <Button key={i.value} type="submit" name="intent" value={i.value} variant={i.variant ?? "secondary"} disabled={pending} className="w-full sm:w-auto">
            {i.label}
          </Button>
        ))}
      </div>
    </form>
  );
}

/** A labelled field with help text, for use inside ActionForm. */
export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="eyebrow block">
        {label}
      </label>
      {help && (
        <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-muted">
          {help}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1 text-xs text-signal">{error}</p>}
    </div>
  );
}

export const inputClass = "min-h-11 w-full border border-grid bg-surface px-3 text-sm text-ink";
export const textareaClass = "w-full resize-y border border-grid bg-surface px-3 py-2 text-sm leading-relaxed text-ink";
