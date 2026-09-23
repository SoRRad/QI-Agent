import type { AimValidation } from "@/lib/aim/validate";
import { cx } from "@/components/ui/primitives";

/**
 * The aim critique rubric: the five elements of the aim statement standard,
 * each met or not, with the validator's own reason. No hooks, so it renders on
 * the server and live in the intake form alike.
 */
export function AimRubric({ validation, compact = false }: { validation: AimValidation; compact?: boolean }) {
  const met = validation.elements.filter((e) => e.met).length;
  return (
    <div data-testid="aim-rubric">
      <p className={cx("text-sm font-semibold", validation.passed ? "text-confirm" : "text-ink")}>
        {validation.passed ? "All five elements present" : `${met} of 5 elements present`}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {validation.elements.map((e) => (
          <li key={e.element} className="flex gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cx("mt-0.5 flex size-4 shrink-0 items-center justify-center font-mono text-[0.625rem] font-bold", e.met ? "bg-confirm text-white" : "border border-signal text-signal")}
            >
              {e.met ? "✓" : "✗"}
            </span>
            <span className="min-w-0">
              <span className="sr-only">{e.met ? "Present: " : "Missing: "}</span>
              <span className="font-medium text-ink">{e.label}</span>
              {!compact && <span className="block text-xs leading-relaxed text-muted">{e.reason}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
