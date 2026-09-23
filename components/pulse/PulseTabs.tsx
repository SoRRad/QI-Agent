"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/primitives";

const TABS = [
  { href: "/pulse", label: "What changed" },
  { href: "/pulse/survey", label: "Survey" },
  { href: "/pulse/mine", label: "My responses" },
  { href: "/pulse/barriers", label: "Barriers" },
] as const;

/** Sections of the Pulse destination (§5): survey, my responses, barriers log. Manage is the chair's. */
export function PulseTabs({ chair }: { chair: boolean }) {
  const pathname = usePathname();
  const tabs = chair ? [...TABS, { href: "/pulse/manage", label: "Manage" }] : TABS;
  return (
    <nav aria-label="Pulse" className="mb-5">
      <ul className={cx("grid border border-grid bg-surface", chair ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4")}>
        {tabs.map((tab) => {
          const active = tab.href === "/pulse" ? pathname === "/pulse" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className={cx("border-b border-r border-grid sm:border-b-0", chair && "last:col-span-2 sm:last:col-span-1")}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center justify-center px-2 text-center text-xs font-medium sm:text-sm",
                  active ? "bg-primary text-white" : "text-primary hover:bg-surface-sunken",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
