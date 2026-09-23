"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/primitives";

const TABS = [
  { slug: "", label: "Aim" },
  { slug: "drivers", label: "Drivers" },
  { slug: "measures", label: "Measures" },
  { slug: "pdsa", label: "PDSA" },
  { slug: "handoff", label: "Handoff" },
  { slug: "scholarship", label: "Scholarship" },
] as const;

/** The workspace tabs (§6.2), a labelled navigation landmark inside the destination. */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav aria-label="Project workspace" className="mb-5">
      <ul className="grid grid-cols-3 border border-grid bg-surface sm:grid-cols-6">
        {TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = pathname === href;
          return (
            <li key={tab.slug} className="border-b border-r border-grid sm:border-b-0 [&:nth-child(3n)]:border-r-0 sm:[&:nth-child(3n)]:border-r sm:last:border-r-0">
              <Link
                href={href}
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
