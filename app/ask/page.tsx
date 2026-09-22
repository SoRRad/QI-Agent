import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { coachableProjects } from "@/lib/projects/access";
import { AskForm } from "@/components/ask/AskForm";
import { DevilsAdvocatePanel } from "@/components/ask/DevilsAdvocatePanel";
import { ModeTabs } from "@/components/ask/ModeTabs";
import { TutorPanel } from "@/components/ask/TutorPanel";
import { Badge, PageHeader, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask" };

const MODES = [
  { id: "ask", label: "Ask" },
  { id: "tutor", label: "Tutor" },
  { id: "devil", label: "Devil's advocate" },
  { id: "library", label: "Library" },
] as const;

type Mode = (typeof MODES)[number]["id"];

const HEADERS: Record<Mode, { title: string; lede: string }> = {
  ask: {
    title: "Library-grounded answers",
    lede: "Answers come only from the institutional library, with the passage they rely on. Where the library does not cover a question, Ask says so and names the document that should be written — it never answers a policy question from general knowledge.",
  },
  tutor: {
    title: "Tutor",
    lede: "A coach that asks, one question at a time, working from your own project. It will not write your aim statement for you.",
  },
  devil: {
    title: "Devil's advocate",
    lede: "Argues, from a project's own record, why it will fail — and what to do about each risk. The numbers it cites are computed by the system, not by the model.",
  },
  library: {
    title: "Institutional library",
    lede: "Every document Ask answers from. Documents marked LOCAL are placeholders the institution has not yet written.",
  },
};

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const user = await getCurrentUser();
  const { mode: raw } = await searchParams;
  const mode: Mode = MODES.some((m) => m.id === raw) ? (raw as Mode) : "ask";
  const header = HEADERS[mode];

  const needsProjects = mode === "tutor" || mode === "devil";
  const projects = needsProjects
    ? (await coachableProjects(user)).map((p) => ({ id: p.id, title: p.title }))
    : [];

  return (
    <>
      <PageHeader eyebrow="Ask" title={header.title} lede={header.lede} />
      <ModeTabs label="Ask modes" base="/ask" current={mode} modes={MODES} />

      {mode === "ask" && <AskForm />}
      {mode === "tutor" && <TutorPanel projects={projects} />}
      {mode === "devil" && <DevilsAdvocatePanel projects={projects} />}
      {mode === "library" && <LibraryList />}
    </>
  );
}

async function LibraryList() {
  const docs = await db.libraryDoc.findMany({
    orderBy: [{ isLocal: "asc" }, { title: "asc" }],
    select: { slug: true, title: true, isLocal: true, localFieldsRequired: true, version: true },
  });

  return (
    <PlotFrame label={`${docs.length} documents`}>
      <ul className="divide-y divide-grid">
        {docs.map((doc) => (
          <li key={doc.slug} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/ask/library/${doc.slug}`} className="min-w-0 text-sm font-medium text-primary underline-offset-2 hover:underline">
                {doc.title}
              </Link>
              {doc.isLocal ? <Badge tone="signal">local</Badge> : <Badge tone="neutral">standard</Badge>}
            </div>
            {doc.isLocal && (
              <p className="mt-1 font-mono text-xs text-muted" data-numeric="">
                Placeholder · {doc.localFieldsRequired.length} items required from the institution
              </p>
            )}
          </li>
        ))}
      </ul>
    </PlotFrame>
  );
}
