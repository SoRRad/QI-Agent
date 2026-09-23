"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { phiErrorBody, type PhiErrorBody } from "@/lib/phi";
import { runWithContext } from "@/lib/request-context";

/**
 * Library admin. Chair only.
 *
 * A library document is free text like any other, so a save passes through
 * the PHI guard inside the database client. The worked examples in the aim
 * standard contain calendar dates, so an edit to that document asks the chair
 * to confirm them — that is the warn tier working, not a bug.
 */

export type SaveState =
  | { status: "idle" }
  | ({ status: "phi" } & PhiErrorBody)
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

const docSchema = z.object({
  title: z.string().trim().min(3, "Give the document a title.").max(160),
  body: z.string().trim().min(20, "The document needs a body.").max(60_000),
  isLocal: z.boolean(),
  localFieldsRequired: z.array(z.string().trim().min(3).max(300)).max(40),
});

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function saveLibraryDoc(_previous: SaveState, formData: FormData): Promise<SaveState> {
  let user;
  try {
    user = await requireRole("chair");
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: "error", message: "Only the chair can edit the library." };
    throw error;
  }

  const parsed = docSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    isLocal: formData.get("isLocal") === "on",
    localFieldsRequired: String(formData.get("localFieldsRequired") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  });
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;
  const existingSlug = (formData.get("slug") as string | null) || null;
  const acknowledged = formData.getAll("ack").filter((v): v is string => typeof v === "string");

  let slug: string;
  try {
    slug = await runWithContext({ userId: user.id, acknowledgedPhi: new Set(acknowledged) }, async () => {
      if (existingSlug) {
        const current = await db.libraryDoc.findUniqueOrThrow({ where: { slug: existingSlug } });
        await db.libraryDoc.update({
          where: { id: current.id },
          data: {
            title: data.title,
            body: data.body,
            isLocal: data.isLocal,
            localFieldsRequired: data.isLocal ? data.localFieldsRequired : [],
            version: { increment: 1 },
            updatedById: user.id,
          },
        });
        await audit({
          userId: user.id,
          action: "library.doc_updated",
          entity: "LibraryDoc",
          entityId: current.id,
          metadata: { fromVersion: current.version, isLocal: data.isLocal },
        });
        return current.slug;
      }

      const base = slugify(data.title) || "document";
      let candidate = base;
      for (let n = 2; await db.libraryDoc.findUnique({ where: { slug: candidate } }); n += 1) {
        candidate = `${base}-${n}`;
      }
      const created = await db.libraryDoc.create({
        data: {
          slug: candidate,
          title: data.title,
          body: data.body,
          isLocal: data.isLocal,
          localFieldsRequired: data.isLocal ? data.localFieldsRequired : [],
          updatedById: user.id,
        },
      });
      await audit({
        userId: user.id,
        action: "library.doc_created",
        entity: "LibraryDoc",
        entityId: created.id,
        metadata: { isLocal: data.isLocal },
      });
      return created.slug;
    });
  } catch (error) {
    const phi = phiErrorBody(error);
    if (phi) return { status: "phi", ...phi };
    throw error;
  }

  revalidatePath("/committee/library");
  revalidatePath("/ask");
  redirect(`/committee/library?saved=${encodeURIComponent(slug)}`);
}
