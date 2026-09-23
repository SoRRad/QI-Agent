import type { ClerDomain } from "@/lib/generated/prisma/client";

/** The six ACGME CLER focus areas, in the order the ACGME lists them. */
export const CLER_OPTIONS: ReadonlyArray<readonly [ClerDomain, string]> = [
  ["patient_safety", "Patient safety"],
  ["health_care_quality", "Health care quality"],
  ["care_transitions", "Care transitions"],
  ["supervision", "Supervision"],
  ["well_being", "Well-being"],
  ["professionalism", "Professionalism"],
];

export const CLER_LABEL: Record<ClerDomain, string> = Object.fromEntries(CLER_OPTIONS) as Record<ClerDomain, string>;

export function isClerDomain(value: string): value is ClerDomain {
  return value in CLER_LABEL;
}
