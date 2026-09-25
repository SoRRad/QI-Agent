import { isCommitteeRole, type User } from "@/lib/auth";

/**
 * Committee access. The destination is the chair's and the coaches'; within
 * it, what changes records (events, judge assignments, curriculum imports,
 * coach assignment) is the chair's alone. A coach judges only their own
 * assignments and drafts milestones only for projects they coach.
 */

export class CommitteeAccessError extends Error {
  constructor(message = "This is restricted to coaches and the chair.") {
    super(message);
    this.name = "CommitteeAccessError";
  }
}

export class CommitteeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitteeRuleError";
  }
}

export class CommitteeNotFoundError extends Error {
  constructor(what = "That record") {
    super(`${what} does not exist.`);
    this.name = "CommitteeNotFoundError";
  }
}

export function requireCommittee(user: User): void {
  if (!isCommitteeRole(user.role)) throw new CommitteeAccessError();
}

export function requireChair(user: User, what = "This"): void {
  if (user.role !== "chair") throw new CommitteeAccessError(`${what} is the chair's to change.`);
}
