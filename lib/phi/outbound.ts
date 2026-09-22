import { currentContext } from "@/lib/request-context";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "./errors";
import { scanWriteData, toAuditFlag, type FieldFlag } from "./guard";

/**
 * The PHI guard for text leaving the system to a language model.
 *
 * The database guard stops identifiers being STORED. An external model
 * endpoint is not a safer destination, so free text a user writes is scanned
 * the same way before it is sent — same rules, same tiers, same errors, same
 * acknowledgement flow.
 *
 * Text is scanned AS the record it may later become (`as.model`,
 * `as.field`). When an unanswerable Ask question is then logged as a
 * knowledge gap, the storage write produces identical fingerprints, so the one
 * acknowledgement the user gave covers both the model call and the stored
 * copy of the same words. It cannot cover different words: fingerprints change
 * with the text.
 */

export interface OutboundAudit {
  (entry: {
    userId: string | null;
    action: "phi.block" | "phi.warn_acknowledged";
    entity: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

const defaultAudit: OutboundAudit = async (entry) => {
  const { audit } = await import("@/lib/audit");
  await audit({ ...entry, entityId: null });
};

export async function guardOutbound(
  feature: string,
  as: { model: string; field: string },
  text: string,
  deps: { audit?: OutboundAudit } = {},
): Promise<void> {
  const writeAudit = deps.audit ?? defaultAudit;
  const flags: FieldFlag[] = scanWriteData(as.model, { [as.field]: text });
  if (flags.length === 0) return;

  const context = currentContext();
  const userId = context?.userId ?? null;
  const entity = `llm.outbound:${feature}`;

  const blocks = flags.filter((f) => f.tier === "block");
  if (blocks.length > 0) {
    await writeAudit({ userId, action: "phi.block", entity, metadata: { flags: blocks.map(toAuditFlag) } });
    throw new PhiBlockedError(blocks);
  }

  const acknowledged = context?.acknowledgedPhi ?? new Set<string>();
  if (flags.some((f) => !acknowledged.has(f.fingerprint))) {
    throw new PhiAcknowledgementRequiredError(flags);
  }

  await writeAudit({ userId, action: "phi.warn_acknowledged", entity, metadata: { flags: flags.map(toAuditFlag) } });
}
