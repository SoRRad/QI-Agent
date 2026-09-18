/**
 * Authentication seam.
 *
 * Dropping in NextAuth with a SAML or OIDC provider must replace only the body
 * of `resolveUser`. Nothing outside this file reads a cookie, a header or an
 * environment variable to decide who the user is. See docs/SSO.md for exactly
 * what the institution's identity team must supply.
 */

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { Role, User } from "@/lib/generated/prisma/client";

export type { Role, User };

export const DEV_ROLE_COOKIE = "qi_dev_user";
export const PASSCODE_COOKIE = "qi_passcode";

export class UnauthenticatedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  readonly required: readonly Role[];
  constructor(required: readonly Role[]) {
    super(`Requires role: ${required.join(" or ")}`);
    this.name = "ForbiddenError";
    this.required = required;
  }
}

export function isSsoConfigured(): boolean {
  // Flips to true when the identity team supplies the values in docs/SSO.md.
  return false;
}

export function isPasscodeMode(): boolean {
  return !isSsoConfigured() && !!process.env["APP_PASSCODE"];
}

/**
 * The one function an SSO integration replaces.
 *
 * Development: the dev role switcher cookie, else DEV_USER_EMAIL.
 * Production without SSO: the whole app sits behind APP_PASSCODE, and the
 * shared-passcode session resolves to the configured DEV_USER_EMAIL identity.
 */
async function resolveUser(): Promise<User | null> {
  const jar = await cookies();

  const switched = jar.get(DEV_ROLE_COOKIE)?.value;
  if (switched && process.env.NODE_ENV !== "production") {
    const user = await db.user.findUnique({ where: { email: switched } });
    if (user?.active) return user;
  }

  const email = process.env["DEV_USER_EMAIL"];
  if (!email) return null;

  const user = await db.user.findUnique({ where: { email } });
  return user?.active ? user : null;
}

export async function getCurrentUser(): Promise<User> {
  const user = await resolveUser();
  if (!user) {
    throw new UnauthenticatedError(
      "No user resolved. Set DEV_USER_EMAIL, or configure SSO per docs/SSO.md.",
    );
  }
  return user;
}

/** Same as getCurrentUser but returns null instead of throwing. */
export async function getCurrentUserOrNull(): Promise<User | null> {
  return resolveUser();
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new ForbiddenError(roles);
  }
  return user;
}

export function isCommitteeRole(role: Role): boolean {
  return role === "chair" || role === "coach";
}
