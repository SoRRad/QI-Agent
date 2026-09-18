"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DEV_ROLE_COOKIE } from "@/lib/auth";

/**
 * Development-only role switcher.
 *
 * Refuses outright in production: the production story without SSO is a single
 * shared passcode (APP_PASSCODE), not a dropdown that lets anyone become the
 * chair. See docs/SSO.md.
 */
export async function switchDevUser(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The dev role switcher is disabled in production.");
  }

  const email = formData.get("email");
  if (typeof email !== "string" || !email) return;

  const jar = await cookies();
  jar.set(DEV_ROLE_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  revalidatePath("/", "layout");
}
