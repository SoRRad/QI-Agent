import Link from "next/link";
import { cx } from "@/components/ui/primitives";

const LINKS = [
  { slug: "", label: "Venues" },
  { slug: "squire", label: "SQUIRE draft" },
  { slug: "abstract", label: "Abstract" },
  { slug: "irb", label: "IRB pre-check" },
] as const;

export type ScholarshipSection = (typeof LINKS)[number]["slug"];

/** The four scholarship tools (§6.5), as a sub-navigation inside the workspace tab. */
export function ScholarshipNav({ projectId, current }: { projectId: string; current: ScholarshipSection }) {
  const base = `/projects/${projectId}/scholarship`;
  return (
    <nav aria-label="Scholarship" className="mb-4 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.slug}
          href={l.slug ? `${base}/${l.slug}` : base}
          aria-current={l.slug === current ? "page" : undefined}
          className={cx(
            "flex min-h-11 items-center border px-3 text-sm",
            l.slug === current ? "border-primary bg-primary text-white" : "border-grid bg-surface text-primary hover:border-muted",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
