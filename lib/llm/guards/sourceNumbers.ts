/**
 * The source-numbers guard.
 *
 * Some prompts must be able to repeat a number the user wrote — "more than 48
 * hours", "potassium below 3.0" — because a restatement that drops the
 * threshold is not a restatement. What they may not do is introduce one. So
 * every number in the output must already appear in the source text the model
 * was given (the definition, the computed dates), and every number written as
 * a word must appear as that word in the source.
 */

const NUMBER = /\d+(?:[.,]\d+)*/g;

const NUMBER_WORDS =
  /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|percent|per\s+cent|dozens?|twice|doubled?|halved)\b/gi;

function numbersIn(text: string): Set<string> {
  // "1,240" and "1240" are the same number; "3.0" and "3" are not merged,
  // because a model turning "3.0" into "3" is harmless but "3" into "3.5" is not.
  return new Set([...text.matchAll(NUMBER)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, "")));
}

/** Returns why the output is unacceptable, or null if every number came from the source. */
export function sourceNumbersGuard(output: string, source: string): string | null {
  const allowed = numbersIn(source);
  const introduced = [...numbersIn(output)].filter((n) => !allowed.has(n));
  if (introduced.length > 0) {
    return `it contained numbers that are not in what you were given (${introduced.slice(0, 5).join(", ")}). Repeat only numbers that appear in the definition or the dates provided; never add one.`;
  }
  const sourceWords = new Set([...source.matchAll(NUMBER_WORDS)].map((m) => m[0].toLowerCase()));
  const words = [...output.matchAll(NUMBER_WORDS)].map((m) => m[0].toLowerCase()).filter((w) => !sourceWords.has(w));
  if (words.length > 0) {
    return `it contained a number written as a word that is not in what you were given ("${words[0]}"). Never add a number.`;
  }
  return null;
}
