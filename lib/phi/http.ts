import { NextResponse } from "next/server";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "./errors";
import type { PublicFlag } from "./guard";

/**
 * The 422 contract every free-text write returns when the guard objects.
 *
 *   { error: "phi_blocked", message, flags }            -> edit the text; no override
 *   { error: "phi_acknowledgement_required", message, flags[with fingerprint] }
 *                                                       -> edit, or resubmit with
 *                                                          `acknowledgedPhi: [fingerprints]`
 *
 * Flags carry offsets so the interface can highlight the exact characters in
 * the text the user just typed. They never carry the text itself.
 */
export type PhiErrorBody =
  | { error: "phi_blocked"; message: string; flags: PublicFlag[] }
  | { error: "phi_acknowledgement_required"; message: string; flags: PublicFlag[] };

export function phiErrorBody(error: unknown): PhiErrorBody | null {
  if (error instanceof PhiBlockedError) {
    return { error: "phi_blocked", message: error.message, flags: error.flags };
  }
  if (error instanceof PhiAcknowledgementRequiredError) {
    return { error: "phi_acknowledgement_required", message: error.message, flags: error.flags };
  }
  return null;
}

/** For route handlers: a 422 for a PHI objection, or null to rethrow. */
export function phiErrorResponse(error: unknown): NextResponse<PhiErrorBody> | null {
  const body = phiErrorBody(error);
  return body ? NextResponse.json(body, { status: 422 }) : null;
}
