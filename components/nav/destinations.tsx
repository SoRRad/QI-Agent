import type { ReactNode } from "react";
import type { Role } from "@/lib/generated/prisma/client";

/**
 * EXACTLY FIVE top-level destinations. This is a hard constraint from the
 * brief, restated here because this file is where the temptation lands: depth
 * goes inside a destination as a tab or an action, never into the nav bar.
 *
 * Role changes VISIBILITY of a destination, never the number of them.
 */

export interface Destination {
  href: string;
  label: string;
  /** Mono sub-label shown on wide viewports only. */
  hint: string;
  roles?: readonly Role[];
  icon: ReactNode;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const DESTINATIONS: readonly Destination[] = [
  {
    href: "/ask",
    label: "Ask",
    hint: "Library-grounded answers",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        {/* A query mark plotted as a point with a stem. */}
        <path {...stroke} d="M9 8.5a3 3 0 1 1 4.2 2.75c-.75.35-1.2 1.05-1.2 1.85v.4" />
        <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
        <rect {...stroke} x="3" y="3" width="18" height="18" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "Projects",
    hint: "Intake, registry, workspace",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        {/* A register: rules with a plotted marker in the margin. */}
        <path {...stroke} d="M8 7h12M8 12h12M8 17h8" />
        <circle cx="4.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="17" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/charts",
    label: "Charts",
    hint: "SPC studio and measures",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        {/* A run chart with a centre line: the system's signature mark. */}
        <path {...stroke} d="M3 20V4" />
        <path {...stroke} d="M3 20h18" />
        <path {...stroke} strokeDasharray="3 2" d="M4 13h16" />
        <path {...stroke} d="m5 16 4-6 4 4 5-8" />
        <circle cx="9" cy="10" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="13" cy="14" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="18" cy="6" r="1.3" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/pulse",
    label: "Pulse",
    hint: "Survey and barriers log",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        {/* A tick series: many small readings rather than one number. */}
        <path {...stroke} d="M3 12h3l2-6 3 12 3-9 2 3h5" />
      </svg>
    ),
  },
  {
    href: "/committee",
    label: "Committee",
    hint: "Events, reports, dashboard",
    // Chair and coach only. Trainees never see this destination.
    roles: ["chair", "coach"],
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        {/* An institutional portico: a baseline with standing members. */}
        <path {...stroke} d="M3 20h18" />
        <path {...stroke} d="M6 20V9m4 11V9m4 11V9m4 11V9" />
        <path {...stroke} d="M4 9h16L12 4 4 9Z" />
      </svg>
    ),
  },
] as const;

export function destinationsFor(role: Role): readonly Destination[] {
  return DESTINATIONS.filter((d) => !d.roles || d.roles.includes(role));
}
