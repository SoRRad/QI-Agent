import { Prisma } from "@/lib/generated/prisma/client";
import { currentContext } from "@/lib/request-context";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "./errors";
import { scanWriteData, toAuditFlag, type FieldFlag, type ScanTiers } from "./guard";

/**
 * THE CHOKEPOINT.
 *
 * The PHI guard runs inside the database client, as a Prisma query extension
 * on every model's write operations. A route cannot forget to call it, because
 * a route has no other way to reach the database: nothing outside lib/db.ts is
 * allowed to construct a client, which tests/phi/chokepoint.test.ts enforces.
 *
 *   block tier   -> audit that a block occurred (flag types, never text), then
 *                   refuse the write. No acknowledgement path.
 *   warn tier    -> refuse unless every flag's fingerprint was acknowledged in
 *                   the request context; on success, audit the acknowledgement.
 *
 * The audit writer is injected and must write through a client OUTSIDE any
 * enclosing transaction: a refused write rolls back its transaction, and the
 * record that it was refused must survive that rollback.
 */

export interface AuditEntry {
  userId: string | null;
  action: "phi.block" | "phi.warn_acknowledged";
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

export type AuditWriter = (entry: AuditEntry) => Promise<void>;

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

/**
 * System tables written only by lib/audit and lib/usage, from content that
 * has already passed the guard. Warn tier is skipped here — an audit write
 * must never stop to ask for acknowledgement — but block tier still applies,
 * so no code path can smuggle an identifier into the audit log either.
 */
const SYSTEM_MODELS = new Set(["AuditLog", "UsageEvent"]);

/**
 * Models whose rows are anonymous by design (ADR-0012). Acknowledging a
 * warning on one is still audited with the user and the rule types (Q5), but
 * never with the row's id or the flag's position: either would let someone
 * holding the response text match the audit row, and so the person, to it.
 */
export const ANONYMOUS_MODELS = new Set(["PulseResponse", "PulseAnswer"]);

function acknowledgementFlags(model: string, flags: FieldFlag[]): Array<Record<string, string | number>> {
  if (!ANONYMOUS_MODELS.has(model)) return flags.map(toAuditFlag);
  return flags.map((f) => ({ rule: f.rule, tier: f.tier, category: f.category, model: f.model }));
}

function writePayloads(operation: string, args: Record<string, unknown>): unknown[] {
  if (operation === "upsert") return [args["create"], args["update"]];
  return [args["data"]];
}

export function phiExtension(writeAudit: AuditWriter) {
  return Prisma.defineExtension({
    name: "phi-guard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!WRITE_OPERATIONS.has(operation)) return query(args);

          const tiers: ScanTiers = SYSTEM_MODELS.has(model) ? "block_only" : "all";
          const flags: FieldFlag[] = writePayloads(operation, args as Record<string, unknown>).flatMap(
            (payload) => scanWriteData(model, payload, tiers),
          );
          if (flags.length === 0) return query(args);

          const context = currentContext();
          const userId = context?.userId ?? null;

          const blocks = flags.filter((f) => f.tier === "block");
          if (blocks.length > 0) {
            await writeAudit({
              userId,
              action: "phi.block",
              entity: model,
              entityId: null,
              metadata: { operation, flags: blocks.map(toAuditFlag) },
            });
            throw new PhiBlockedError(blocks);
          }

          const warns = flags.filter((f) => f.tier === "warn");
          const trusted = context?.trustedContent;
          if (!trusted) {
            const acknowledged = context?.acknowledgedPhi ?? new Set<string>();
            if (warns.some((f) => !acknowledged.has(f.fingerprint))) {
              throw new PhiAcknowledgementRequiredError(warns);
            }
          }

          const result = await query(args);

          // A trusted seed run is not a person acknowledging anything, so it is
          // not recorded as one.
          if (!trusted) {
            const entityId =
              !ANONYMOUS_MODELS.has(model) && result && typeof result === "object" && "id" in result && typeof result.id === "string"
                ? result.id
                : null;
            await writeAudit({
              userId,
              action: "phi.warn_acknowledged",
              entity: model,
              entityId,
              metadata: { operation, flags: acknowledgementFlags(model, warns) },
            });
          }

          return result;
        },
      },
    },
  });
}
