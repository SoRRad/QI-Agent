import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { LibraryDocForm } from "@/components/committee/LibraryDocForm";
import { PageHeader } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function EditLibraryDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  const { slug } = await params;
  // Only the chair edits. Everyone else reads the document where Ask links it.
  if (user.role !== "chair") redirect(`/ask/library/${slug}`);

  const doc = await db.libraryDoc.findUnique({ where: { slug } });
  if (!doc) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/committee/library" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Library
        </Link>
      </nav>
      <PageHeader eyebrow={`Editing · version ${doc.version}`} title={doc.title} lede="Saving creates the next version. Ask uses it immediately." />
      <LibraryDocForm
        doc={{ slug: doc.slug, title: doc.title, body: doc.body, isLocal: doc.isLocal, localFieldsRequired: doc.localFieldsRequired }}
      />
    </>
  );
}
