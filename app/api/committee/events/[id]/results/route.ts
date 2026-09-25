import { getCurrentUser } from "@/lib/auth";
import { download } from "@/lib/committee/services/download";
import { judgingExport } from "@/lib/committee/services/events";

/** The judging results as CSV. Chair only; shared places are flagged, never broken. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  return download("text/csv", async () => {
    const { filename, csv } = await judgingExport(user, id);
    return { filename, body: csv };
  });
}
