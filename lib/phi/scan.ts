import { loadPhiConfig, type LoadedConfig } from "./config";
import { BUILT_IN_RULES } from "./rules";
import type { PhiCategory, PhiFlag, PhiRule, PhiTier, ScanOptions } from "./types";

/**
 * Scans free text for protected health information.
 *
 * Returns flags with rule, tier, category and offsets — never the matched
 * text. Runs the built-in floor plus any committee extensions from
 * config/phi-patterns.json.
 *
 * This function answers "what is in this text". Whether a write proceeds is
 * decided in guard.ts, which runs inside the database client itself so that no
 * code path can write free text without passing through here.
 */
export function scan(text: string, options: ScanOptions = {}, config?: LoadedConfig): PhiFlag[] {
  if (!text) return [];

  const loaded = config ?? loadPhiConfig();
  const rules: readonly PhiRule[] = [...BUILT_IN_RULES, ...loaded.rules];
  const exempt = new Set<PhiCategory>(options.exemptCategories ?? []);
  const context = { nameContextStopWords: loaded.nameContextStopWords };

  const flags: PhiFlag[] = [];
  for (const rule of rules) {
    if (isExempt(rule, exempt)) continue;
    for (const [start, end] of rule.find(text, context)) {
      flags.push({
        rule: rule.id,
        tier: rule.tier,
        category: rule.category,
        start,
        end,
        message: rule.message,
      });
    }
  }

  return resolveOverlaps(flags);
}

/**
 * A field exemption can never switch off a block-tier identifier or contact
 * rule. An SSN in the "clinical owner" field is still an SSN.
 */
function isExempt(rule: PhiRule, exempt: ReadonlySet<PhiCategory>): boolean {
  if (!exempt.has(rule.category)) return false;
  if (rule.tier === "block" && (rule.category === "identifier" || rule.category === "contact")) {
    return false;
  }
  return true;
}

const TIER_RANK: Record<PhiTier, number> = { block: 2, warn: 1 };

/**
 * Where flags overlap, the most severe wins and anything it fully contains is
 * dropped: "MRN 00123456" is one block, not a block plus a six-to-eight-digit
 * warning about the same characters.
 */
function resolveOverlaps(flags: PhiFlag[]): PhiFlag[] {
  const ordered = [...flags].sort(
    (a, b) =>
      TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );

  const kept: PhiFlag[] = [];
  for (const flag of ordered) {
    const covered = kept.some(
      (k) =>
        k.start <= flag.start && flag.end <= k.end && TIER_RANK[k.tier] >= TIER_RANK[flag.tier],
    );
    if (!covered) kept.push(flag);
  }

  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function hasBlock(flags: readonly PhiFlag[]): boolean {
  return flags.some((f) => f.tier === "block");
}
