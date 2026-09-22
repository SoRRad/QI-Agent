import Link from "next/link";
import { cx } from "./primitives";

/**
 * Sections within a destination, as their own labelled navigation landmark.
 * Depth goes here, never into the five-item main nav.
 */
export function SectionTabs({
  label,
  current,
  items,
}: {
  label: string;
  current: string;
  items: ReadonlyArray<{ id: string; label: string; href: string }>;
}) {
  return (
    <nav aria-label={label} className="mb-5">
      <ul className="grid auto-cols-fr grid-flow-col border border-grid bg-surface">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id} className="border-r border-grid last:border-r-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center justify-center px-2 py-2 text-center text-xs font-medium leading-tight sm:text-sm",
                  active ? "bg-primary text-white" : "text-primary hover:bg-surface-sunken",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export const COMMITTEE_SECTIONS = [
  { id: "dashboard", label: "Dashboard", href: "/committee" },
  { id: "library", label: "Library", href: "/committee/library" },
] as const;
