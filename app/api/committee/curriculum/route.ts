import { getCurrentUser } from "@/lib/auth";
import { download } from "@/lib/committee/services/download";
import { curriculumExport } from "@/lib/committee/services/curriculum";

/** Curriculum completion as CSV for ACGME reporting, in the columns the import reads. Chair only. */
export async function GET() {
  const user = await getCurrentUser();
  return download("text/csv", async () => ({
    filename: `curriculum-completion-${new Date().toISOString().slice(0, 10)}.csv`,
    body: await curriculumExport(user),
  }));
}
