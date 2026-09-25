import type { ReactNode } from "react";
import { ForbiddenError, requireRole, type User } from "@/lib/auth";
import { committeeSections, SectionTabs, type CommitteeSection } from "@/components/ui/SectionTabs";
import { Banner, PageHeader } from "@/components/ui/primitives";

/**
 * The frame every committee page shares: the role check, the header and the
 * section tabs. Trainees never see the destination in the nav, and every
 * route refuses them regardless of how they arrived.
 */

export async function committeeUser(): Promise<User | null> {
  try {
    return await requireRole("chair", "coach");
  } catch (error) {
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
}

export function Restricted({ chairOnly = false }: { chairOnly?: boolean }) {
  return chairOnly ? (
    <Banner tone="signal" title="This section is the chair's">
      It holds records the sensitivity policy gives to the chair alone.
    </Banner>
  ) : (
    <Banner tone="signal" title="Committee is restricted to coaches and the chair">
      Your role does not include committee access. If that is wrong, the chair can change your role.
    </Banner>
  );
}

export function CommitteeHeader({ user, current, title, lede, action }: { user: User; current: CommitteeSection; title: string; lede?: string; action?: ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Committee" title={title} {...(lede ? { lede } : {})} {...(action ? { action } : {})} />
      <SectionTabs label="Committee sections" current={current} items={committeeSections(user.role)} />
    </>
  );
}
