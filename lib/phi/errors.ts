import { toPublicFlag, type FieldFlag, type PublicFlag } from "./guard";

/**
 * Thrown by the database client when a write contains block-tier PHI. The
 * write has not happened and cannot be made to happen without editing the
 * text: there is deliberately no acknowledgement path (Q5).
 */
export class PhiBlockedError extends Error {
  readonly flags: PublicFlag[];
  constructor(flags: FieldFlag[]) {
    super(
      `Write refused: ${flags.length} item${flags.length === 1 ? "" : "s"} that look like patient identifiers. Edit the text to remove ${flags.length === 1 ? "it" : "them"}.`,
    );
    this.name = "PhiBlockedError";
    this.flags = flags.map(toPublicFlag);
  }
}

/**
 * Thrown when a write contains warn-tier flags the user has not acknowledged.
 * The flags carry fingerprints; resubmitting with those fingerprints
 * acknowledged lets the write proceed and records the acknowledgement.
 */
export class PhiAcknowledgementRequiredError extends Error {
  readonly flags: PublicFlag[];
  constructor(flags: FieldFlag[]) {
    super(
      `Please confirm: ${flags.length} item${flags.length === 1 ? "" : "s"} could identify a patient. Edit the text, or confirm that nothing identifying is present.`,
    );
    this.name = "PhiAcknowledgementRequiredError";
    this.flags = flags.map(toPublicFlag);
  }
}

export function isPhiError(error: unknown): error is PhiBlockedError | PhiAcknowledgementRequiredError {
  return error instanceof PhiBlockedError || error instanceof PhiAcknowledgementRequiredError;
}
