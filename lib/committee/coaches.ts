import type { ClerDomain } from "@/lib/generated/prisma/client";
import { CLER_LABEL } from "@/lib/cler";

/**
 * Coach matching (§6.6): suggestions for a project, from declared expertise
 * and current load. A pure function, so the reasons shown are exactly the
 * reasons used.
 *
 * The score is deliberately simple and on the page: a coach experienced in
 * the project's CLER focus area scores 3, one in the same program scores 2,
 * and each active project they already coach costs 1. The chair assigns; this
 * only orders the list.
 */

export const WEIGHTS = {
  expertise: 3,
  sameProgram: 2,
  perActiveProject: 1,
} as const;

export interface CoachCandidate {
  id: string;
  name: string;
  programId: string | null;
  program: string | null;
  expertise: readonly ClerDomain[];
  /** Active or stalled projects they coach now. */
  load: number;
}

export interface MatchTarget {
  programId: string;
  clerDomain: ClerDomain | null;
  currentCoachId: string | null;
}

export interface CoachSuggestion extends CoachCandidate {
  score: number;
  reasons: string[];
  isCurrent: boolean;
}

export function suggestCoaches(target: MatchTarget, coaches: readonly CoachCandidate[]): CoachSuggestion[] {
  return coaches
    .map((c) => {
      const reasons: string[] = [];
      let score = 0;
      if (target.clerDomain && c.expertise.includes(target.clerDomain)) {
        score += WEIGHTS.expertise;
        reasons.push(`Experienced in ${CLER_LABEL[target.clerDomain].toLowerCase()} (+${WEIGHTS.expertise})`);
      }
      if (c.programId === target.programId) {
        score += WEIGHTS.sameProgram;
        reasons.push(`Coaches in ${c.program ?? "the same program"} (+${WEIGHTS.sameProgram})`);
      }
      if (c.load > 0) {
        score -= c.load * WEIGHTS.perActiveProject;
        reasons.push(`Already coaching ${c.load} active project${c.load === 1 ? "" : "s"} (−${c.load * WEIGHTS.perActiveProject})`);
      } else {
        reasons.push("No active projects yet");
      }
      return {
        ...c,
        score,
        reasons,
        isCurrent: c.id === target.currentCoachId,
      };
    })
    .sort((a, b) => b.score - a.score || a.load - b.load || a.name.localeCompare(b.name));
}
