import type { ReactNode } from "react";

/* ---------------------------------------------------------------------------
   Design system primitives.

   No component library, by instruction: an imported visual identity would
   fight the one in the brief. These are small, unopinionated, and shaped by
   the SPC language — squared corners, hairline rules, mono labels.
--------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export { cx };

/** Mono, uppercase, letterspaced. Used for labels, data and section markers. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx("eyebrow", className)}>{children}</span>;
}

/**
 * A panel that reads as chart paper laid on the page. Optional eyebrow label
 * sits on the top rule, the way an annotation sits on a chart.
 */
export function PlotFrame({
  label,
  action,
  children,
  className,
}: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("plot-frame", className)}>
      {(label || action) && (
        <header className="flex items-baseline justify-between gap-3 border-b border-grid px-4 py-2">
          {label ? <Eyebrow>{label}</Eyebrow> : <span />}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  action,
}: {
  eyebrow?: ReactNode;
  title: string;
  lede?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{<Eyebrow>{eyebrow}</Eyebrow>}</div>}
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{lede}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "signal";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-ink",
  secondary: "bg-surface text-ink border border-grid hover:border-muted",
  ghost: "text-primary hover:bg-surface-sunken",
  // `signal` is reserved for destructive or special-cause actions.
  signal: "bg-signal text-white hover:bg-ink",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "signal" | "confirm" | "primary";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-grid bg-surface-sunken text-ink",
  signal: "border-signal/30 bg-signal/10 text-signal",
  confirm: "border-confirm/30 bg-confirm/10 text-confirm",
  primary: "border-primary/30 bg-primary/10 text-primary",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A full-width notice. Used for the LOCAL placeholder banner, the superseded
 * measure banner, and PHI feedback — cases where the user must not miss it.
 */
export function Banner({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const border =
    tone === "signal"
      ? "border-l-signal"
      : tone === "confirm"
        ? "border-l-confirm"
        : tone === "primary"
          ? "border-l-primary"
          : "border-l-muted";
  return (
    <div
      className={cx("border border-grid border-l-4 bg-surface px-4 py-3", border, className)}
      role="note"
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-grid bg-surface/60 px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{children}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * A labelled value. `data-numeric` gives tabular figures so a changing number
 * does not shift the layout.
 */
export function DataPair({
  label,
  value,
  mono = false,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <p
        className={cx("mt-1 text-sm text-ink", mono && "font-mono")}
        data-numeric={mono ? "" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/** A hairline rule that reads as a chart centre line rather than a divider. */
export function CentreRule({ label }: { label?: ReactNode }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="h-px flex-1 bg-grid" />
      {label && <Eyebrow>{label}</Eyebrow>}
      <span className="h-px flex-1 bg-grid" />
    </div>
  );
}
