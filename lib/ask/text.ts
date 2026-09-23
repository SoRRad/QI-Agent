/**
 * Text helpers shared by Ask's grounding check and its mock retrieval.
 */

/** Markdown and whitespace removed, for comparing a quote to its source. */
export function normalise(text: string): string {
  return text
    .replace(/^\s*>\s?/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\W)\*(\S)/g, "$1$2")
    .replace(/(\S)\*(\W|$)/g, "$1$2")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True if `quote` appears in `source`, ignoring markdown, case and spacing. */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const q = normalise(quote).replace(/^["']|["']$/g, "").replace(/\.\.\.$|…$/, "").trim();
  return q.length > 0 && normalise(source).includes(q);
}

const STOPWORDS = new Set(
  "a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your need needs must much many make made like know get got want use used using one two way ways".split(
    " ",
  ),
);

/** Short words that carry a question in this domain: "aim", "run chart". */
const SHORT_DOMAIN_WORDS = new Set(["aim", "run"]);

/**
 * Content words: lowercased, stopwords and short words removed, crude
 * singular. Acronyms of three or more capitals (IRB, CLER, GMEC) are kept even
 * though they are short, because in this domain they are often the whole
 * point of the question.
 */
export function contentWords(text: string): string[] {
  const acronyms = (text.match(/\b[A-Z]{3,6}(?=s?\b)/g) ?? []).map((a) => a.toLowerCase());
  const words = (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [])
    .filter((w) => (w.length >= 4 || SHORT_DOMAIN_WORDS.has(w)) && !STOPWORDS.has(w))
    .map(stem);
  return [...acronyms, ...words];
}

/**
 * A deliberately light stemmer: meeting/meets/meet -> meet, voting/vote ->
 * vot, measures/measure -> measur. Never shortens a word below four letters,
 * so "rules" and "rule" both stay "rule".
 */
function stem(word: string): string {
  let w = word.replace(/'s$/, "");
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.endsWith("e") && w.length - 1 >= 4) w = w.slice(0, -1);
  return w;
}

/**
 * Keyword retrieval with inverse-document-frequency weighting: a word that
 * appears in every document ("data", "project") counts for almost nothing; a
 * rare one ("determination", "IRB") counts for a lot. Title matches count
 * double. Used only by the mock provider, so that demos route questions to
 * the right document without a model.
 */
export function rankDocuments<D extends { title: string; body: string }>(
  question: string,
  documents: readonly D[],
): Array<{ document: D; score: number; hits: string[] }> {
  const wanted = new Set(contentWords(question));
  const bodies = documents.map((d) => new Set(contentWords(`${d.title} ${d.body}`)));
  const titles = documents.map((d) => new Set(contentWords(d.title)));
  const df = (w: string) => bodies.filter((b) => b.has(w)).length;
  const idf = (w: string) => Math.log(documents.length / Math.max(1, df(w)));

  return documents
    .map((document, i) => {
      const hits = [...wanted].filter((w) => bodies[i]!.has(w));
      const score = hits.reduce((sum, w) => sum + idf(w) * (titles[i]!.has(w) ? 2 : 1), 0);
      return { document, score, hits };
    })
    .sort((a, b) => b.score - a.score);
}

/** Paragraphs of a markdown document, headings excluded, markdown stripped. */
export function paragraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^#{1,6}\s/.test(p))
    .map((p) =>
      p
        .replace(/^\s*>\s?/gm, "")
        .replace(/\*\*|`/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
}

/** Blocks of a markdown document with their markdown intact, headings excluded. */
export function rawParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^#{1,6}\s/.test(p));
}

/** A block's plain text: markdown markers removed, whitespace collapsed. */
export function plainText(block: string): string {
  return block
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of a paragraph, for use as a citation quote. */
export function firstSentence(paragraph: string): string {
  const match = /^(.{12,300}?[.!?])(?:\s|$)/.exec(paragraph);
  return (match?.[1] ?? paragraph.slice(0, 200)).trim();
}
