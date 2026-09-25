import { getCurrentUser } from "@/lib/auth";
import { defaultReportYear } from "@/lib/committee/annualReport";
import { download } from "@/lib/committee/services/download";
import { annualReportDownload } from "@/lib/committee/services/report";

/** The annual report as Markdown, for the GMEC packet. Chair only. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const requested = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : defaultReportYear(new Date());
  return download("text/markdown", async () => {
    const { filename, markdown } = await annualReportDownload(user, year);
    return { filename, body: markdown };
  });
}
