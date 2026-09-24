import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ProjectNotFoundError, ProjectPermissionError } from "@/lib/projects/service";
import { assembleSquire, squireMarkdown } from "@/lib/scholarship/squire";
import { squireRecord } from "@/lib/scholarship/service";

/** The SQUIRE draft as a Markdown file, for the trainee's word processor. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  try {
    const draft = assembleSquire(await squireRecord(user, id));
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";
    await audit({ userId: user.id, action: "export.generated", entity: "Project", entityId: id, metadata: { kind: "squire_markdown" } });
    return new Response(squireMarkdown(draft, today), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-squire-draft.md"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ProjectPermissionError) return new Response(error.message, { status: 403 });
    if (error instanceof ProjectNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
