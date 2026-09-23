import type { BarrierStatus, EscalationTarget } from "@/lib/generated/prisma/client";

/**
 * The barrier lifecycle (§6.4): raised → at GMEC → decided → closed, with the
 * decision recorded. Pure, so the rules are tested as a specification.
 *
 * - Forward only. A closed barrier that comes back is a new barrier: its
 *   history is the record that the first fix did not hold.
 * - A barrier escalated to GMEC must go through "at GMEC". One the committee
 *   or a program can settle may go straight from raised to decided.
 * - "Decided" needs the decision in words. "Closed" needs what changed, in
 *   words a trainee can read, because that is what the digest reports.
 */

export const STATUS_ORDER: readonly BarrierStatus[] = ["raised", "at_gmec", "decided", "closed"];

export const STATUS_LABEL: Record<BarrierStatus, string> = {
  raised: "Raised",
  at_gmec: "At GMEC",
  decided: "Decided",
  closed: "Closed",
};

export const TARGET_LABEL: Record<EscalationTarget, string> = {
  committee: "QI committee",
  gmec: "GMEC",
  program: "Program",
};

export const MIN_DECISION_LENGTH = 20;

export function allowedTransitions(from: BarrierStatus, target: EscalationTarget): BarrierStatus[] {
  switch (from) {
    case "raised":
      return target === "gmec" ? ["at_gmec"] : ["at_gmec", "decided"];
    case "at_gmec":
      return ["decided"];
    case "decided":
      return ["closed"];
    case "closed":
      return [];
  }
}

export interface TransitionRequest {
  from: BarrierStatus;
  to: BarrierStatus;
  target: EscalationTarget;
  /** The decision after this transition: the one already recorded, or the new one. */
  decision: string | null;
  whatChanged: string | null;
}

const filled = (s: string | null, min: number) => !!s && s.trim().length >= min;

/** Why the transition is not allowed, or null if it is. */
export function checkTransition(req: TransitionRequest): string | null {
  if (req.from === req.to) return `The barrier is already ${STATUS_LABEL[req.to].toLowerCase()}.`;
  const allowed = allowedTransitions(req.from, req.target);
  if (!allowed.includes(req.to)) {
    if (req.from === "closed") return "A closed barrier stays closed. If the problem has come back, raise it as a new barrier, so the record shows the first fix did not hold.";
    if (STATUS_ORDER.indexOf(req.to) < STATUS_ORDER.indexOf(req.from)) return "Barriers move forward only. Record what happened in the decision instead.";
    if (req.from === "raised" && req.to === "decided") return "This barrier is escalated to GMEC, so it goes to GMEC before it is decided.";
    return `A ${STATUS_LABEL[req.from].toLowerCase()} barrier moves to ${allowed.map((s) => STATUS_LABEL[s].toLowerCase()).join(" or ")} next.`;
  }
  if ((req.to === "decided" || req.to === "closed") && !filled(req.decision, MIN_DECISION_LENGTH)) {
    return "Record the decision in a sentence: what was decided, and by whom.";
  }
  if (req.to === "closed" && !filled(req.whatChanged, MIN_DECISION_LENGTH)) {
    return "Say what changed, in words a trainee will read. This is what the “You reported, we changed” digest reports.";
  }
  return null;
}
