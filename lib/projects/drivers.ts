import type { DriverKind } from "@/lib/generated/prisma/client";

/**
 * Driver diagrams: aim → primary drivers → secondary drivers → change ideas.
 *
 * Pure tree building and layout, shared by the on-screen SVG and its PNG
 * export, so the exported picture is the diagram on screen.
 */

export interface DriverRow {
  id: string;
  parentId: string | null;
  kind: DriverKind;
  text: string;
  position: number;
}

export interface DriverTreeNode extends DriverRow {
  children: DriverTreeNode[];
}

export const CHILD_KIND: Record<"root" | DriverKind, DriverKind | null> = {
  root: "primary",
  primary: "secondary",
  secondary: "change",
  change: null,
};

export const KIND_LABEL: Record<DriverKind, string> = {
  primary: "Primary driver",
  secondary: "Secondary driver",
  change: "Change idea",
};

export function buildTree(rows: readonly DriverRow[]): DriverTreeNode[] {
  const byParent = new Map<string | null, DriverRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const build = (parentId: string | null): DriverTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((row) => ({ ...row, children: build(row.id) }));
  return build(null);
}

/** Whether a node of `kind` may sit under a parent of `parentKind` (null = the aim). */
export function validPlacement(kind: DriverKind, parentKind: DriverKind | null): boolean {
  return CHILD_KIND[parentKind ?? "root"] === kind;
}

// ---------------------------------------------------------------- layout

export interface DiagramBox {
  id: string;
  kind: DriverKind | "aim";
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
}

export interface DiagramLink {
  from: string;
  to: string;
  path: string;
}

export interface DiagramLayout {
  width: number;
  height: number;
  columns: Array<{ x: number; label: string }>;
  boxes: DiagramBox[];
  links: DiagramLink[];
}

const COLUMN_WIDTH = 210;
const GAP = 44;
const LINE_HEIGHT = 15;
const PADDING_Y = 10;
// IBM Plex Mono at 11.5px is about 6.9px a character; 26 leaves the 10px padding clear.
const CHARS_PER_LINE = 26;
const HEADER = 30;

/** Greedy word wrap by character count; long words are left whole. */
export function wrap(text: string, max = CHARS_PER_LINE): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/**
 * Four columns. Every leaf takes one row slot; a parent is centred on its
 * children. Slots are uniform (the tallest box sets the pitch), which keeps
 * boxes from overlapping without a constraint solver.
 */
export function layoutDiagram(aimText: string, tree: readonly DriverTreeNode[]): DiagramLayout {
  const columnX = [0, 1, 2, 3].map((i) => i * (COLUMN_WIDTH + GAP));
  const kindColumn: Record<DriverKind, number> = { primary: 1, secondary: 2, change: 3 };

  const all: DriverTreeNode[] = [];
  const walk = (nodes: readonly DriverTreeNode[]) => nodes.forEach((n) => (all.push(n), walk(n.children)));
  walk(tree);

  const heightOf = (text: string) => wrap(text).length * LINE_HEIGHT + PADDING_Y * 2;
  const slot = Math.max(heightOf("x"), ...all.map((n) => heightOf(n.text))) + 14;

  const boxes: DiagramBox[] = [];
  const links: DiagramLink[] = [];
  let cursor = HEADER;

  const place = (node: DriverTreeNode): number => {
    let centre: number;
    if (node.children.length === 0) {
      centre = cursor + slot / 2;
      cursor += slot;
    } else {
      const centres = node.children.map(place);
      centre = ((centres[0] as number) + (centres[centres.length - 1] as number)) / 2;
    }
    const height = heightOf(node.text);
    boxes.push({ id: node.id, kind: node.kind, x: columnX[kindColumn[node.kind]] as number, y: centre - height / 2, width: COLUMN_WIDTH, height, lines: wrap(node.text) });
    return centre;
  };
  const rootCentres = tree.map(place);
  if (tree.length === 0) cursor += slot;

  const aimLines = wrap(aimText || "No aim statement yet.", CHARS_PER_LINE);
  const aimHeight = aimLines.length * LINE_HEIGHT + PADDING_Y * 2;
  const aimCentre = rootCentres.length
    ? ((rootCentres[0] as number) + (rootCentres[rootCentres.length - 1] as number)) / 2
    : HEADER + slot / 2;
  const aimTop = Math.max(HEADER, aimCentre - aimHeight / 2);
  boxes.push({ id: "aim", kind: "aim", x: 0, y: aimTop, width: COLUMN_WIDTH, height: aimHeight, lines: aimLines });

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const connect = (parent: DiagramBox, child: DiagramBox) => {
    const x1 = parent.x + parent.width;
    const y1 = parent.y + parent.height / 2;
    const x2 = child.x;
    const y2 = child.y + child.height / 2;
    const mid = x1 + GAP / 2;
    links.push({ from: parent.id, to: child.id, path: `M${x1},${y1.toFixed(1)}H${mid}V${y2.toFixed(1)}H${x2}` });
  };
  const aimBox = byId.get("aim") as DiagramBox;
  for (const node of all) {
    const child = byId.get(node.id) as DiagramBox;
    const parent = node.parentId ? byId.get(node.parentId) : aimBox;
    if (parent) connect(parent, child);
  }

  const height = Math.max(cursor, aimTop + aimHeight) + 10;
  return {
    width: (columnX[3] as number) + COLUMN_WIDTH,
    height,
    columns: [
      { x: columnX[0] as number, label: "Aim" },
      { x: columnX[1] as number, label: "Primary drivers" },
      { x: columnX[2] as number, label: "Secondary drivers" },
      { x: columnX[3] as number, label: "Change ideas" },
    ],
    boxes,
    links,
  };
}
