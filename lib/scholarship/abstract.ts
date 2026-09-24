/**
 * The abstract formatter's arithmetic (§6.5): word counts against a venue's
 * limit. Pure, so the counter in the browser and the check on save agree.
 *
 * Counting rule, stated because venues differ and trainees get caught by it:
 * a word is a run of characters between spaces, so "34%", "p-chart", "48h"
 * and "2026" each count as one, and a dash between spaces counts as nothing.
 * Headings are not counted; the title is not counted. Where a venue counts
 * differently, its author instructions win — the page says so.
 */

export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export interface AbstractSection {
  heading: string;
  text: string;
}

export interface AbstractCount {
  sections: Array<{ heading: string; words: number }>;
  total: number;
  limit: number;
  over: number;
  /** Headings left empty. */
  empty: string[];
}

export function countAbstract(sections: readonly AbstractSection[], limit: number): AbstractCount {
  const counted = sections.map((s) => ({ heading: s.heading, words: countWords(s.text) }));
  const total = counted.reduce((n, s) => n + s.words, 0);
  return {
    sections: counted,
    total,
    limit,
    over: Math.max(0, total - limit),
    empty: counted.filter((s) => s.words === 0).map((s) => s.heading),
  };
}

/** Plain text for pasting into a submission portal: headings in bold markdown. */
export function abstractText(title: string | null, sections: readonly AbstractSection[]): string {
  const body = sections.length === 1 && sections[0]!.heading === "Abstract"
    ? [sections[0]!.text.trim()]
    : sections.map((s) => `**${s.heading}.** ${s.text.trim()}`);
  return [...(title?.trim() ? [title.trim(), ""] : []), ...body].join("\n\n");
}
