import { createHash } from "node:crypto";
import { scan } from "./scan";
import type { PhiCategory, PhiFlag } from "./types";

/**
 * Field-aware scanning of a Prisma write payload.
 *
 * Walks every string anywhere in the payload — top-level fields, nested
 * relation writes, `set` operations, arrays, JSON — and scans it. The default
 * is to SCAN: a field added to the schema later is covered without anyone
 * remembering to register it. Only identifiers are skipped.
 */

/**
 * Structured staff-name fields: exempt from NAME patterns only (Q7). They
 * legitimately hold names; their free-text siblings are scanned normally, and
 * block-tier identifier rules still apply to them.
 *
 * Keyed by field name, listing the models it applies to: an exemption covers
 * only those (model, field) pairs. tests/phi/guard.test.ts parses the schema
 * and fails if a listed pair no longer exists.
 */
export const NAME_EXEMPT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // Named in the approved tiering.
  clinicalOwner: ["Project"],
  sponsor: ["Project"],
  analystContact: ["Project"],
  coachContact: ["Handoff"],
  // Structured name fields by nature, added and listed in docs/SECURITY.md.
  name: ["Program", "User", "Measure"],
  pdName: ["Program"],
  respondentName: ["PulseResponse"],
  presenters: ["Submission"],
  puller: ["MeasureDefinition"],
  changeOwner: ["SustainabilityPlan"],
  reviewer: ["SustainabilityPlan"],
};

/**
 * Fields exempt from DATE patterns. The aim statement standard REQUIRES a
 * calendar deadline and a baseline period, so without this every valid aim
 * would raise a warning — and a warning that fires on every aim teaches people
 * to click through warnings. Block-tier rules, including a date of birth after
 * "DOB", still apply.
 */
export const DATE_EXEMPT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  text: ["AimStatement"],
  baselinePeriod: ["AimStatement"],
  // The handoff packet's "current state" is generated from the record and
  // quotes the current aim, deadline included. Its author did not write it,
  // so asking them to vouch for the aim's dates again would be noise.
  summary: ["Handoff"],
};

/**
 * Never scanned: identifiers, not prose. Keys ending in `Id` (foreign keys)
 * and `Hash` (hex digests, which contain long digit runs by chance) are
 * skipped too.
 */
const SKIP_FIELDS = new Set(["id", "email", "slug"]);

/** Prisma write operators: the field being written is the enclosing key. */
const OPERATOR_KEYS = new Set([
  "set",
  "push",
  "create",
  "createMany",
  "data",
  "update",
  "updateMany",
  "upsert",
  "connectOrCreate",
]);

/** Prisma filters and relation links: selectors, not written content. */
const FILTER_KEYS = new Set(["where", "connect", "disconnect", "delete", "deleteMany"]);

export interface FieldFlag extends PhiFlag {
  model: string;
  /** The leaf field the text was written to, e.g. `numerator`. */
  field: string;
  /** Dotted path within the write payload, e.g. `definitions.create.numerator`. */
  path: string;
  /**
   * Identifies this flag for acknowledgement. Derived from the flagged text
   * but never stored anywhere: it exists only in the 422 response and the
   * resubmission that acknowledges it.
   */
  fingerprint: string;
}

export type ScanTiers = "all" | "block_only";

export function scanWriteData(model: string, data: unknown, tiers: ScanTiers = "all"): FieldFlag[] {
  const flags: FieldFlag[] = [];
  walk(data, null, [], (text, field, path) => {
    const exemptCategories: PhiCategory[] = [];
    // Exemptions are per model: `text` is exempt from date patterns on an
    // aim statement, not on every model that happens to have a `text` field.
    if (NAME_EXEMPT_FIELDS[field]?.includes(model)) exemptCategories.push("name");
    if (DATE_EXEMPT_FIELDS[field]?.includes(model)) exemptCategories.push("date");

    for (const flag of scan(text, { exemptCategories })) {
      if (tiers === "block_only" && flag.tier !== "block") continue;
      flags.push({
        ...flag,
        model,
        field,
        path,
        fingerprint: fingerprint(model, path, flag, text),
      });
    }
  });
  return flags;
}

type Visit = (text: string, field: string, path: string) => void;

function walk(value: unknown, field: string | null, path: string[], visit: Visit): void {
  if (typeof value === "string") {
    if (!field || SKIP_FIELDS.has(field) || /(Id|Hash)$/.test(field)) return;
    visit(value, field, path.join("."));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, field, [...path, String(index)], visit));
    return;
  }

  if (value === null || typeof value !== "object" || value instanceof Date) return;
  // Decimal, Buffer and other non-plain objects carry no free text.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return;

  for (const [key, child] of Object.entries(value)) {
    if (FILTER_KEYS.has(key)) continue;
    const nextField = OPERATOR_KEYS.has(key) ? field : key;
    walk(child, nextField, [...path, key], visit);
  }
}

function fingerprint(model: string, path: string, flag: PhiFlag, text: string): string {
  return createHash("sha256")
    .update([model, path, flag.rule, flag.start, flag.end, text.slice(flag.start, flag.end)].join("|"))
    .digest("hex")
    .slice(0, 24);
}

/**
 * What may leave the server about a flag: everything except the fingerprint,
 * which is only returned for warn-tier flags (block-tier flags cannot be
 * acknowledged, so a fingerprint would be meaningless).
 */
export interface PublicFlag {
  rule: string;
  tier: FieldFlag["tier"];
  category: FieldFlag["category"];
  message: string;
  field: string;
  path: string;
  start: number;
  end: number;
  fingerprint?: string;
}

export function toPublicFlag(flag: FieldFlag): PublicFlag {
  const { fingerprint: fp, model: _model, ...rest } = flag;
  return flag.tier === "warn" ? { ...rest, fingerprint: fp } : rest;
}

/**
 * What is written to the audit log about a flag: the rule, where it was, and
 * nothing that could reconstruct the text (Q5). No fingerprint either — a hash
 * of a short date is trivially reversible by brute force.
 */
export function toAuditFlag(flag: FieldFlag): Record<string, string | number> {
  return {
    rule: flag.rule,
    tier: flag.tier,
    category: flag.category,
    model: flag.model,
    path: flag.path,
    start: flag.start,
    end: flag.end,
  };
}
