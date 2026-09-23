import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { buildTree, layoutDiagram } from "@/lib/projects/drivers";
import { loadProjectHeader } from "@/lib/projects/load";
import { DriverDiagramSvg } from "@/components/projects/DriverDiagramSvg";
import { DriverEditor, ExportPng } from "@/components/projects/DriverEditor";
import { Banner, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function DriversPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadProjectHeader(id);
  if (!loaded) notFound();
  if (!loaded.canWork) {
    return (
      <Banner title="The driver diagram is part of the working record">
        It is visible to the owning program, its coach and the chair.
      </Banner>
    );
  }
  const [rows, aim] = await Promise.all([
    db.driverNode.findMany({ where: { projectId: id }, select: { id: true, parentId: true, kind: true, text: true, position: true } }),
    db.aimStatement.findFirst({ where: { projectId: id }, orderBy: { version: "desc" }, select: { text: true } }),
  ]);
  const tree = buildTree(rows);
  const layout = layoutDiagram(aim?.text ?? "", tree);
  const slug = loaded.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  const editable = loaded.project.status !== "archived" && loaded.project.status !== "complete";

  return (
    <div className="flex flex-col gap-4">
      <PlotFrame label="Driver diagram" action={<span className="text-xs text-muted">{rows.length} items</span>}>
        <p className="mb-3 text-sm leading-relaxed text-muted">
          Your theory of change: the aim, the primary drivers that most directly affect it, the secondary drivers under
          each, and the change ideas you could test. Each PDSA cycle should test a change idea from here.
        </p>
        <div className="overflow-x-auto border border-grid" tabIndex={0} role="region" aria-label="Driver diagram, scrollable">
          <DriverDiagramSvg id="driver-diagram" layout={layout} title={`Driver diagram for ${loaded.project.title}`} />
        </div>
        <div className="mt-3">
          <ExportPng svgId="driver-diagram" fileName={`driver-diagram-${slug}.png`} />
        </div>
      </PlotFrame>
      {editable && (
        <PlotFrame label="Edit">
          <DriverEditor projectId={id} tree={tree} />
        </PlotFrame>
      )}
    </div>
  );
}
