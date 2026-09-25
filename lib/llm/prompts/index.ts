import { askAnswerPrompt } from "./askAnswer";
import { chartInterpretationPrompt } from "./chartInterpretation";
import { clerQuestionsPrompt } from "./clerQuestions";
import { dataRequestPrompt } from "./dataRequest";
import { definitionRestatementPrompt } from "./definitionRestatement";
import { devilsAdvocatePrompt } from "./devilsAdvocate";
import { duplicateRerankPrompt } from "./duplicateRerank";
import { milestoneDraftPrompt } from "./milestoneDraft";
import { pulseDigestPrompt } from "./pulseDigest";
import { pulseThemePrompt } from "./pulseTheme";
import { tutorPrompt } from "./tutor";
import type { PromptDefinition } from "./types";

export type { PromptDefinition } from "./types";
export { chartInterpretationPrompt, interpretationValues } from "./chartInterpretation";
export type { InterpretationInput } from "./chartInterpretation";
export { askAnswerPrompt } from "./askAnswer";
export type { AskDocument, AskInput, AskOutput } from "./askAnswer";
export { tutorPrompt, looksLikeAimStatement } from "./tutor";
export type { TutorInput, TutorTurn } from "./tutor";
export { devilsAdvocatePrompt, RISK_CATEGORIES } from "./devilsAdvocate";
export { definitionRestatementPrompt, restatementSource } from "./definitionRestatement";
export type { RestatementInput, RestatementOutput } from "./definitionRestatement";
export { dataRequestPrompt, dataRequestSource } from "./dataRequest";
export type { DataRequestInput, DataRequestOutput } from "./dataRequest";
export type { DevilsAdvocateInput, DevilsAdvocateOutput } from "./devilsAdvocate";
export { duplicateRerankPrompt, rerankSource } from "./duplicateRerank";
export type { RerankCandidate, RerankInput, RerankOutput } from "./duplicateRerank";
export { pulseThemePrompt, MAX_THEMES } from "./pulseTheme";
export type { ThemeBarrier, ThemeInput, ThemeOutput, ThemeResponse } from "./pulseTheme";
export { pulseDigestPrompt, digestSource } from "./pulseDigest";
export type { DigestBarrier, DigestInput, DigestOutput } from "./pulseDigest";
export { milestoneDraftPrompt } from "./milestoneDraft";
export type { MilestoneDraftInput, MilestoneDraftOutput } from "./milestoneDraft";
export { clerQuestionsPrompt } from "./clerQuestions";
export type { ClerQuestionsInput, ClerQuestionsOutput } from "./clerQuestions";

/**
 * Every prompt in the system. docs/PROMPTS.md must have a section for each id
 * here; tests/llm/prompts.test.ts enforces it, and runs every mock through its
 * own schema and refine so the demo path is known to satisfy the real checks.
 */
export const ALL_PROMPTS: ReadonlyArray<PromptDefinition<never, unknown>> = [
  askAnswerPrompt as PromptDefinition<never, unknown>,
  tutorPrompt as PromptDefinition<never, unknown>,
  devilsAdvocatePrompt as PromptDefinition<never, unknown>,
  chartInterpretationPrompt as PromptDefinition<never, unknown>,
  definitionRestatementPrompt as PromptDefinition<never, unknown>,
  dataRequestPrompt as PromptDefinition<never, unknown>,
  duplicateRerankPrompt as PromptDefinition<never, unknown>,
  pulseThemePrompt as PromptDefinition<never, unknown>,
  pulseDigestPrompt as PromptDefinition<never, unknown>,
  milestoneDraftPrompt as PromptDefinition<never, unknown>,
  clerQuestionsPrompt as PromptDefinition<never, unknown>,
];
