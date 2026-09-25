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
  // Up to four sections sit in one row at any width. More wrap into a grid of
  // three at phone width, rather than scrolling sideways or shrinking the
  // targets below 44px; the 1px gap over a grid-coloured list draws the rules.
  const wraps = items.length > 4;
  return (
    <nav aria-label={label} className="mb-5">
      <ul className={cx("grid gap-px border border-grid bg-grid", wraps ? "grid-cols-3 sm:grid-cols-5 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none" : "auto-cols-fr grid-flow-col")}>
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id} className="bg-surface">
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
  { id: "dashboard", label: "Dashboard", href: "/committee", chairOnly: false },
  { id: "events", label: "Events", href: "/committee/events", chairOnly: false },
  { id: "judging", label: "Judging", href: "/committee/judging", chairOnly: false },
  { id: "cler", label: "CLER mock", href: "/committee/cler", chairOnly: false },
  { id: "milestones", label: "Milestones", href: "/committee/milestones", chairOnly: false },
  { id: "coaches", label: "Coaches", href: "/committee/coaches", chairOnly: false },
  { id: "curriculum", label: "Curriculum", href: "/committee/curriculum", chairOnly: true },
  { id: "report", label: "Annual report", href: "/committee/report", chairOnly: true },
  { id: "library", label: "Library", href: "/committee/library", chairOnly: false },
] as const;

export type CommitteeSection = (typeof COMMITTEE_SECTIONS)[number]["id"];

/** The sections a role can open. Curriculum and the annual report are the chair's (Q4). */
export function committeeSections(role: string) {
  return COMMITTEE_SECTIONS.filter((s) => role === "chair" || !s.chairOnly);
}

export const CHART_SECTIONS = [
  { id: "measures", label: "Measures", href: "/charts" },
  { id: "advisor", label: "Which chart?", href: "/charts/advisor" },
] as const;
