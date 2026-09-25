import { getCurrentUser } from "@/lib/auth";
import { kitMarkdown } from "@/lib/committee/eventKit";
import { CommitteeNotFoundError } from "@/lib/committee/services/access";
import { download } from "@/lib/committee/services/download";
import { eventDetail } from "@/lib/committee/services/events";

/** The stored event kit as one Markdown file. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  return download("text/markdown", async () => {
    const { event } = await eventDetail(user, id);
    if (!event.kit) throw new CommitteeNotFoundError("That kit");
    const title = event.title ?? "Committee event";
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    return { filename: `${slug}-kit.md`, body: kitMarkdown(title, event.kit) };
  });
}
