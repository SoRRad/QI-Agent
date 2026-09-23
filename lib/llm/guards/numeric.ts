/**
 * The numeric guard — enforcement of the first non-negotiable constraint.
 *
 * "The model may interpret a chart; it may never produce a number that
 * appears in one." And from the list of things not to do: do not let the LLM
 * compute, round, or RESTATE a number that appears in a chart.
 *
 * So the rule here is stricter than "numbers must match the analysis": the
 * model may not write a number at all. It refers to values through
 * placeholders — {{centre_line}}, {{v0_points}} — and TypeScript substitutes
 * the formatted value afterwards. The numbers in the narration are then the
 * same objects as the numbers on the chart, by construction. There is nothing
 * to compare, because there is nothing the model could have got wrong.
 *
 * Anything that could carry a digit — a period label like "Oct 2025", a
 * measure name like "signed >48h", an annotation like "Cycle 2" — is a
 * placeholder too, so an honest model never needs to type a digit.
 */

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/**
 * Cardinal numbers, multipliers and percent in words. "One" is deliberately
 * absent — "on one side of the median" is ordinary English, not a statistic —
 * and so are ordinals ("the first point").
 */
const NUMBER_WORDS =
  /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|percent|per\s+cent|dozens?|twice|thrice|doubled?|tripled?|quadrupled?|halved)\b/i;

/** Returns why the text is unacceptable, or null if it passes. */
export function numericGuard(text: string, allowedKeys: ReadonlySet<string>): string | null {
  const unknown = [...text.matchAll(PLACEHOLDER)]
    .map((m) => m[1] ?? "")
    .filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    return `it used placeholders that do not exist: ${[...new Set(unknown)].map((k) => `{{${k}}}`).join(", ")}. Use only the placeholders provided.`;
  }

  const withoutPlaceholders = text.replace(PLACEHOLDER, "");

  const digit = /\d/.exec(withoutPlaceholders);
  if (digit) {
    return "it contained a number written in digits. Never write a number; refer to values only through the placeholders provided.";
  }

  const word = NUMBER_WORDS.exec(withoutPlaceholders);
  if (word) {
    return `it contained a number written as a word ("${word[0]}"). Never write a number; refer to values only through the placeholders provided.`;
  }

  return null;
}

/** Substitutes computed values into guarded text. */
export function renderPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_match, key: string) => values[key] ?? `{{${key}}}`);
}
