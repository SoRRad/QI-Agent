import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LibraryDocForm } from "@/components/committee/LibraryDocForm";
import { PageHeader } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function NewLibraryDocPage() {
  const user = await getCurrentUser();
  if (user.role !== "chair") redirect("/committee/library");

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/committee/library" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Library
        </Link>
      </nav>
      <PageHeader eyebrow="Library" title="New document" lede="Ask answers only from the library, so a new document widens what Ask can answer." />
      <LibraryDocForm doc={{ slug: null, title: "", body: "", isLocal: false, localFieldsRequired: [] }} />
    </>
  );
}
