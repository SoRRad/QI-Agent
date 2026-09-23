"use client";

import { useActionState, useEffect, useRef } from "react";
import { driverAction, type FormState } from "@/app/projects/actions";
import { CHILD_KIND, KIND_LABEL, type DriverTreeNode } from "@/lib/projects/drivers";
import { PhiNotice } from "@/components/phi/PhiNotice";
import { Button, cx } from "@/components/ui/primitives";
import { inputClass } from "./ActionForm";

/**
 * The driver diagram as an editable outline: the form of the diagram that
 * works on a phone and with a screen reader. The SVG beside it is drawn from
 * the same tree.
 */
export function DriverEditor({ projectId, tree }: { projectId: string; tree: DriverTreeNode[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label="Drivers and change ideas">
        {tree.map((node, i) => (
          <DriverItem key={node.id} projectId={projectId} node={node} first={i === 0} last={i === tree.length - 1} depth={0} />
        ))}
      </ul>
      <AddNode projectId={projectId} parentId={null} kind="primary" />
    </div>
  );
}

function useDriver() {
  return useActionState<FormState, FormData>(driverAction, { status: "idle" });
}

function Outcome({ state }: { state: FormState }) {
  if (state.status === "error") return <p className="text-xs text-signal">{state.message}</p>;
  if (state.status === "phi") return <PhiNotice feedback={state} />;
  return null;
}

function DriverItem({ projectId, node, first, last, depth }: { projectId: string; node: DriverTreeNode; first: boolean; last: boolean; depth: number }) {
  const [state, action, pending] = useDriver();
  const childKind = CHILD_KIND[node.kind];
  return (
    <li className={cx("border-l-2 pl-3", node.kind === "primary" ? "border-primary" : node.kind === "secondary" ? "border-muted" : "border-grid")}>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink">
          <span className="eyebrow mr-1.5">{KIND_LABEL[node.kind]}</span>
          {node.text}
        </p>
        <details className="text-sm">
          <summary className="inline-flex min-h-9 cursor-pointer items-center text-xs font-medium text-primary">Edit</summary>
          <div className="mt-2 flex flex-col gap-2">
            <form action={action} className="flex flex-col gap-2 sm:flex-row">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="nodeId" value={node.id} />
              <input type="hidden" name="op" value="rename" />
              <label className="sr-only" htmlFor={`rename-${node.id}`}>
                Rename {KIND_LABEL[node.kind].toLowerCase()}
              </label>
              <input id={`rename-${node.id}`} name="text" defaultValue={node.text} className={inputClass} />
              <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
                Rename
              </Button>
            </form>
            <form action={action} className="flex flex-wrap gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="nodeId" value={node.id} />
              {!first && (
                <Button type="submit" name="op" value="up" variant="ghost" disabled={pending} aria-label={`Move “${node.text}” up`}>
                  ↑ Up
                </Button>
              )}
              {!last && (
                <Button type="submit" name="op" value="down" variant="ghost" disabled={pending} aria-label={`Move “${node.text}” down`}>
                  ↓ Down
                </Button>
              )}
              <Button type="submit" name="op" value="remove" variant="ghost" disabled={pending} aria-label={`Remove “${node.text}” and everything under it`}>
                Remove
              </Button>
            </form>
            <Outcome state={state} />
          </div>
        </details>
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {node.children.map((child, i) => (
            <DriverItem key={child.id} projectId={projectId} node={child} first={i === 0} last={i === node.children.length - 1} depth={depth + 1} />
          ))}
        </ul>
      )}
      {childKind && <AddNode projectId={projectId} parentId={node.id} kind={childKind} />}
    </li>
  );
}

function AddNode({ projectId, parentId, kind }: { projectId: string; parentId: string | null; kind: "primary" | "secondary" | "change" }) {
  const [state, action, pending] = useDriver();
  const form = useRef<HTMLFormElement>(null);
  const label = `Add a ${KIND_LABEL[kind].toLowerCase()}`;
  const inputId = `add-${parentId ?? "root"}`;
  // Clear the field once the node is saved; the outline shows it in place.
  useEffect(() => {
    if (state.status === "done") form.current?.reset();
  }, [state]);
  return (
    <details className="mt-1 text-sm">
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-xs font-medium text-primary">+ {label}</summary>
      <form ref={form} action={action} className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="op" value="add" />
        <input type="hidden" name="kind" value={kind} />
        {parentId && <input type="hidden" name="parentId" value={parentId} />}
        <label className="sr-only" htmlFor={inputId}>
          {label}
        </label>
        <input id={inputId} name="text" required minLength={3} className={inputClass} />
        <Button type="submit" disabled={pending} className="shrink-0">
          Add
        </Button>
      </form>
      <Outcome state={state} />
    </details>
  );
}

/** Rasterises the diagram's own SVG to PNG in the browser (no headless browser anywhere). */
export function ExportPng({ svgId, fileName }: { svgId: string; fileName: string }) {
  async function exportPng() {
    const svg = document.getElementById(svgId);
    if (!(svg instanceof SVGSVGElement)) return;
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    const source = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
      }, "image/png");
    };
    image.src = url;
  }
  return (
    <Button type="button" variant="secondary" onClick={exportPng} className="w-full sm:w-auto">
      Download as PNG
    </Button>
  );
}
