import Link from "next/link";
import { academicYear, academicYearOf, defaultReportYear, groupBlocks } from "@/lib/committee/annualReport";
import { annualReport } from "@/lib/committee/services/report";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { Markdown } from "@/components/ui/Markdown";
import { PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata = { title: "Annual report" };

export default async function AnnualReportPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  if (user.role !== "chair") return <Restricted chairOnly />;
  const now = new Date();
  const current = academicYearOf(now);
  const choices = [current, current - 1, current - 2];
  const requested = Number((await searchParams).year);
  const year = choices.includes(requested) ? requested : defaultReportYear(now);
  const report = await annualReport(user, year, now);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="report"
        title="Annual report"
        lede="A GMEC-ready report for one academic year, assembled from the record. Every figure is counted by the system; the chair adds the narrative."
        action={
          <a href={`/api/committee/report?year=${year}`} className="inline-flex min-h-11 items-center justify-center bg-primary px-4 text-sm font-medium text-white hover:bg-ink">
            Download as Markdown
          </a>
        }
      />
      <nav aria-label="Academic year" className="mb-4 flex flex-wrap gap-2">
        {choices.map((y) => (
          <Link
            key={y}
            href={`/committee/report?year=${y}`}
            aria-current={y === year ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border px-3 text-sm ${y === year ? "border-primary bg-primary text-white" : "border-grid bg-surface text-primary"}`}
          >
            {academicYear(y).label}
            {y === current ? " (to date)" : ""}
          </Link>
        ))}
      </nav>
      <PlotFrame label={report.subtitle}>
        <article data-testid="annual-report" className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold text-ink">{report.title}</h2>
          {report.sections.map((s) => (
            <section key={s.heading} className="border-t border-grid pt-3">
              <h3 className="text-base font-semibold text-ink">{s.heading}</h3>
              <div className="mt-2 flex flex-col gap-3 text-sm">
                {groupBlocks(s.lines).map((block, i) =>
                  typeof block === "string" ? (
                    <Markdown key={i} source={block} />
                  ) : (
                    <div key={i} className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">{block.caption}</caption>
                        <thead className="font-mono text-xs text-muted">
                          <tr>
                            {block.headers.map((h, j) => (
                              <th key={h} scope="col" className={`py-1 pr-2 font-normal ${j > 0 ? "text-right" : ""}`}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-grid">
                          {block.rows.map((row) => (
                            <tr key={row.join("|")}>
                              {row.map((c, j) =>
                                j === 0 ? (
                                  <th key={j} scope="row" className="py-1.5 pr-2 font-normal text-ink">
                                    {c}
                                  </th>
                                ) : (
                                  <td key={j} className="py-1.5 pr-2 text-right font-mono" data-numeric="">
                                    {c}
                                  </td>
                                ),
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ),
                )}
              </div>
            </section>
          ))}
        </article>
      </PlotFrame>
    </>
  );
}
