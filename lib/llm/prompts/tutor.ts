import { z } from "zod";
import type { AimElement, AimValidation } from "@/lib/aim/validate";
import type { PromptDefinition } from "./types";

/**
 * Tutor mode: Socratic. Asks ONE question at a time, works from the trainee's
 * own project record when one is selected, and never writes the aim statement
 * for them — the point is that they can write the next one without help.
 *
 * Both rules are checked in code: a reply must contain exactly one question,
 * and a reply that reads like an aim statement ("Reduce X from A to B by D")
 * is rejected.
 */

export interface TutorTurn {
  role: "tutor" | "trainee";
  text: string;
}

export interface TutorInput {
  project: {
    title: string;
    problemStatement: string;
    aimText: string | null;
    aimCheck: AimValidation;
  } | null;
  history: TutorTurn[];
}

const schema = z.object({ question: z.string().min(8).max(500) });
type Output = z.infer<typeof schema>;

/** "Reduce X from A to B by D" — the shape of an aim statement. */
export function looksLikeAimStatement(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const aimShaped = sentences.some(
    (s) =>
      /\b(?:reduce|increase|decrease|raise|lower|improve|achieve|reach|cut|eliminate)\b/i.test(s) &&
      /\bfrom\b/i.test(s) &&
      /\bto\b/i.test(s) &&
      /\bby\b/i.test(s),
  );
  const offersOne =
    /\byour aim(?:\s+statement)?\s+(?:should|could|might|would|can)\s+(?:be|read|say)\b/i.test(text) ||
    /\b(?:try|consider|how about)\s*:?\s*["“]/i.test(text);
  return aimShaped || offersOne;
}

const QUESTION_FOR: Record<AimElement, string> = {
  direction_magnitude:
    "If this project worked, what would you see change — and from what value to what value?",
  baseline: "What is the value today, and over which months did you measure it?",
  population: "Whose care are you counting — which patients, on which unit or service?",
  deadline: "By what calendar date do you want to have reached it?",
  measure_definition:
    "If two people counted this separately, what exactly would each of them count, and out of what?",
};

const GENERAL_QUESTIONS = [
  "What is the smallest test you could run this week that would change your mind?",
  "Before you run it, what do you predict will happen — as a number?",
  "If this worked perfectly and someone were harmed by it, how would that harm show up?",
  "Who, other than you, has the authority to make this change stick after you rotate off?",
];

export const tutorPrompt: PromptDefinition<TutorInput, Output> = {
  id: "ask.tutor",
  purpose:
    "Coaches a trainee Socratically, one question at a time, from their own project record, without ever writing the aim statement for them.",
  maxTokens: 1_000,
  system: [
    "You are a quality improvement coach for resident physicians. You teach by asking, not telling.",
    "",
    "Rules:",
    "- Ask exactly ONE question per reply. You may put one short sentence before it; nothing after it.",
    "- Never write, draft, suggest or complete an aim statement, even partially, even if asked directly. If the trainee asks you to write it, ask the question that would let them write the next part themselves.",
    "- Work from the trainee's project record when one is given. If the aim check shows missing elements, ask about the most fundamental one first: the number that would show success, then the baseline, then who is counted, then the date, then the definition.",
    "- Build on what the trainee has just said. Do not repeat a question they have answered.",
    "- Be warm and brief. No lectures.",
  ].join("\n"),

  render({ project, history }) {
    const record = project
      ? [
          "The trainee's project record:",
          `- Title: ${project.title}`,
          `- Problem statement: ${project.problemStatement}`,
          `- Current aim statement: ${project.aimText ?? "(none written yet)"}`,
          "- Aim check:",
          ...project.aimCheck.elements.map((e) => `  - ${e.label}: ${e.met ? "present" : `MISSING — ${e.reason}`}`),
        ].join("\n")
      : "No project is selected. Coach the trainee on quality improvement method in general.";

    const transcript =
      history.length > 0
        ? history.map((t) => `${t.role === "tutor" ? "Coach" : "Trainee"}: ${t.text}`).join("\n")
        : "(This is the start of the conversation.)";

    return [record, "", "Conversation so far:", transcript, "", "Ask your next question."].join("\n");
  },

  schema,

  refine({ question }) {
    const marks = (question.match(/\?/g) ?? []).length;
    if (marks !== 1 || !question.trim().endsWith("?")) {
      return "it must contain exactly one question, ending with a question mark, and nothing after it.";
    }
    if (looksLikeAimStatement(question)) {
      return "it wrote or suggested an aim statement. Never supply the aim; ask the question that lets the trainee write it.";
    }
    return null;
  },

  mock({ project, history }) {
    const asked = history.filter((t) => t.role === "tutor").length;
    const questions = project
      ? [...project.aimCheck.missing.map((e) => QUESTION_FOR[e]), ...GENERAL_QUESTIONS]
      : GENERAL_QUESTIONS;
    const question = questions[asked % questions.length] ?? GENERAL_QUESTIONS[0] ?? "What would you change first?";
    const lead = asked === 0 && project && project.aimCheck.missing.length > 0
      ? "Let's start with the aim. "
      : "";
    return { question: `${lead}${question}` };
  },
};
