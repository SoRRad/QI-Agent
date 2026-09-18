import type { BarrierStatus, ProjectStatus } from "@/lib/generated/prisma/client";
import { Badge } from "./primitives";

/**
 * `signal` is used only where the status genuinely demands attention — a
 * stalled project — and `confirm` only for a real pass. Status colour is
 * meaning, not decoration.
 */
const PROJECT_TONE: Record<ProjectStatus, "neutral" | "signal" | "confirm" | "primary"> = {
  draft: "neutral",
  submitted: "primary",
  approved: "primary",
  active: "primary",
  stalled: "signal",
  complete: "confirm",
  archived: "neutral",
};

export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  return <Badge tone={PROJECT_TONE[status]}>{status}</Badge>;
}

const BARRIER_TONE: Record<BarrierStatus, "neutral" | "signal" | "confirm" | "primary"> = {
  raised: "signal",
  at_gmec: "primary",
  decided: "primary",
  closed: "confirm",
};

const BARRIER_LABEL: Record<BarrierStatus, string> = {
  raised: "raised",
  at_gmec: "at GMEC",
  decided: "decided",
  closed: "closed",
};

export function BarrierStatusPill({ status }: { status: BarrierStatus }) {
  return <Badge tone={BARRIER_TONE[status]}>{BARRIER_LABEL[status]}</Badge>;
}
