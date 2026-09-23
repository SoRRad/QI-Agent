import Link from "next/link";
import { findSimilarProjects } from "@/lib/search/similar";
import { runWithContext } from "@/lib/request-context";
import { Badge } from "@/components/ui/primitives";

/**
 * Duplicate detection at intake (§6.2). Streams in after the page, because it
 * makes a model call. The outcome and the reason a project ended are read
 * from its record; only the "what overlaps" sentence is the model's.
 */
export async function SimilarProjects({
  projectId,
  title,
  problemStatement,
  userId,
}: {
  projectId: string;
  title: string;
  problemStatement: string;
  userId: string;
}) {
  const result = await runWithContext({ userId, acknowledgedPhi: new Set() }, () =>
    findSimilarProjects({ title, problemStatement }, { excludeId: projectId, userId }),
  );

  if (result.projects.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted" data-testid="similar-none">
        Nothing in the registry looks like the same problem. That is worth knowing too: check with your coach whether
        another department has tried it outside this system.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="similar-projects">
      <p className="text-sm leading-relaxed text-ink">
        {result.ranked
          ? "Before you design your first cycle, read how these went. What they achieved and why they ended is from each project's own record."
          : "These registry projects share words with yours. They were not checked for relevance, because the language model is unavailable right now."}
      </p>
      <ul className="flex flex-col gap-3">
        {result.projects.map((p) => (
          <li key={p.id} className="border border-grid bg-surface px-3 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/projects/${p.id}`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                {p.title}
              </Link>
              <Badge>{p.status}</Badge>
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted">
              {p.program}
              {p.cohortYear ? ` · ${p.cohortYear} cohort` : ""}
            </p>
            {p.reason && <p className="mt-2 text-sm leading-relaxed text-ink">{p.reason}</p>}
            {p.outcomeSummary && (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                <span className="eyebrow mr-1.5">What it achieved</span>
                {p.outcomeSummary}
              </p>
            )}
            {p.endReason && (
              <p className="mt-1 text-sm leading-relaxed text-muted">
                <span className="eyebrow mr-1.5">Why it ended</span>
                {p.endReason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
