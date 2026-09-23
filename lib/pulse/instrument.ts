import type { PulseCoreField, PulseQuestionKind } from "@/lib/generated/prisma/client";

/**
 * The default instrument (§6.4): confidence 1–5, CLER domain and a free-text
 * barrier. Name and program are not questions: they are the respondent's
 * privacy choices, always offered, always optional, and never reworded by
 * anyone (ADR-0012).
 *
 * The three core questions cannot be removed, so confidence, domain and
 * barrier text stay comparable from one quarter to the next. The chair may
 * reword them and add questions of their own.
 */

export interface QuestionDraft {
  kind: PulseQuestionKind;
  core: PulseCoreField | null;
  prompt: string;
  help: string | null;
  required: boolean;
  options: string[];
}

export const DEFAULT_INSTRUMENT: readonly QuestionDraft[] = [
  {
    kind: "scale",
    core: "confidence",
    prompt: "How confident are you that you could lead a quality improvement project from aim to sustained change?",
    help: "1 means not at all confident; 5 means completely confident.",
    required: true,
    options: [],
  },
  {
    kind: "cler_domain",
    core: "cler_domain",
    prompt: "Which CLER focus area is your experience this quarter mostly about?",
    help: null,
    required: false,
    options: [],
  },
  {
    kind: "free_text",
    core: "barrier",
    prompt: "What got in the way of improvement work this quarter — or what helped?",
    help: "Describe the system, not a patient. Leave out names, dates and record numbers. The committee reads themes drawn from these answers, never the answers themselves.",
    required: false,
    options: [],
  },
];

export const SCALE_VALUES = [1, 2, 3, 4, 5] as const;

export const KIND_LABEL: Record<PulseQuestionKind, string> = {
  scale: "Scale, 1 to 5",
  single_choice: "One choice from a list",
  free_text: "Free text",
  cler_domain: "CLER focus area",
};

/** Kinds the chair may add. The CLER question exists once, as a core question. */
export const CUSTOM_KINDS: readonly PulseQuestionKind[] = ["scale", "single_choice", "free_text"];

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;
export const MAX_QUESTIONS = 12;
