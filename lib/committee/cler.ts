import type { ClerDomain, ClerRating } from "@/lib/generated/prisma/client";
import { CLER_OPTIONS } from "@/lib/cler";

/**
 * The CLER mock walkaround (§6.6): a question bank for the demo path, and the
 * gap reading once responses are recorded.
 *
 * The reading is counted here, per focus area, from the interviewer's own
 * ratings. It is not a model's judgement of the answers: the person who heard
 * the answer rated it, and the page shows the counts behind each reading.
 */

export const RATING_LABEL: Record<ClerRating, string> = {
  clear: "Answered clearly",
  partial: "Partly answered",
  unable: "Could not answer",
};

/**
 * Interviewer-style questions, two per focus area. The mock provider draws on
 * these; a real provider writes its own, and they are checked the same way.
 */
export const QUESTION_BANK: Record<ClerDomain, readonly string[]> = {
  patient_safety: [
    "If you saw a near miss on this unit tonight, how would you report it, and what would happen next?",
    "Tell me about a patient safety event review you have taken part in. What changed afterwards?",
  ],
  health_care_quality: [
    "Which quality improvement project on this service are you part of, and what is it measuring?",
    "Where would you find data on how your own patients are doing on a quality measure?",
  ],
  care_transitions: [
    "How do you hand over a patient who is waiting for a test result overnight?",
    "When a patient is discharged, how do you make sure the next clinician knows what is pending?",
  ],
  supervision: [
    "When would you call your attending overnight without waiting for the morning?",
    "How do you know what you are allowed to do on your own at your stage of training?",
  ],
  well_being: ["What would you do if a colleague seemed too exhausted to work safely?", "Where would you go if you were struggling, and would you feel able to go there?"],
  professionalism: [
    "Where would you raise a concern about unprofessional behaviour by a senior colleague?",
    "Have you ever felt pressure to document something you had not done? What did you do?",
  ],
};

export interface RecordedQuestion {
  domain: ClerDomain;
  rating: ClerRating | null;
}

export type DomainReading = "gap" | "partial" | "clear" | "unanswered" | "not_asked";

export const READING_LABEL: Record<DomainReading, string> = {
  gap: "Gap",
  partial: "Partial",
  clear: "Clear",
  unanswered: "Not yet answered",
  not_asked: "Not asked",
};

export interface DomainGap {
  domain: ClerDomain;
  label: string;
  asked: number;
  answered: number;
  counts: Record<ClerRating, number>;
  reading: DomainReading;
}

/**
 * One row per focus area, in the ACGME's order. A focus area reads as a gap
 * when any answer was rated "could not answer": in a real visit one resident
 * who cannot say how to reach their attending is the finding.
 */
export function clerGaps(questions: readonly RecordedQuestion[]): DomainGap[] {
  return CLER_OPTIONS.map(([domain, label]) => {
    const inDomain = questions.filter((q) => q.domain === domain);
    const counts: Record<ClerRating, number> = {
      clear: 0,
      partial: 0,
      unable: 0,
    };
    for (const q of inDomain) if (q.rating) counts[q.rating] += 1;
    const answered = counts.clear + counts.partial + counts.unable;
    const reading: DomainReading = inDomain.length === 0 ? "not_asked" : counts.unable > 0 ? "gap" : counts.partial > 0 ? "partial" : answered === 0 ? "unanswered" : "clear";
    return { domain, label, asked: inDomain.length, answered, counts, reading };
  });
}
