import { getCurrentUser } from "@/lib/auth";
import { CLER_LABEL, isClerDomain } from "@/lib/cler";
import { db } from "@/lib/db";
import { nextQuarter, quarterLabel, quarterOf } from "@/lib/pulse/quarter";
import { surveyRates, surveyResults } from "@/lib/pulse/results";
import { AddQuestionForm, CreateSurveyForm, IntroForm, QuestionEditor, SurveyStatusForm } from "@/components/pulse/ComposerForms";
import { ChairOnly, ManageNav } from "@/components/pulse/ManageNav";
import { Banner, CentreRule, PageHeader, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage pulse" };

export default async function ManagePulsePage() {
  const user = await getCurrentUser();
  if (user.role !== "chair") {
    return (
      <>
        <PageHeader eyebrow="Pulse" title="Manage" />
        <ChairOnly />
      </>
    );
  }

  const surveys = await db.pulseSurvey.findMany({
    orderBy: { quarter: "desc" },
    include: { questions: { orderBy: { position: "asc" } }, _count: { select: { responses: true } } },
  });
  const open = surveys.find((s) => s.status === "open");
  const drafts = surveys.filter((s) => s.status === "draft");
  const closed = surveys.filter((s) => s.status === "closed");
  const [rates, results] = open ? await Promise.all([surveyRates(open.id), surveyResults(open.id)]) : [null, null];
  const suggested = nextQuarter(surveys[0]?.quarter ?? quarterOf(new Date()));

  return (
    <>
      <PageHeader eyebrow="Pulse · chair" title="Manage the pulse survey" lede="Compose the quarterly survey, watch who has responded by program, and read the answers as counts." />
      <ManageNav current="/pulse/manage" />

      <div className="flex flex-col gap-4">
        {open && rates && results ? (
          <>
            <PlotFrame label={`Open · ${quarterLabel(open.quarter)}`} action={<SurveyStatusForm surveyId={open.id} to="closed" label="Close the survey" />}>
              <h2 className="font-display text-lg font-semibold text-ink">Response rate by program</h2>
              <p className="mt-1 text-xs text-muted">Who responded, from the participation record — not from the optional program on a response.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="response-rates">
                  <caption className="sr-only">Response rate by program, {open.quarter}</caption>
                  <thead>
                    <tr className="border-b border-grid">
                      <th scope="col" className="py-2 pr-3 font-semibold">Program</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Responded</th>
                      <th scope="col" className="py-2 text-right font-semibold">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {[...rates.programs, rates.total].map((r) => (
                      <tr key={r.programId} className={r.programId === "all" ? "font-semibold" : "border-b border-grid"}>
                        <th scope="row" className="py-2 pr-3 font-sans font-normal">{r.program}</th>
                        <td className="py-2 pr-3 text-right">
                          {r.responded} of {r.trainees}
                        </td>
                        <td className="py-2 text-right">{r.percent === null ? "—" : `${r.percent}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PlotFrame>

            <PlotFrame label={`Answers so far · ${results.responses} responses`}>
              <div className="flex flex-col gap-5" data-testid="survey-results">
                {results.questions.map(({ question, counts, texts }) => (
                  <section key={question.id}>
                    <h3 className="text-sm font-semibold text-ink">{question.prompt}</h3>
                    {question.core === "barrier" ? (
                      <p className="mt-1 text-sm text-muted">Free text is read as themes on the Theme responses page.</p>
                    ) : counts.length > 0 ? (
                      <table className="mt-2 w-full text-sm">
                        <caption className="sr-only">Answers to: {question.prompt}</caption>
                        <tbody className="font-mono tabular-nums">
                          {counts.map((c) => (
                            <tr key={c.value} className="border-b border-grid">
                              <th scope="row" className="py-1.5 pr-3 text-left font-sans font-normal">
                                {question.core === "cler_domain" && isClerDomain(c.value) ? CLER_LABEL[c.value] : c.value}
                              </th>
                              <td className="py-1.5 text-right">{c.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink">
                        {texts.length === 0 ? <li className="text-muted">No answers yet.</li> : texts.map((t, i) => <li key={i} className="border-l-2 border-grid pl-2">{t}</li>)}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </PlotFrame>
          </>
        ) : (
          <Banner title="No survey is open">Open a draft below when it is ready. Only one survey is open at a time.</Banner>
        )}

        <CentreRule label="Drafts" />
        {drafts.map((draft) => (
          <PlotFrame
            key={draft.id}
            label={`Draft · ${quarterLabel(draft.quarter)} · ${draft.questions.length} questions`}
            action={open ? undefined : <SurveyStatusForm surveyId={draft.id} to="open" label="Open for responses" />}
          >
            {open && <p className="mb-3 text-sm text-muted">Close the {open.quarter} survey before opening this one.</p>}
            <div className="flex flex-col gap-6">
              <IntroForm surveyId={draft.id} intro={draft.intro} />
              <ol className="flex flex-col gap-6">
                {draft.questions.map((q, i) => (
                  <li key={q.id} className="border-t border-grid pt-4">
                    <QuestionEditor question={q} index={i} count={draft.questions.length} />
                  </li>
                ))}
              </ol>
              <div className="border-t border-grid pt-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Add a question of your own</h3>
                <AddQuestionForm surveyId={draft.id} />
              </div>
            </div>
          </PlotFrame>
        ))}
        {drafts.length === 0 && (
          <PlotFrame label="Next quarter">
            <CreateSurveyForm quarter={suggested} />
          </PlotFrame>
        )}

        {closed.length > 0 && (
          <>
            <CentreRule label="Earlier surveys" />
            <ul className="flex flex-col gap-2 text-sm">
              {closed.map((s) => (
                <li key={s.id} className="flex justify-between border-b border-grid py-2">
                  <span>{quarterLabel(s.quarter)}</span>
                  <span className="font-mono text-muted">{s._count.responses} responses</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
