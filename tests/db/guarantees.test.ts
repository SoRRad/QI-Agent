import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * The brief's non-negotiable rules are enforced in SQL (migration
 * `hard_guarantees`), not in application code. These tests exist so that a
 * future migration cannot quietly drop a trigger and leave the guarantee
 * documented but absent.
 *
 * Skipped when DATABASE_URL is unset, so `pnpm test` still runs without a
 * database. CI must set one — see docs/DEPLOY.md.
 */

const connectionString = process.env["DATABASE_URL"];

const db = connectionString
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;

afterAll(async () => {
  await db?.$disconnect();
});

describe.skipIf(!db)("database-level guarantees", () => {
  const client = db as PrismaClient;

  /** Runs `fn` in a transaction that is always rolled back. */
  async function inRollback(fn: (tx: PrismaClient) => Promise<void>): Promise<void> {
    const ROLLBACK = new Error("__rollback__");
    try {
      await client.$transaction(async (tx) => {
        await fn(tx as unknown as PrismaClient);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  }

  describe("AuditLog is append-only", () => {
    it("rejects UPDATE", async () => {
      await inRollback(async (tx) => {
        const row = await tx.auditLog.create({ data: { action: "job.run" } });
        await expect(
          tx.auditLog.update({ where: { id: row.id }, data: { action: "phi.block" } }),
        ).rejects.toThrow(/append-only/i);
      });
    });

    it("rejects DELETE", async () => {
      await inRollback(async (tx) => {
        const row = await tx.auditLog.create({ data: { action: "job.run" } });
        await expect(tx.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
          /append-only/i,
        );
      });
    });
  });

  describe("a PDSA cycle cannot be completed without a prediction", () => {
    it("rejects a completed cycle with no prediction", async () => {
      await inRollback(async (tx) => {
        const program = await tx.program.create({
          data: { name: "T", specialty: "T" },
        });
        const project = await tx.project.create({
          data: { title: "T", problemStatement: "T", programId: program.id },
        });
        await expect(
          tx.pdsaCycle.create({
            data: {
              projectId: project.id,
              number: 1,
              plan: "A small test.",
              completedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/pdsa_prediction_required_when_complete/i);
      });
    });

    it("rejects a whitespace-only prediction, which is the obvious workaround", async () => {
      await inRollback(async (tx) => {
        const program = await tx.program.create({ data: { name: "T", specialty: "T" } });
        const project = await tx.project.create({
          data: { title: "T", problemStatement: "T", programId: program.id },
        });
        await expect(
          tx.pdsaCycle.create({
            data: {
              projectId: project.id,
              number: 1,
              plan: "A small test.",
              prediction: "   ",
              completedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/pdsa_prediction_required_when_complete/i);
      });
    });

    it("permits an incomplete cycle with no prediction, and a completed one with it", async () => {
      await inRollback(async (tx) => {
        const program = await tx.program.create({ data: { name: "T", specialty: "T" } });
        const project = await tx.project.create({
          data: { title: "T", problemStatement: "T", programId: program.id },
        });
        // A cycle being planned has no prediction yet. That is allowed.
        const planned = await tx.pdsaCycle.create({
          data: { projectId: project.id, number: 1, plan: "Planning." },
        });
        expect(planned.prediction).toBeNull();

        const done = await tx.pdsaCycle.create({
          data: {
            projectId: project.id,
            number: 2,
            plan: "A small test.",
            prediction: "Uptake rises from 15% to about 50% in two weeks.",
            completedAt: new Date(),
          },
        });
        expect(done.completedAt).not.toBeNull();
      });
    });
  });

  describe("versioned text is append-only", () => {
    it("rejects editing an aim statement in place", async () => {
      await inRollback(async (tx) => {
        const program = await tx.program.create({ data: { name: "T", specialty: "T" } });
        const project = await tx.project.create({
          data: { title: "T", problemStatement: "T", programId: program.id },
        });
        const aim = await tx.aimStatement.create({
          data: { projectId: project.id, version: 1, text: "Version one." },
        });
        await expect(
          tx.aimStatement.update({ where: { id: aim.id }, data: { text: "Rewritten." } }),
        ).rejects.toThrow(/append-only/i);
      });
    });

    it("rejects changing a measure definition's meaning", async () => {
      await inRollback(async (tx) => {
        const measure = await tx.measure.create({
          data: { name: "M", type: "outcome", chartType: "p", isLibrary: true },
        });
        const def = await tx.measureDefinition.create({
          data: {
            measureId: measure.id,
            version: 1,
            numerator: "N",
            denominator: "D",
            inclusions: "I",
            exclusions: "E",
            dataSource: "S",
            puller: "P",
            cadence: "monthly",
          },
        });
        await expect(
          tx.measureDefinition.update({
            where: { id: def.id },
            data: { numerator: "Something else entirely" },
          }),
        ).rejects.toThrow(/append-only/i);
      });
    });

    it("permits recording that the reproducibility restatement was confirmed", async () => {
      // The one allowed post-insert mutation: it records that the user agreed
      // the plain-language restatement matches their intent, and changes
      // nothing about what the definition means.
      await inRollback(async (tx) => {
        const measure = await tx.measure.create({
          data: { name: "M", type: "outcome", chartType: "p", isLibrary: true },
        });
        const def = await tx.measureDefinition.create({
          data: {
            measureId: measure.id,
            version: 1,
            numerator: "N",
            denominator: "D",
            inclusions: "I",
            exclusions: "E",
            dataSource: "S",
            puller: "P",
            cadence: "monthly",
          },
        });
        const updated = await tx.measureDefinition.update({
          where: { id: def.id },
          data: {
            reproducibilityRestatement: "Count N over D each month.",
            reproducibilityConfirmedAt: new Date(),
          },
        });
        expect(updated.reproducibilityConfirmedAt).not.toBeNull();
      });
    });
  });

  it("keeps a project record when its program is removed", async () => {
    // Every project has a permanent record, so a program cannot be deleted
    // out from under one.
    await inRollback(async (tx) => {
      const program = await tx.program.create({ data: { name: "T", specialty: "T" } });
      await tx.project.create({
        data: { title: "T", problemStatement: "T", programId: program.id },
      });
      await expect(tx.program.delete({ where: { id: program.id } })).rejects.toThrow();
    });
  });
});
