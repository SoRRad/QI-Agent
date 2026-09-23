import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { ProblemForm } from "@/components/projects/IntakeForms";
import { PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start a project" };

export default async function NewProjectPage() {
  await getCurrentUser();
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/projects" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Registry
        </Link>
      </nav>
      <div className="mb-5">
        <span className="eyebrow">Intake · step 1 of 6</span>
        <h1 className="mt-1.5 font-display text-2xl font-bold text-ink sm:text-3xl">What is the problem?</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Start with the problem, not the solution. When you save, the registry is searched for projects on the same
          problem — across every program and every year, including ones that ended — so you can learn from them first.
          Nothing is submitted until the last step.
        </p>
      </div>
      <PlotFrame label="Problem">
        <ProblemForm />
      </PlotFrame>
    </>
  );
}
