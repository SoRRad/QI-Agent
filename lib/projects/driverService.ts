import { db } from "@/lib/db";
import type { DriverKind, User } from "@/lib/generated/prisma/client";
import { KIND_LABEL, validPlacement } from "./drivers";
import { canWorkOn, ProjectNotFoundError, ProjectPermissionError, ProjectRuleError } from "./service";

/** Editing the driver diagram. The tree shape is checked here and, for roots, by the database. */

async function project(user: User, projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { programId: true, coachId: true } });
  if (!p) throw new ProjectNotFoundError();
  if (!canWorkOn(user, p)) throw new ProjectPermissionError();
}

async function node(projectId: string, id: string) {
  const n = await db.driverNode.findFirst({ where: { id, projectId } });
  if (!n) throw new ProjectRuleError("That part of the diagram no longer exists. Reload the page.");
  return n;
}

export async function addDriverNode(
  user: User,
  projectId: string,
  input: { kind: DriverKind; parentId: string | null; text: string },
): Promise<string> {
  await project(user, projectId);
  const parent = input.parentId ? await node(projectId, input.parentId) : null;
  if (!validPlacement(input.kind, parent?.kind ?? null)) {
    throw new ProjectRuleError(
      `${KIND_LABEL[input.kind]}s sit under ${input.kind === "primary" ? "the aim" : input.kind === "secondary" ? "a primary driver" : "a secondary driver"}.`,
    );
  }
  const position = await db.driverNode.count({ where: { projectId, parentId: input.parentId } });
  const created = await db.driverNode.create({ data: { projectId, ...input, position } });
  return created.id;
}

export async function renameDriverNode(user: User, projectId: string, id: string, text: string): Promise<void> {
  await project(user, projectId);
  await node(projectId, id);
  await db.driverNode.update({ where: { id }, data: { text } });
}

/** Removes a node and everything under it (the foreign key cascades). */
export async function removeDriverNode(user: User, projectId: string, id: string): Promise<void> {
  await project(user, projectId);
  const n = await node(projectId, id);
  await db.$transaction(async (tx) => {
    await tx.driverNode.delete({ where: { id } });
    const siblings = await tx.driverNode.findMany({ where: { projectId, parentId: n.parentId }, orderBy: { position: "asc" } });
    for (const [i, s] of siblings.entries()) if (s.position !== i) await tx.driverNode.update({ where: { id: s.id }, data: { position: i } });
  });
}

export async function moveDriverNode(user: User, projectId: string, id: string, direction: "up" | "down"): Promise<void> {
  await project(user, projectId);
  const n = await node(projectId, id);
  const siblings = await db.driverNode.findMany({ where: { projectId, parentId: n.parentId }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const index = siblings.findIndex((s) => s.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= siblings.length) return;
  const order = siblings.map((s) => s.id);
  [order[index], order[target]] = [order[target] as string, order[index] as string];
  await db.$transaction(order.map((sid, position) => db.driverNode.update({ where: { id: sid }, data: { position } })));
}
