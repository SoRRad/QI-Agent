/**
 * Append-only audit logging.
 *
 * The table rejects UPDATE and DELETE at the database level (migration
 * `hard_guarantees`), so this module only ever inserts.
 *
 * Two rules about what goes in:
 *  1. Never a prompt body, and never model output.
 *  2. Never text that tripped a PHI block — only that a block occurred, the
 *     flag types, and the user (Q5).
 */

import { db } from "@/lib/db";

export type AuditAction =
  | "auth.session_start"
  | "llm.call"
  | "phi.block"
  | "phi.warn_acknowledged"
  | "library.doc_created"
  | "library.doc_updated"
  | "project.submitted"
  | "project.status_changed"
  | "project.stalled"
  | "aim.version_created"
  | "measure.definition_created"
  | "measure.promoted"
  | "measure.deprecated"
  | "measure.definition_confirmed"
  | "datapoint.created"
  | "datapoint.deleted"
  | "annotation.created"
  | "pdsa.completed"
  | "handoff.generated"
  | "handoff.accepted"
  | "mail.sent"
  | "mail.logged"
  | "pulse.response_submitted"
  | "pulse.survey_changed"
  | "pulse.digest_published"
  | "barrier.created"
  | "barrier.updated"
  | "barrier.status_changed"
  | "scholarship.abstract_saved"
  | "scholarship.precheck_run"
  | "event.created"
  | "event.kit_generated"
  | "event.after_action_saved"
  | "judging.assigned"
  | "judging.unassigned"
  | "judging.scored"
  | "curriculum.imported"
  | "milestone.drafted"
  | "milestone.reviewed"
  | "cler.mock_created"
  | "cler.response_recorded"
  | "coach.assigned"
  | "export.generated"
  | "job.run";

export interface AuditEntry {
  userId?: string | null;
  action: AuditAction;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      metadata: (entry.metadata ?? undefined) as never,
    },
  });
}

/**
 * Records an LLM call. Token counts and latency only — no prompt bodies, per
 * the brief.
 */
export async function auditLlmCall(args: {
  userId?: string | null;
  feature: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  ok: boolean;
}): Promise<void> {
  await audit({
    userId: args.userId ?? null,
    action: "llm.call",
    entity: "llm",
    entityId: args.feature,
    metadata: {
      feature: args.feature,
      provider: args.provider,
      model: args.model,
      inputTokens: args.inputTokens ?? null,
      outputTokens: args.outputTokens ?? null,
      latencyMs: args.latencyMs,
      ok: args.ok,
    },
  });
}
