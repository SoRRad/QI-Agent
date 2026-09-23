import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { quarterLabel } from "@/lib/pulse/quarter";
import { hasResponded, openSurvey } from "@/lib/pulse/survey";
import { SurveyForm } from "@/components/pulse/SurveyForm";
import { Banner, EmptyState, PageHeader, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pulse survey" };

export default async function SurveyPage() {
  const user = await getCurrentUser();
  const survey = await openSurvey();

  if (!survey) {
    return (
      <>
        <PageHeader eyebrow="Pulse" title="Quarterly survey" />
        <EmptyState title="No survey is open">
          The committee opens one survey each quarter. What trainees reported last time, and what changed, is on the{" "}
          <Link href="/pulse" className="text-primary underline underline-offset-2">
            first tab
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  const header = (
    <PageHeader
      eyebrow={`Pulse · ${quarterLabel(survey.quarter)}`}
      title="Quarterly survey"
      lede={survey.intro ?? "Five minutes, once a quarter. What you tell us is read as themes, and the committee reports back what changed."}
    />
  );

  if (user.role !== "trainee") {
    return (
      <>
        {header}
        <Banner tone="primary" title="Preview">
          The survey is for residents and fellows, so you can read it here but not respond. This is what they see.
        </Banner>
        <PlotFrame label={`${survey.questions.length} questions`} className="mt-4">
          <ol className="flex flex-col gap-3">
            {survey.questions.map((q, i) => (
              <li key={q.id} className="text-sm text-ink">
                <span className="font-mono text-xs text-muted">{i + 1}. </span>
                {q.prompt}
                {q.options.length > 0 && <span className="text-muted"> — {q.options.join(" · ")}</span>}
              </li>
            ))}
          </ol>
        </PlotFrame>
      </>
    );
  }

  if (await hasResponded(user.id, survey.id)) {
    return (
      <>
        {header}
        <Banner tone="confirm" title={`You have responded to the ${survey.quarter} survey. Thank you.`}>
          There is one response per person each quarter.{" "}
          <Link href="/pulse/mine" className="text-primary underline underline-offset-2">
            See your responses
          </Link>
          .
        </Banner>
      </>
    );
  }

  const program = user.programId ? await db.program.findUnique({ where: { id: user.programId }, select: { name: true } }) : null;
  return (
    <>
      {header}
      <PlotFrame>
        <SurveyForm surveyId={survey.id} questions={survey.questions} programName={program?.name ?? null} />
      </PlotFrame>
    </>
  );
}
