/**
 * "Paraphrased summaries, never quotes" (§6.4), as a check a machine can make.
 *
 * A theme is read across programs; the responses behind it are chair-only
 * (Q4). If a summary carried a respondent's exact words, anyone who knew how
 * a colleague writes could recognise them. So no run of VERBATIM_WORDS or more
 * consecutive words from any response may appear in a theme's label or
 * summary — whoever wrote it, model or chair.
 *
 * Six words: long enough that ordinary phrases shared by chance ("the data
 * request took so") are rare, short enough to catch a quoted clause.
 */

export const VERBATIM_WORDS = 6;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The first run of at least `n` consecutive words of `text` that also appears in `source`. */
export function sharedRun(text: string, source: string, n = VERBATIM_WORDS): string | null {
  const s = words(source);
  if (s.length < n) return null;
  const grams = new Set<string>();
  for (let i = 0; i + n <= s.length; i += 1) grams.add(s.slice(i, i + n).join(" "));
  const t = words(text);
  for (let i = 0; i + n <= t.length; i += 1) {
    const gram = t.slice(i, i + n).join(" ");
    if (grams.has(gram)) return gram;
  }
  return null;
}

export interface VerbatimHit {
  text: string;
  sourceIndex: number;
  run: string;
}

/** Checks every output text against every source; returns the first hit, or null. */
export function findVerbatim(texts: readonly string[], sources: readonly string[], n = VERBATIM_WORDS): VerbatimHit | null {
  for (const text of texts) {
    for (const [sourceIndex, source] of sources.entries()) {
      const run = sharedRun(text, source, n);
      if (run) return { text, sourceIndex, run };
    }
  }
  return null;
}
