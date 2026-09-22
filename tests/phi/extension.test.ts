import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { createDb } from "@/lib/db";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "@/lib/phi/errors";
import { phiExtension, type AuditEntry } from "@/lib/phi/extension";
import { runWithContext } from "@/lib/request-context";

/**
 * The chokepoint, against a real database.
 *
 * These tests use their own client with an IN-MEMORY audit writer, so they can
 * assert exactly what would be audited without leaving rows in an append-only
 * table. One test at the end checks that the application's own client,
 * createDb(), carries the same guard.
 *
 * Skipped when DATABASE_URL is unset.
 */

const connectionString = process.env["DATABASE_URL"];
const base = connectionString ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) : null;
const audits: AuditEntry[] = [];
const guarded = base?.$extends(
  phiExtension(async (entry) => {
    audits.push(entry);
  }),
);

let programId = "";
let projectId = "";

beforeAll(async () => {
  if (!base) return;
  const program = await base.program.create({ data: { name: "PHI test", specialty: "Test" } });
  const project = await base.project.create({
    data: { title: "PHI test", problemStatement: "Fixture.", programId: program.id },
  });
  programId = program.id;
  projectId = project.id;
});

afterAll(async () => {
  if (!base) return;
  await base.project.deleteMany({ where: { programId } });
  await base.program.deleteMany({ where: { id: programId } });
  await base.$disconnect();
});

const asUser = <T>(fn: () => Promise<T>, acknowledged: string[] = []) =>
  runWithContext({ userId: null, acknowledgedPhi: new Set(acknowledged) }, fn);

const client = () => guarded as NonNullable<typeof guarded>;

describe.skipIf(!base)("the PHI guard inside the database client", () => {
  describe("block tier", () => {
    it("refuses the write, and nothing reaches the table", async () => {
      audits.length = 0;
      await expect(
        asUser(() =>
          client().pdsaCycle.create({
            data: { projectId, number: 101, plan: "Call the family on 555-867-5309." },
          }),
        ),
      ).rejects.toBeInstanceOf(PhiBlockedError);

      expect(await base!.pdsaCycle.count({ where: { projectId, number: 101 } })).toBe(0);
    });

    it("audits that a block occurred — the rule and location, never the text", async () => {
      audits.length = 0;
      await asUser(() =>
        client().pdsaCycle.create({ data: { projectId, number: 102, plan: "SSN 123-45-6789" } }),
      ).catch(() => undefined);

      expect(audits).toHaveLength(1);
      const [entry] = audits;
      expect(entry?.action).toBe("phi.block");
      expect(entry?.entity).toBe("PdsaCycle");
      const serialised = JSON.stringify(entry);
      expect(serialised).toContain('"rule":"ssn"');
      expect(serialised).toContain('"path":"plan"');
      // Q5: never the offending string.
      expect(serialised).not.toContain("123-45-6789");
      expect(serialised).not.toContain("SSN 123");
    });

    it("cannot be acknowledged past", async () => {
      // Even if a client sends a fingerprint for a block, there is no path.
      let fingerprint = "";
      try {
        await asUser(() =>
          client().pdsaCycle.create({ data: { projectId, number: 103, plan: "MRN 00123456" } }),
        );
      } catch (error) {
        fingerprint = (error as PhiBlockedError).flags[0]?.fingerprint ?? "no-fingerprint";
      }
      expect(fingerprint).toBe("no-fingerprint");
      await expect(
        asUser(
          () => client().pdsaCycle.create({ data: { projectId, number: 103, plan: "MRN 00123456" } }),
          ["anything", fingerprint],
        ),
      ).rejects.toBeInstanceOf(PhiBlockedError);
    });

    it("blocks through a nested relation write", async () => {
      await expect(
        asUser(() =>
          client().measure.create({
            data: {
              name: "Nested",
              type: "outcome",
              chartType: "p",
              isLibrary: true,
              definitions: {
                create: {
                  version: 1,
                  numerator: "Exclude acct 445566 duplicates",
                  denominator: "D",
                  inclusions: "I",
                  exclusions: "E",
                  dataSource: "S",
                  puller: "P",
                  cadence: "monthly",
                },
              },
            },
          }),
        ),
      ).rejects.toBeInstanceOf(PhiBlockedError);
      expect(await base!.measure.count({ where: { name: "Nested" } })).toBe(0);
    });

    it("blocks through update and upsert", async () => {
      await expect(
        asUser(() =>
          client().project.update({
            where: { id: projectId },
            data: { obstacleNotes: { set: "Reach the analyst on 555-867-5309" } },
          }),
        ),
      ).rejects.toBeInstanceOf(PhiBlockedError);

      await expect(
        asUser(() =>
          client().sustainabilityPlan.upsert({
            where: { projectId },
            create: { projectId, changeOwner: "Ward lead", cadence: "quarterly", reviewer: "QI", notes: "SSN 123-45-6789" },
            update: {},
          }),
        ),
      ).rejects.toBeInstanceOf(PhiBlockedError);
    });

    it("keeps the audit record when the enclosing transaction rolls back", async () => {
      // The refused write rolls back its transaction. The record that it was
      // refused must survive, which is why the audit writer uses a client
      // outside the transaction.
      audits.length = 0;
      await client()
        .$transaction(async (tx) => {
          await tx.pdsaCycle.create({ data: { projectId, number: 104, plan: "call 555-867-5309" } });
        })
        .catch(() => undefined);
      expect(audits.map((a) => a.action)).toEqual(["phi.block"]);
    });
  });

  describe("warn tier", () => {
    it("requires acknowledgement, and returns fingerprints to acknowledge with", async () => {
      let error: unknown;
      try {
        await asUser(() =>
          client().pdsaCycle.create({ data: { projectId, number: 201, plan: "Moved to bed 14 on arrival." } }),
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PhiAcknowledgementRequiredError);
      const flags = (error as PhiAcknowledgementRequiredError).flags;
      expect(flags.map((f) => f.rule)).toEqual(["room_bed"]);
      expect(flags[0]?.fingerprint).toMatch(/^[0-9a-f]{24}$/);
      expect(await base!.pdsaCycle.count({ where: { projectId, number: 201 } })).toBe(0);
    });

    it("proceeds once every flag is acknowledged, and audits the acknowledgement without the text", async () => {
      const data = { projectId, number: 202, plan: "Seen on 14 March 2025 in bed 14." };
      const fingerprints = await asUser(() => client().pdsaCycle.create({ data })).catch(
        (e: PhiAcknowledgementRequiredError) => e.flags.map((f) => f.fingerprint ?? ""),
      );
      expect(fingerprints).toHaveLength(2);

      audits.length = 0;
      const created = await asUser(() => client().pdsaCycle.create({ data }), fingerprints as string[]);
      expect(created.plan).toBe(data.plan);

      expect(audits).toHaveLength(1);
      expect(audits[0]?.action).toBe("phi.warn_acknowledged");
      expect(audits[0]?.entityId).toBe(created.id);
      const serialised = JSON.stringify(audits[0]);
      expect(serialised).toContain('"rule":"date"');
      expect(serialised).toContain('"rule":"room_bed"');
      expect(serialised).not.toContain("March");
      expect(serialised).not.toContain("bed 14");
    });

    it("refuses a partial acknowledgement", async () => {
      const data = { projectId, number: 203, plan: "Seen on 14 March 2025 in bed 14." };
      const fingerprints = await asUser(() => client().pdsaCycle.create({ data })).catch(
        (e: PhiAcknowledgementRequiredError) => e.flags.map((f) => f.fingerprint ?? ""),
      );
      await expect(
        asUser(() => client().pdsaCycle.create({ data }), [(fingerprints as string[])[0] ?? ""]),
      ).rejects.toBeInstanceOf(PhiAcknowledgementRequiredError);
    });

    it("does not carry an acknowledgement over to different text", async () => {
      const first = { projectId, number: 204, plan: "Seen on 14 March 2025." };
      const fingerprints = await asUser(() => client().pdsaCycle.create({ data: first })).catch(
        (e: PhiAcknowledgementRequiredError) => e.flags.map((f) => f.fingerprint ?? ""),
      );
      await expect(
        asUser(
          () => client().pdsaCycle.create({ data: { ...first, plan: "Seen on 15 March 2025." } }),
          fingerprints as string[],
        ),
      ).rejects.toBeInstanceOf(PhiAcknowledgementRequiredError);
    });
  });

  describe("exemptions", () => {
    it("lets an aim statement carry its calendar deadline without a prompt", async () => {
      const aim = await asUser(() =>
        client().aimStatement.create({
          data: {
            projectId,
            version: 1,
            text: "Reduce late summaries from 34% (baseline, 1 October 2024 – 30 September 2025) to 15% by 30 June 2027.",
            baselinePeriod: "1 October 2024 – 30 September 2025",
          },
        }),
      );
      expect(aim.id).toBeTruthy();
    });

    it("lets a staff-name field hold a name without a prompt", async () => {
      await expect(
        asUser(() =>
          client().project.update({ where: { id: projectId }, data: { clinicalOwner: "Dr. Hannah Vasquez" } }),
        ),
      ).resolves.toBeTruthy();
    });

    it("lets trusted seed content through the warn tier but not the block tier", async () => {
      const trusted = <T>(fn: () => Promise<T>) =>
        runWithContext({ userId: null, acknowledgedPhi: new Set(), trustedContent: "seed" }, fn);

      await expect(
        trusted(() => client().pdsaCycle.create({ data: { projectId, number: 301, plan: "Began 1 February 2026." } })),
      ).resolves.toBeTruthy();

      await expect(
        trusted(() => client().pdsaCycle.create({ data: { projectId, number: 302, plan: "SSN 123-45-6789" } })),
      ).rejects.toBeInstanceOf(PhiBlockedError);
    });
  });

  describe("context propagation", () => {
    it("sees the context even when the caller passes an un-awaited lazy query", async () => {
      // Regression: Prisma query promises execute on `.then()`. Passing one
      // straight through used to run it after the context had exited, so an
      // acknowledged warning was asked for again.
      const data = { projectId, number: 401, plan: "Seen in bed 14." };
      const fingerprints = await runWithContext(
        { userId: null, acknowledgedPhi: new Set() },
        () => client().pdsaCycle.create({ data }),
      ).catch((e: PhiAcknowledgementRequiredError) => e.flags.map((f) => f.fingerprint ?? ""));

      await expect(
        runWithContext({ userId: null, acknowledgedPhi: new Set(fingerprints as string[]) }, () =>
          client().pdsaCycle.create({ data }),
        ),
      ).resolves.toBeTruthy();
    });
  });

  describe("system tables", () => {
    it("never asks for acknowledgement on an audit write, but still blocks identifiers", async () => {
      await expect(
        asUser(() =>
          client().usageEvent.create({ data: { kind: "ask_query", metadata: { note: "on 14 March 2025" } } }),
        ),
      ).resolves.toBeTruthy();
      await expect(
        asUser(() => client().usageEvent.create({ data: { kind: "ask_query", metadata: { note: "SSN 123-45-6789" } } })),
      ).rejects.toBeInstanceOf(PhiBlockedError);
      await base!.usageEvent.deleteMany({ where: { kind: "ask_query", userId: null } });
    });
  });

  it("is present on the application's own client", async () => {
    const appDb = createDb();
    try {
      await expect(
        appDb.project.update({
          where: { id: projectId },
          data: { obstacleNotes: "Reach them on 555-867-5309" },
        }),
      ).rejects.toBeInstanceOf(PhiBlockedError);
    } finally {
      await appDb.$disconnect();
    }
  });
});
