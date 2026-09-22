import { z } from "zod";
import { contentWords, firstSentence, paragraphs, plainText, quoteAppearsIn, rankDocuments, rawParagraphs } from "@/lib/ask/text";
import type { PromptDefinition } from "./types";

/**
 * Ask: answers ONLY from the institutional library (constraint 2).
 *
 * Grounding is checked in code, not requested and hoped for:
 *   - every citation must name a document that was provided, and
 *   - every citation must carry a short VERBATIM quote that is then found in
 *     that document's text.
 * A reply that cites a document it was not given, or quotes words the
 * document does not contain, is treated as ungrounded: retried once, then
 * refused. When the library does not cover a question, the model must say so
 * and name the document that should exist — never answer from general
 * knowledge.
 */

export interface AskDocument {
  id: string;
  title: string;
  isLocal: boolean;
  body: string;
}

export interface AskInput {
  question: string;
  documents: AskDocument[];
}

const schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("answered"),
    answer: z.string().min(1).max(3000),
    citations: z
      .array(
        z.object({
          documentId: z.string().min(1),
          quote: z.string().min(12).max(400),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.object({
    status: z.literal("not_covered"),
    gap: z.string().min(1).max(600),
    suggestedDocument: z.string().min(1).max(160),
  }),
]);

export type AskOutput = z.infer<typeof schema>;

export const askAnswerPrompt: PromptDefinition<AskInput, AskOutput> = {
  id: "ask.answer",
  purpose:
    "Answers a question using only the institutional library, citing and quoting the documents it relied on, or says the library does not cover it.",
  maxTokens: 4_000,
  system: [
    "You answer questions for resident physicians and faculty about quality improvement at one institution. You answer ONLY from the library documents provided in the message. You have no other source.",
    "",
    "Rules:",
    "- If the documents answer the question, answer it, and cite every document you used. For each citation give the document's id and a short quote copied EXACTLY, word for word, from that document that supports your answer.",
    "- If the documents do not answer the question, do not answer it from general knowledge, even if you know the answer. Reply with status not_covered, say briefly what the library is missing, and name the document the institution should write.",
    "- This matters most for institutional policy — IRB and QI determination, who must sign off, duty hours, approvals, deadlines. If the library does not state the policy, it is not covered.",
    "- Documents marked LOCAL PLACEHOLDER contain no policy yet; they only list what the institution must supply. You may cite one to explain that the policy has not been written, but never present its contents as policy.",
    "- Keep answers brief and practical: a few sentences, or a short list if the question asks for steps. No preamble.",
  ].join("\n"),

  render({ question, documents }) {
    const library = documents
      .map((d) =>
        [
          `<document id="${d.id}" title="${d.title.replace(/"/g, "'")}"${d.isLocal ? ' type="LOCAL PLACEHOLDER"' : ""}>`,
          d.body,
          "</document>",
        ].join("\n"),
      )
      .join("\n\n");
    return [`<library>\n${library}\n</library>`, "", `Question: ${question}`].join("\n");
  },

  schema,

  refine(output, input) {
    if (output.status !== "answered") return null;
    const byId = new Map(input.documents.map((d) => [d.id, d]));
    for (const citation of output.citations) {
      const document = byId.get(citation.documentId);
      if (!document) {
        return `it cited a document id that was not provided (${citation.documentId}). Cite only the documents given.`;
      }
      if (!quoteAppearsIn(citation.quote, document.body)) {
        return `a citation's quote does not appear in "${document.title}". Quotes must be copied exactly from the cited document.`;
      }
    }
    return null;
  },

  /**
   * Deterministic stand-in: keyword retrieval over the same documents. It
   * answers by quoting the best-matching paragraph, reports a local
   * placeholder as unwritten policy, and reports anything else as not
   * covered — the same three outcomes the real model must produce.
   */
  mock({ question, documents }) {
    const wanted = new Set(contentWords(question));
    const best = rankDocuments(question, documents)[0];

    // Two distinct matching words, weighted by rarity. Below that the library
    // does not cover the question, and the mock says so — exactly what the
    // real model must do rather than answer from general knowledge.
    if (!best || best.hits.length < 2 || best.score < 2) {
      const topic = [...wanted].slice(0, 4).join(" ") || "this topic";
      return {
        status: "not_covered",
        gap: "The library does not contain guidance that answers this question.",
        suggestedDocument: `Local guidance on ${topic}`,
      };
    }

    const { document } = best;
    // Raw blocks keep their markdown, so a numbered list in the source is
    // still a list in the answer.
    const all = rawParagraphs(document.body);
    const ranked = all
      .map((text, index) => ({ text, index, hits: contentWords(text).filter((w) => wanted.has(w)).length }))
      .sort((a, b) => b.hits - a.hits || a.index - b.index);
    const top = ranked[0];
    const paragraph = top?.text ?? all[0] ?? document.body;
    const quote = firstSentence(plainText(paragraph));
    // A short lead-in paragraph ("Every aim statement must contain all five.")
    // usually introduces the content that answers the question, so include
    // the paragraph that follows it.
    const next = top && plainText(paragraph).length < 220 ? all[top.index + 1] : undefined;
    const answerText = next ? `${paragraph}\n\n${next}` : paragraph;

    if (document.isLocal) {
      return {
        status: "answered",
        answer: `This is a matter of local policy, and the institution has not yet supplied it. The library holds only a placeholder for "${document.title}", which lists what the institution must provide. Until it is written, ask the committee chair.`,
        citations: [{ documentId: document.id, quote: firstSentence(paragraphs(document.body)[0] ?? paragraph) }],
      };
    }

    return {
      status: "answered",
      answer: answerText,
      citations: [{ documentId: document.id, quote }],
    };
  },
};
