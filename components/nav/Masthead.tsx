import type { Program, User } from "@/lib/generated/prisma/client";
import { Eyebrow } from "@/components/ui/primitives";
import { RoleSwitcher } from "./RoleSwitcher";

export function Masthead({
  user,
  program,
}: {
  user: User;
  program: Program | null;
}) {
  return (
    <header className="border-b border-grid bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="min-w-0">
          <p className="font-display text-lg leading-none font-bold tracking-tight text-ink">
            QI Agent
          </p>
          <Eyebrow className="mt-1 block truncate">
            {program ? `${program.specialty} · ` : ""}
            {user.role}
          </Eyebrow>
        </div>
        <RoleSwitcher current={user} />
      </div>
    </header>
  );
}
