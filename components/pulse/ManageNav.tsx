import Link from "next/link";
import { cx } from "@/components/ui/primitives";

const LINKS = [
  { href: "/pulse/manage", label: "Survey and response rate" },
  { href: "/pulse/manage/themes", label: "Theme responses" },
  { href: "/pulse/manage/digest", label: "Digest" },
] as const;

export function ManageNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Manage pulse" className="mb-4 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.href === current ? "page" : undefined}
          className={cx(
            "flex min-h-11 items-center border px-3 text-sm",
            l.href === current ? "border-primary bg-primary text-white" : "border-grid bg-surface text-primary hover:border-muted",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function ChairOnly() {
  return (
    <div className="border border-grid border-l-4 border-l-muted bg-surface px-4 py-3" role="note">
      <p className="text-sm font-semibold text-ink">This part of Pulse is the chair&apos;s</p>
      <p className="mt-1 text-sm text-muted">Composing the survey, reading responses and publishing the digest are done by the committee chair.</p>
    </div>
  );
}
