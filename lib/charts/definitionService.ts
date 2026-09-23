import { createHash } from "node:crypto";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import type { LlmDependencies } from "@/lib/llm";
import { runPrompt } from "@/lib/llm/run";
import { dataRequestPrompt, definitionRestatementPrompt } from "@/lib/llm/prompts";
import { outputColumns, requestMarkdown, resolveRange, type DataRequestDocument, type MonthRange } from "./dataRequest";
import type { DefinitionInput } from "./definition";
import { MeasureAccessError, requireMeasureEdit } from "./service";

/**
 * Definitions are append-only (enforced by a trigger): saving writes the next
 * version. The reproducibility restatement is written onto the version it
 * describes, and once confirmed the database refuses to change it.
 */

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefinitionError";
  }
}

const FIELDS = ["numerator", "denominator", "inclusions", "exclusions", "dataSource", "puller", "cadence"] as const;

export async function saveDefinition(user: User, measureId: string, input: DefinitionInput): Promise<{ version: number }> {
  const { measure } = await requireMeasureEdit(user, measureId);
  const latest = measure.definitions[0];
  if (latest && FIELDS.every((f) => latest[f] === input[f])) {
    throw new DefinitionError("Nothing has changed from version " + latest.version + ", so there is nothing to save.");
  }
  const version = (latest?.version ?? 0) + 1;
  const created = await db.measureDefinition.create({
    data: { measureId, version, ...input, createdById: user.id },
  });
  await audit({
    userId: user.id,
    action: "measure.definition_created",
    entity: "MeasureDefinition",
    entityId: created.id,
    metadata: { measureId, version },
  });
  return { version };
}

/** A short digest of the restatement the user was shown, so they confirm exactly that text. */
export function restatementDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export interface Restatement {
  definitionId: string;
  version: number;
  query: string;
  ambiguities: string[];
  digest: string;
  confirmedAt: Date | null;
}

export async function restateDefinition(user: User, measureId: string, deps: LlmDependencies = {}): Promise<Restatement> {
  const { measure } = await requireMeasureEdit(user, measureId);
  const def = measure.definitions[0];
  if (!def) throw new DefinitionError("Write the definition before checking it.");
  if (def.reproducibilityConfirmedAt && def.reproducibilityRestatement) {
    // Confirmed evidence is never regenerated; a changed meaning is a new version.
    return {
      definitionId: def.id,
      version: def.version,
      query: def.reproducibilityRestatement,
      ambiguities: [],
      digest: restatementDigest(def.reproducibilityRestatement),
      confirmedAt: def.reproducibilityConfirmedAt,
    };
  }

  const output = await runPrompt(
    definitionRestatementPrompt,
    {
      measureName: measure.name,
      chartType: measure.chartType,
      cadence: def.cadence,
      numerator: def.numerator,
      denominator: def.denominator,
      inclusions: def.inclusions,
      exclusions: def.exclusions,
      dataSource: def.dataSource,
      puller: def.puller,
    },
    { userId: user.id },
    deps,
  );
  // Stored now, unconfirmed, so the confirmation below refers to text the
  // server holds rather than text the browser sends back.
  await db.measureDefinition.update({ where: { id: def.id }, data: { reproducibilityRestatement: output.query } });
  return {
    definitionId: def.id,
    version: def.version,
    query: output.query,
    ambiguities: output.ambiguities,
    digest: restatementDigest(output.query),
    confirmedAt: null,
  };
}

export async function confirmRestatement(
  user: User,
  measureId: string,
  definitionId: string,
  digest: string,
): Promise<{ confirmedAt: Date; query: string; version: number }> {
  await requireMeasureEdit(user, measureId);
  const def = await db.measureDefinition.findFirst({ where: { id: definitionId, measureId } });
  if (!def?.reproducibilityRestatement) throw new DefinitionError("There is no restatement to confirm. Run the check first.");
  if (def.reproducibilityConfirmedAt) {
    return { confirmedAt: def.reproducibilityConfirmedAt, query: def.reproducibilityRestatement, version: def.version };
  }
  if (restatementDigest(def.reproducibilityRestatement) !== digest) {
    throw new DefinitionError("The restatement changed since you read it. Read the new one before confirming.");
  }
  const latest = await db.measureDefinition.findFirst({ where: { measureId }, orderBy: { version: "desc" }, select: { id: true } });
  if (latest?.id !== def.id) throw new DefinitionError("A newer version of this definition exists. Check that one instead.");

  const confirmedAt = new Date();
  await db.measureDefinition.update({ where: { id: def.id }, data: { reproducibilityConfirmedAt: confirmedAt } });
  await audit({
    userId: user.id,
    action: "measure.definition_confirmed",
    entity: "MeasureDefinition",
    entityId: def.id,
    metadata: { measureId, version: def.version },
  });
  return { confirmedAt, query: def.reproducibilityRestatement, version: def.version };
}

export async function draftDataRequest(
  user: User,
  measureId: string,
  months: MonthRange,
  deps: LlmDependencies = {},
  today: Date = new Date(),
): Promise<{ document: DataRequestDocument; markdown: string }> {
  const { measure } = await requireMeasureEdit(user, measureId);
  if (measure.isLibrary) throw new MeasureAccessError("Data requests are written for a project's measure, not a library definition.");
  const def = measure.definitions[0];
  if (!def) throw new DefinitionError("Write the operational definition first: a data request is built from it.");

  const resolved = resolveRange(months, def.cadence, today);
  if (!resolved.ok) throw new DefinitionError(resolved.error);
  const { range } = resolved;

  const project = measure.project
    ? await db.project.findUnique({
        where: { id: measure.project.id },
        select: {
          problemStatement: true,
          program: { select: { name: true } },
          aimStatements: { orderBy: { version: "desc" }, take: 1, select: { text: true } },
        },
      })
    : null;

  const output = await runPrompt(
    dataRequestPrompt,
    {
      measureName: measure.name,
      chartType: measure.chartType,
      cadence: def.cadence,
      numerator: def.numerator,
      denominator: def.denominator,
      inclusions: def.inclusions,
      exclusions: def.exclusions,
      dataSource: def.dataSource,
      problemStatement: project?.problemStatement ?? null,
      aimText: project?.aimStatements[0]?.text ?? null,
      rangeText: `${range.fromText} to ${range.toText} (${range.periods} ${range.periodName})`,
    },
    { userId: user.id },
    deps,
  );

  const document: DataRequestDocument = {
    measureName: measure.name,
    requestedBy: [user.name, project?.program.name].filter(Boolean).join(", "),
    clinicalQuestion: output.clinicalQuestion,
    range,
    cadence: def.cadence,
    columns: outputColumns(measure.chartType, def.cadence),
    definition: {
      numerator: def.numerator,
      denominator: def.denominator,
      inclusions: def.inclusions,
      exclusions: def.exclusions,
      dataSource: def.dataSource,
      puller: def.puller,
    },
    systems: output.systems,
    fields: output.fields,
    filters: output.filters,
    questions: output.questions,
  };
  return { document, markdown: requestMarkdown(document) };
}
