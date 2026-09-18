import { switchDevUser } from "@/app/actions/dev-user";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { Eyebrow } from "@/components/ui/primitives";

/**
 * Renders nothing in production. In development it is a plain form with a
 * submit button, so it works without JavaScript and is keyboard navigable by
 * default rather than by effort.
 */
export async function RoleSwitcher({ current }: { current: User }) {
  if (process.env.NODE_ENV === "production") return null;

  const users = await db.user.findMany({
    where: { active: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { email: true, name: true, role: true },
  });

  return (
    <form action={switchDevUser} className="flex items-center gap-2">
      <Eyebrow className="hidden sm:inline">Dev user</Eyebrow>
      <label className="sr-only" htmlFor="dev-user-select">
        Switch development user
      </label>
      <select
        id="dev-user-select"
        name="email"
        defaultValue={current.email}
        className="min-h-9 max-w-[11rem] border border-grid bg-paper px-2 py-1 font-mono text-xs text-ink"
      >
        {users.map((u) => (
          <option key={u.email} value={u.email}>
            {u.role} — {u.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="min-h-9 border border-grid bg-paper px-2 py-1 font-mono text-xs uppercase tracking-wide text-primary hover:border-muted"
      >
        Switch
      </button>
    </form>
  );
}
