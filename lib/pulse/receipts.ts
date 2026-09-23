import { createHash, randomBytes } from "node:crypto";

/**
 * Receipts let a respondent see an anonymous response again ("My responses")
 * without the server being able to connect it to them.
 *
 * On submit, a random token is kept in an httpOnly cookie in the
 * respondent's browser; the response stores SHA-256(token, user id). The
 * server holds only the hash, so it cannot find a person's anonymous response
 * without their browser. Binding the hash to the user id means that on a
 * shared hospital workstation, the next person to sign in does not see the
 * previous person's responses even though the cookie is still there.
 */

export const RECEIPT_COOKIE = "qi_pulse_receipts";
/** Enough for several years of quarterly surveys; the oldest drop off first. */
export const MAX_RECEIPTS = 16;

export function newReceipt(): string {
  return randomBytes(24).toString("base64url");
}

export function receiptHash(token: string, userId: string): string {
  return createHash("sha256").update(`${userId}:${token}`).digest("hex");
}

export function parseReceipts(cookie: string | undefined): string[] {
  return (cookie ?? "").split(".").filter((t) => /^[A-Za-z0-9_-]{32}$/.test(t));
}

export function addReceipt(cookie: string | undefined, token: string): string {
  return [...parseReceipts(cookie), token].slice(-MAX_RECEIPTS).join(".");
}
