import { audit } from "@/lib/audit";
import { isClerDomain } from "@/lib/cler";
import { db } from "@/lib/db";
import type { ClerDomain, PulseQuestion, PulseQuestionKind, User } from "@/lib/generated/prisma/client";
import { PulsePermissionError, PulseNotFoundError, PulseRuleError } from "./errors";
import { CUSTOM_KINDS, DEFAULT_INSTRUMENT, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "./instrument";
import { isQuarter } from "./quarter";
import { newReceipt, receiptHash } from "./receipts";

/**
 * The quarterly survey (§6.4).
 *
 * A survey is composed while it is a draft, answered while it is open, and
 * read once it is closed. Questions are frozen when it opens: a question
 * reworded after people have answered it would change what their answers
 * meant. Only one survey is open at a time (a partial unique index).
 */

export const MAX_TEXT = 2_000;

function requireChair(user: User): void {
  if (user.role !== "chair") throw new PulsePermissionError("Only the chair composes and runs the pulse survey.");
}

async function draftSurvey(surveyId: string) {
  const survey = await db.pulseSurvey.findUnique({ where: { id: surveyId }, include: { questions: { orderBy: { position: "asc" } } } });
  if (!survey) throw new PulseNotFoundError("That survey could not be found.");
  if (survey.status !== "draft") {
    throw new PulseRuleError("Questions are fixed once a survey opens, so that every answer means what it meant when it was given. Change them in next quarter's survey.");
  }
  return survey;
}

async function questionInDraft(questionId: string) {
  const question = await db.pulseQuestion.findUnique({ where: { id: questionId } });
  if (!question) throw new PulseNotFoundError("That question could not be found.");
  const survey = await draftSurvey(question.surveyId);
  return { question, survey };
}

export async function openSurvey() {
  return db.pulseSurvey.findFirst({ where: { status: "open" }, include: { questions: { orderBy: { position: "asc" } } } });
}

export async function latestSurveys(take = 8) {
  return db.pulseSurvey.findMany({ orderBy: { quarter: "desc" }, take, include: { _count: { select: { responses: true, participations: true } } } });
}

/** Creates a draft for `quarter`, copying the most recent survey's questions, or the default instrument. */
export async function createSurvey(user: User, quarter: string): Promise<string> {
  requireChair(user);
  if (!isQuarter(quarter)) throw new PulseRuleError("Choose a quarter such as 2026-Q4.");
  if (await db.pulseSurvey.findUnique({ where: { quarter } })) throw new PulseRuleError(`There is already a survey for ${quarter}.`);
  const previous = await db.pulseSurvey.findFirst({ orderBy: { quarter: "desc" }, include: { questions: { orderBy: { position: "asc" } } } });
  const questions = previous?.questions.length
    ? previous.questions.map(({ kind, core, prompt, help, required, options }) => ({ kind, core, prompt, help, required, options }))
    : DEFAULT_INSTRUMENT.map((q) => ({ ...q }));
  const survey = await db.pulseSurvey.create({
    data: {
      quarter,
      intro: previous?.intro ?? null,
      questions: { create: questions.map((q, position) => ({ ...q, position })) },
    },
  });
  await audit({ userId: user.id, action: "pulse.survey_changed", entity: "PulseSurvey", entityId: survey.id, metadata: { change: "created", quarter } });
  return survey.id;
}

export interface QuestionInput {
  kind: PulseQuestionKind;
  prompt: string;
  help: string | null;
  required: boolean;
  options: string[];
}

function cleanOptions(kind: PulseQuestionKind, options: string[]): string[] {
  if (kind !== "single_choice") return [];
  const cleaned = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
  if (cleaned.length < MIN_OPTIONS || cleaned.length > MAX_OPTIONS) {
    throw new PulseRuleError(`A choice question needs between ${MIN_OPTIONS} and ${MAX_OPTIONS} different choices, one per line.`);
  }
  return cleaned;
}

function checkPrompt(prompt: string): string {
  const p = prompt.trim();
  if (p.length < 8 || p.length > 300) throw new PulseRuleError("Write the question as a sentence of up to 300 characters.");
  return p;
}

export async function addQuestion(user: User, surveyId: string, input: QuestionInput): Promise<void> {
  requireChair(user);
  const survey = await draftSurvey(surveyId);
  if (!CUSTOM_KINDS.includes(input.kind)) throw new PulseRuleError("Choose a scale, a choice or a free-text question.");
  if (survey.questions.length >= MAX_QUESTIONS) {
    throw new PulseRuleError(`A pulse survey is kept to ${MAX_QUESTIONS} questions. Response rates fall with every question added.`);
  }
  await db.pulseQuestion.create({
    data: {
      surveyId,
      position: (survey.questions.at(-1)?.position ?? -1) + 1,
      kind: input.kind,
      prompt: checkPrompt(input.prompt),
      help: input.help?.trim() || null,
      required: input.required,
      options: cleanOptions(input.kind, input.options),
    },
  });
  await audit({ userId: user.id, action: "pulse.survey_changed", entity: "PulseSurvey", entityId: surveyId, metadata: { change: "question_added" } });
}

export async function updateQuestion(user: User, questionId: string, input: Omit<QuestionInput, "kind">): Promise<void> {
  requireChair(user);
  const { question } = await questionInDraft(questionId);
  await db.pulseQuestion.update({
    where: { id: questionId },
    data: {
      prompt: checkPrompt(input.prompt),
      help: input.help?.trim() || null,
      // Confidence is the one answer every response carries.
      required: question.core === "confidence" ? true : input.required,
      options: cleanOptions(question.kind, input.options),
    },
  });
  await audit({ userId: user.id, action: "pulse.survey_changed", entity: "PulseSurvey", entityId: question.surveyId, metadata: { change: "question_updated" } });
}

export async function removeQuestion(user: User, questionId: string): Promise<void> {
  requireChair(user);
  const { question, survey } = await questionInDraft(questionId);
  if (question.core) {
    throw new PulseRuleError("The three core questions stay in every survey, so confidence, focus area and barriers can be compared from quarter to quarter. You can reword them.");
  }
  await db.$transaction([
    db.pulseQuestion.delete({ where: { id: questionId } }),
    ...survey.questions
      .filter((q) => q.id !== questionId)
      .map((q, position) => db.pulseQuestion.update({ where: { id: q.id }, data: { position } })),
  ]);
  await audit({ userId: user.id, action: "pulse.survey_changed", entity: "PulseSurvey", entityId: survey.id, metadata: { change: "question_removed" } });
}

export async function moveQuestion(user: User, questionId: string, direction: "up" | "down"): Promise<void> {
  requireChair(user);
  const { survey } = await questionInDraft(questionId);
  const order = survey.questions.map((q) => q.id);
  const i = order.indexOf(questionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  await db.$transaction(order.map((id, position) => db.pulseQuestion.update({ where: { id }, data: { position } })));
}

export async function setSurveyIntro(user: User, surveyId: string, intro: string | null): Promise<void> {
  requireChair(user);
  await draftSurvey(surveyId);
  await db.pulseSurvey.update({ where: { id: surveyId }, data: { intro: intro?.trim() || null } });
}

export async function openForResponses(user: User, surveyId: string): Promise<void> {
  requireChair(user);
  await draftSurvey(surveyId);
  const current = await db.pulseSurvey.findFirst({ where: { status: "open" }, select: { quarter: true } });
  if (current) throw new PulseRuleError(`The ${current.quarter} survey is still open. Close it first; only one survey is open at a time.`);
  await db.pulseSurvey.update({ where: { id: surveyId }, data: { status: "open", openedAt: new Date() } });
  await audit({ userId: user.id, action: "pulse.survey_changed", entity: "PulseSurvey", entityId: surveyId, metadata: { change: "opened" } });
}

export async function closeSurvey(user: User, surveyId: string): Promise<void> {
  requireChair(user);
  const survey = await db.pulseSurvey.findUnique({ where: { id: surveyId } });
  if (!survey) throw new PulseNotFoundError();
  if (survey.status !== "open") throw new PulseRuleError("Only an open survey can be closed.");
  await db.pulseSurvey.update({ where: { id: surveyId }, data: { status: "closed", closedAt: new Date() } });
  await audit({ userId: user.id, action: "pulse.survey_changed", entity: "PulseSurvey", entityId: surveyId, metadata: { change: "closed" } });
}

// ---------------------------------------------------------------- responding

export interface ResponseInput {
  /** Answers keyed by question id. Core questions are answered here too. */
  answers: Record<string, string>;
  /** "Put my name on this response so the chair can follow up." */
  identify: boolean;
  /** "Tell the committee which program I am in." */
  shareProgram: boolean;
}

interface ParsedAnswers {
  confidence: number;
  clerDomain: ClerDomain | null;
  barrierText: string | null;
  custom: Array<{ questionId: string; text: string | null; number: number | null }>;
}

/** Validates answers against the survey's questions. Throws with a message naming the question. */
export function parseAnswers(questions: readonly PulseQuestion[], raw: Record<string, string>): ParsedAnswers {
  const parsed: ParsedAnswers = { confidence: 0, clerDomain: null, barrierText: null, custom: [] };
  for (const q of questions) {
    const value = (raw[q.id] ?? "").trim();
    const name = `“${q.prompt}”`;
    if (!value) {
      if (q.required) throw new PulseRuleError(`${name} needs an answer.`);
      continue;
    }
    switch (q.kind) {
      case "scale": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 5) throw new PulseRuleError(`${name} takes a number from 1 to 5.`);
        if (q.core === "confidence") parsed.confidence = n;
        else parsed.custom.push({ questionId: q.id, text: null, number: n });
        break;
      }
      case "cler_domain":
        if (!isClerDomain(value)) throw new PulseRuleError(`Choose one of the listed focus areas for ${name}.`);
        parsed.clerDomain = value;
        break;
      case "single_choice":
        if (!q.options.includes(value)) throw new PulseRuleError(`Choose one of the listed answers for ${name}.`);
        parsed.custom.push({ questionId: q.id, text: value, number: null });
        break;
      case "free_text":
        if (value.length > MAX_TEXT) throw new PulseRuleError(`Keep ${name} to ${MAX_TEXT} characters.`);
        if (q.core === "barrier") parsed.barrierText = value;
        else parsed.custom.push({ questionId: q.id, text: value, number: null });
        break;
    }
  }
  if (!parsed.confidence) throw new PulseRuleError("The confidence question needs an answer.");
  return parsed;
}

/**
 * Records a response. Returns the receipt token for the respondent's browser.
 *
 * Participation and response are written in one transaction, so a response
 * the PHI guard refuses leaves no participation behind, and a second
 * response in the same quarter is refused by the participation's key.
 */
export async function submitResponse(user: User, surveyId: string, input: ResponseInput): Promise<string> {
  if (user.role !== "trainee") {
    throw new PulsePermissionError("The pulse survey is for residents and fellows. Committee members can preview it but not respond.");
  }
  const survey = await db.pulseSurvey.findUnique({ where: { id: surveyId }, include: { questions: { orderBy: { position: "asc" } } } });
  if (!survey) throw new PulseNotFoundError("That survey could not be found.");
  if (survey.status !== "open") throw new PulseRuleError("This survey is not open for responses.");
  const parsed = parseAnswers(survey.questions, input.answers);

  const receipt = newReceipt();
  try {
    await db.$transaction(async (tx) => {
      await tx.pulseParticipation.create({ data: { surveyId, userId: user.id } });
      await tx.pulseResponse.create({
        data: {
          surveyId,
          quarter: survey.quarter,
          confidence: parsed.confidence,
          clerDomain: parsed.clerDomain,
          barrierText: parsed.barrierText,
          respondentName: input.identify ? user.name : null,
          respondentUserId: input.identify ? user.id : null,
          programId: input.shareProgram ? user.programId : null,
          receiptHash: receiptHash(receipt, user.id),
          answers: { create: parsed.custom },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new PulseRuleError(`You have already responded to the ${survey.quarter} survey. Thank you — there is one response per person each quarter.`);
    }
    throw error;
  }
  // Who responded, not which response: the same fact as the participation row.
  await audit({ userId: user.id, action: "pulse.response_submitted", entity: "PulseSurvey", entityId: surveyId });
  return receipt;
}

export async function hasResponded(userId: string, surveyId: string): Promise<boolean> {
  return !!(await db.pulseParticipation.findUnique({ where: { surveyId_userId: { surveyId, userId } } }));
}

/**
 * "My responses": the quarters a person responded to, and the responses they
 * can see again — those they put their name to, and anonymous ones whose
 * receipt is in this browser.
 */
export async function myResponses(user: User, receipts: readonly string[]) {
  const hashes = receipts.map((t) => receiptHash(t, user.id));
  const [participations, responses] = await Promise.all([
    db.pulseParticipation.findMany({ where: { userId: user.id }, select: { survey: { select: { id: true, quarter: true, status: true } } } }),
    db.pulseResponse.findMany({
      where: { OR: [{ respondentUserId: user.id }, ...(hashes.length ? [{ receiptHash: { in: hashes } }] : [])] },
      orderBy: { quarter: "desc" },
      select: {
        id: true,
        surveyId: true,
        quarter: true,
        confidence: true,
        clerDomain: true,
        barrierText: true,
        respondentUserId: true,
        submittedOn: true,
        answers: { select: { text: true, number: true, question: { select: { prompt: true, position: true } } } },
        barriers: { select: { id: true, themeLabel: true, status: true, whatChanged: true } },
      },
    }),
  ]);
  return {
    quarters: participations.map((p) => p.survey).sort((a, b) => b.quarter.localeCompare(a.quarter)),
    responses: responses.map((r) => ({ ...r, identified: r.respondentUserId === user.id })),
  };
}
