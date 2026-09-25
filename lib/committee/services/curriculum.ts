import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { curriculumCsv, parseCurriculumImport, tracker, type TrackerRecord, type TrackerTrainee } from "../curriculum";
import { CommitteeRuleError, requireChair } from "./access";

/**
 * The curriculum tracker's records. Chair-only (Q4): completion by named
 * trainee is personnel information.
 */

export async function loadTrackerInputs(): Promise<[TrackerTrainee[], TrackerRecord[]]> {
  const [trainees, records] = await Promise.all([
    db.user.findMany({
      where: { role: "trainee", active: true },
      select: {
        id: true,
        name: true,
        email: true,
        program: { select: { name: true } },
      },
    }),
    db.curriculumRecord.findMany({
      select: { userId: true, item: true, completedAt: true },
    }),
  ]);
  return [
    trainees.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      program: t.program?.name ?? "No program",
    })),
    records,
  ];
}

export async function curriculumTracker(user: User) {
  requireChair(user, "The curriculum tracker");
  return tracker(...(await loadTrackerInputs()));
}

export async function curriculumExport(user: User): Promise<string> {
  const t = await curriculumTracker(user);
  await audit({
    userId: user.id,
    action: "export.generated",
    entity: "CurriculumRecord",
    metadata: {
      kind: "curriculum_csv",
      trainees: t.trainees.length,
      items: t.items.length,
    },
  });
  return curriculumCsv(t);
}

export interface ImportSummary {
  rows: number;
  created: number;
  completed: number;
  unchanged: number;
}

/**
 * All or nothing. A blank completed_on assigns the item; an import never
 * clears a completion already on record, so re-importing an older export
 * cannot undo newer work. A mistaken completion is corrected by the chair,
 * not by a file.
 */
export async function importCurriculum(user: User, text: string, today = new Date()): Promise<ImportSummary> {
  requireChair(user, "Importing the curriculum");
  const trainees = await db.user.findMany({
    where: { role: "trainee", active: true },
    select: { id: true, email: true },
  });
  const parsed = parseCurriculumImport(text, trainees, today);
  if (!parsed.ok)
    throw new CommitteeRuleError(`Nothing was imported. ${parsed.errors.slice(0, 10).join(" ")}${parsed.errors.length > 10 ? ` …and ${parsed.errors.length - 10} more.` : ""}`);

  const summary: ImportSummary = {
    rows: parsed.rows.length,
    created: 0,
    completed: 0,
    unchanged: 0,
  };
  await db.$transaction(async (tx) => {
    for (const row of parsed.rows) {
      const existing = await tx.curriculumRecord.findUnique({
        where: { userId_item: { userId: row.userId, item: row.item } },
        select: { id: true, completedAt: true },
      });
      if (!existing) {
        await tx.curriculumRecord.create({
          data: {
            userId: row.userId,
            item: row.item,
            completedAt: row.completedOn,
            source: "csv import",
          },
        });
        summary.created += 1;
        if (row.completedOn) summary.completed += 1;
      } else if (!existing.completedAt && row.completedOn) {
        await tx.curriculumRecord.update({
          where: { id: existing.id },
          data: { completedAt: row.completedOn, source: "csv import" },
        });
        summary.completed += 1;
      } else {
        summary.unchanged += 1;
      }
    }
  });
  await audit({
    userId: user.id,
    action: "curriculum.imported",
    entity: "CurriculumRecord",
    metadata: { ...summary },
  });
  return summary;
}
