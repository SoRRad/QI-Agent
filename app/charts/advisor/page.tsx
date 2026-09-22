import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { advise, advisorQuery, optionLabel, parseAnswers, QUESTIONS } from "@/lib/charts/advisor";
import { CHART_NAMES } from "@/lib/charts/describe";
import { Badge, Banner, PageHeader, PlotFrame } from "@/components/ui/primitives";
import { CHART_SECTIONS, SectionTabs } from "@/components/ui/SectionTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Which chart?" };

/**
 * The chart-type advisor. Each answer is a link, so the whole walk-through is
 * a URL a coach can send, it works without JavaScript, and the answer comes
 * from lib/charts/advisor.ts — a decision tree with no model in its path.
 */
export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await getCurrentUser();
  const answers = parseAnswers(await searchParams);
  const step = advise(answers);
  const answered = step.path.filter((id) => answers[id] !== undefined);

  return (
    <>
      <PageHeader
        eyebrow="Charts"
        title="Which chart?"
        lede="Four facts about your data decide the chart. Answer them and the advisor tells you which chart fits, and why. No language model chooses it."
      />
      <SectionTabs label="Charts sections" current="advisor" items={CHART_SECTIONS} />

      <div className="flex flex-col gap-4">
        {answered.length > 0 && (
          <PlotFrame label="Your answers">
            <ol className="flex flex-col gap-2">
              {answered.map((id, i) => (
                <li key={id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0">
                    <span className="text-muted">{QUESTIONS[id].prompt}</span>{" "}
                    <strong className="font-semibold text-ink">{optionLabel(id, answers[id])}</strong>
                  </span>
                  <Link
                    href={`/charts/advisor${advisorQuery(answers, step.path.slice(0, i))}`}
                    className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline-offset-2 hover:underline"
                    aria-label={`Change your answer to: ${QUESTIONS[id].prompt}`}
                  >
                    Change
                  </Link>
                </li>
              ))}
            </ol>
          </PlotFrame>
        )}

        {step.kind === "question" ? (
          <PlotFrame label={`Question ${answered.length + 1}`}>
            <h2 className="text-lg font-semibold text-ink" id="advisor-question">
              {step.question.prompt}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{step.question.help}</p>
            <ul className="mt-4 flex flex-col gap-2" aria-labelledby="advisor-question">
              {step.question.options.map((option) => (
                <li key={option.value}>
                  <Link
                    href={`/charts/advisor${advisorQuery({ ...answers, [step.question.id]: option.value }, [...step.path])}`}
                    className="block border border-grid bg-surface px-4 py-3 hover:border-primary"
                  >
                    <span className="block text-sm font-semibold text-primary">{option.label}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted">{option.example}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </PlotFrame>
        ) : (
          <PlotFrame label="Recommendation">
            <div className="flex flex-col gap-4" data-testid="recommendation">
              <div>
                <p className="eyebrow">Use</p>
                <h2 className="mt-1 font-display text-2xl font-bold text-ink">{step.recommendation.name}</h2>
                {!step.recommendation.supported && (
                  <div className="mt-2">
                    <Badge>not drawn by this studio yet</Badge>
                  </div>
                )}
              </div>

              <div>
                <p className="eyebrow">Why</p>
                <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink marker:text-muted">
                  {step.recommendation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ol>
              </div>

              {step.recommendation.caveats.length > 0 && (
                <Banner tone="primary" title={step.recommendation.useNow === step.recommendation.chart ? "Worth knowing" : `In this studio today: ${CHART_NAMES[step.recommendation.useNow]}`}>
                  <ul className="flex flex-col gap-1">
                    {step.recommendation.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                </Banner>
              )}

              <p className="text-sm leading-relaxed text-muted">
                Use this chart type when you add the measure to your project. Whatever the chart, a
                run chart of the same data is never wrong as a first look.
              </p>
              <Link href="/charts/advisor" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline">
                Start again
              </Link>
            </div>
          </PlotFrame>
        )}
      </div>
    </>
  );
}
