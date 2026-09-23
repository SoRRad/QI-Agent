import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";

/**
 * The institution-wide measure library. Chair-only: promotion copies a
 * project's local measure into the library; supersession marks a library
 * definition as replaced without editing it, so every chart built on it can
 * say what changed and when (addition C3).
 */

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryError";
  }
}

function requireChair(user: User, what: string): void {
  if (user.role !== "chair") throw new LibraryError(`Only the chair can ${what}.`);
}

/**
 * The library copy gets version 1 of the project's CURRENT definition; the
 * project measure is then linked to it, so a later supersession reaches its
 * chart.
 */
export async function promoteMeasure(user: User, measureId: string): Promise<{ id: string; name: string }> {
  requireChair(user, "add a measure to the library");
  const measure = await db.measure.findUnique({
    where: { id: measureId },
    select: {
      id: true,
      name: true,
      type: true,
      chartType: true,
      isLibrary: true,
      basedOnId: true,
      definitions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!measure || measure.isLibrary) throw new LibraryError("Only a project measure can be promoted.");
  if (measure.basedOnId) throw new LibraryError("This measure is already built on a library definition.");
  const definition = measure.definitions[0];
  if (!definition) throw new LibraryError("Write an operational definition before promoting this measure.");

  const library = await db.$transaction(async (tx) => {
    const created = await tx.measure.create({
      data: {
        name: measure.name,
        type: measure.type,
        chartType: measure.chartType,
        isLibrary: true,
        promotedAt: new Date(),
        promotedById: user.id,
        definitions: {
          create: {
            version: 1,
            numerator: definition.numerator,
            denominator: definition.denominator,
            inclusions: definition.inclusions,
            exclusions: definition.exclusions,
            dataSource: definition.dataSource,
            puller: definition.puller,
            cadence: definition.cadence,
            createdById: user.id,
          },
        },
      },
    });
    await tx.measure.update({ where: { id: measure.id }, data: { basedOnId: created.id } });
    return created;
  });
  await audit({
    userId: user.id,
    action: "measure.promoted",
    entity: "Measure",
    entityId: library.id,
    metadata: { fromMeasureId: measure.id, definitionVersion: definition.version },
  });
  return { id: library.id, name: library.name };
}

const deprecation = z.object({
  measureId: z.string().min(1),
  note: z
    .string()
    .trim()
    .min(20, "Say what changed and why, so a reader of an old chart understands it (at least 20 characters).")
    .max(1000),
  supersededById: z.string().min(1).nullable(),
});

export async function deprecateMeasure(
  user: User,
  input: { measureId: string; note: string; supersededById: string | null },
): Promise<void> {
  requireChair(user, "supersede a library measure");
  const parsed = deprecation.safeParse(input);
  if (!parsed.success) throw new LibraryError(parsed.error.issues[0]?.message ?? "Check the form.");
  const { measureId, note, supersededById } = parsed.data;

  const measure = await db.measure.findUnique({ where: { id: measureId }, select: { isLibrary: true, deprecated: true } });
  if (!measure?.isLibrary) throw new LibraryError("Only a library measure can be superseded.");
  if (measure.deprecated) throw new LibraryError("This measure is already superseded.");
  if (supersededById) {
    const replacement = await db.measure.findUnique({ where: { id: supersededById }, select: { isLibrary: true, deprecated: true } });
    if (!replacement?.isLibrary || replacement.deprecated || supersededById === measureId) {
      throw new LibraryError("The replacement must be a current library measure.");
    }
  }

  await db.measure.update({
    where: { id: measureId },
    data: { deprecated: true, deprecatedAt: new Date(), deprecationNote: note, supersededById },
  });
  await audit({ userId: user.id, action: "measure.deprecated", entity: "Measure", entityId: measureId, metadata: { supersededById } });
}
