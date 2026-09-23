/**
 * PHI scanner types.
 *
 * A flag carries a rule, a tier, a category and CHARACTER OFFSETS. It never
 * carries the matched text. That is what lets a flag be returned to the
 * browser, written to the audit log, and discussed in a bug report without
 * the flagged content going anywhere it should not.
 */

/**
 * block — the write is refused and there is no override path. The user must
 *         edit the text. (Q5: a trainee-facing button that overrides a hard
 *         PHI control becomes the button everyone clicks.)
 * warn  — the user may acknowledge and proceed; the acknowledgement and the
 *         flag types are written to the audit log.
 */
export type PhiTier = "block" | "warn";

export type PhiCategory = "identifier" | "contact" | "date" | "location" | "name" | "other";

export interface PhiFlag {
  /** Stable rule identifier, e.g. `ssn` or `date`. */
  rule: string;
  tier: PhiTier;
  category: PhiCategory;
  /** Offsets into the scanned string: `text.slice(start, end)` is the match. */
  start: number;
  end: number;
  /** Plain language, safe to show the user. Never contains the matched text. */
  message: string;
}

export interface ScanOptions {
  /**
   * Categories this field legitimately contains and must not be flagged for.
   * Block-tier IDENTIFIER and CONTACT rules can never be exempted.
   */
  exemptCategories?: readonly PhiCategory[];
}

/** A rule as the scanner runs it: something that finds spans in text. */
export interface PhiRule {
  id: string;
  tier: PhiTier;
  category: PhiCategory;
  message: string;
  find(text: string, context: RuleContext): Array<[start: number, end: number]>;
}

export interface RuleContext {
  /** Committee-maintained words that make "patient X Y" an ordinary phrase. */
  nameContextStopWords: ReadonlySet<string>;
}
