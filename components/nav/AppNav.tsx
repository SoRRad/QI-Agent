"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Destination } from "./destinations";
import { cx } from "@/components/ui/primitives";

/**
 * ONE navigation landmark, two presentations.
 *
 * Rendering separate mobile and desktop navs duplicates every link in the
 * accessibility tree and produces two identically-labelled landmarks, so the
 * markup is single and the presentation is responsive:
 *
 *   - below `md`: fixed bottom bar, icon over label. Trainees use this
 *     one-handed on a phone between cases, and the thumb reaches the bottom.
 *   - `md` and above: a static tab strip under the masthead, with the hint.
 *
 * Labels are always visible; five icon-only targets would be a guessing game.
 */
export function AppNav({ destinations }: { destinations: readonly Destination[] }) {
  const pathname = usePathname();

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Main"
      className={cx(
        "fixed inset-x-0 bottom-0 z-40 border-t border-grid bg-surface/95 backdrop-blur",
        "md:static md:border-t-0 md:border-b md:bg-surface/80 md:backdrop-blur-none",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5 md:mx-auto md:flex md:max-w-6xl md:gap-1 md:px-6">
        {destinations.map((d) => {
          const active = isActive(d.href);
          return (
            <li key={d.href}>
              <Link
                href={d.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 px-1 py-2 transition-colors",
                  "md:min-h-0 md:flex-row md:items-center md:gap-2 md:border-t-0 md:border-b-2 md:px-3 md:py-3",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink md:hover:border-grid",
                )}
              >
                {d.icon}
                <span className="flex flex-col leading-tight">
                  <span className="font-mono text-[0.625rem] uppercase tracking-wide md:font-sans md:text-sm md:font-medium md:normal-case md:tracking-normal">
                    {d.label}
                  </span>
                  <span className="hidden font-mono text-[0.625rem] font-normal uppercase tracking-wider text-muted md:block">
                    {d.hint}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
