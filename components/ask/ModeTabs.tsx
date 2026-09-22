import Link from "next/link";
import { cx } from "@/components/ui/primitives";

/**
 * Depth INSIDE a destination, never in the main nav. A separately labelled
 * navigation landmark, so the five-destination rule stays structurally true.
 */
export function ModeTabs<T extends string>({
  label,
  base,
  current,
  modes,
}: {
  label: string;
  base: string;
  current: T;
  modes: ReadonlyArray<{ id: T; label: string }>;
}) {
  return (
    <nav aria-label={label} className="mb-5">
      <ul className="grid auto-cols-fr grid-flow-col border border-grid bg-surface">
        {modes.map((mode) => {
          const active = mode.id === current;
          return (
            <li key={mode.id} className="border-r border-grid last:border-r-0">
              <Link
                href={`${base}?mode=${mode.id}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center justify-center px-2 py-2 text-center text-xs font-medium leading-tight sm:text-sm",
                  active ? "bg-primary text-white" : "text-primary hover:bg-surface-sunken",
                )}
              >
                {mode.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
