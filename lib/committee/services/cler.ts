import { audit } from "@/lib/audit";
import { CLER_OPTIONS } from "@/lib/cler";
import { db } from "@/lib/db";
import type { ClerRating, User } from "@/lib/generated/prisma/client";
import type { LlmDependencies } from "@/lib/llm";
import { clerQuestionsPrompt } from "@/lib/llm/prompts";
import { runPrompt } from "@/lib/llm/run";
import { quarterOf } from "@/lib/pulse/quarter";
import { clerGaps } from "../cler";
import { CommitteeNotFoundError, CommitteeRuleError, requireChair, requireCommittee } from "./access";

/**
 * The CLER mock walkaround (§6.6). The chair sets one up and the questions
 * are drafted; any committee member interviewing records what was said, by
 * the respondent's role and never their name, and rates how well it was
 * answered. The gap reading is counted from those ratings.
 */

export const RATINGS: readonly ClerRating[] = ["clear", "partial", "unable"];

export async function createClerMock(user: User, input: { title: string; date: string; setting: string }, deps: LlmDependencies = {}): Promise<string> {
  requireChair(user, "Setting up a mock walkaround");
  const title = input.title.trim();
  const setting = input.setting.trim();
  if (title.length < 4 || title.length > 140) throw new CommitteeRuleError("Give the walkaround a title of 4 to 140 characters.");
  if (setting.length < 3 || setting.length > 120) throw new CommitteeRuleError('Say where the walkaround happens, e.g. "medicine wards".');
  const date = new Date(`${input.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(date.getTime())) throw new CommitteeRuleError("Give the walkaround's date.");

  const { questions } = await runPrompt(clerQuestionsPrompt, { setting, audience: "residents and fellows" }, { userId: user.id }, deps);
  // Grouped in the ACGME's order, so interviewers work through one area at a time.
  const order = CLER_OPTIONS.map(([d]) => d);
  const sorted = [...questions].sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain));

  const event = await db.event.create({
    data: {
      title,
      type: "cler_mock",
      date,
      quarter: quarterOf(date),
      agenda: `Walkaround setting: ${setting}.`,
      clerQuestions: {
        create: sorted.map((q, position) => ({
          position,
          domain: q.domain,
          question: q.question,
        })),
      },
    },
    select: { id: true },
  });
  await audit({
    userId: user.id,
    action: "cler.mock_created",
    entity: "Event",
    entityId: event.id,
    metadata: { questions: sorted.length },
  });
  return event.id;
}

export async function clerMock(user: User, eventId: string) {
  requireCommittee(user);
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      type: true,
      date: true,
      agenda: true,
      clerQuestions: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          domain: true,
          question: true,
          respondent: true,
          response: true,
          rating: true,
          notes: true,
          updatedAt: true,
          recordedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!event || event.type !== "cler_mock") throw new CommitteeNotFoundError("That mock walkaround");
  return { event, gaps: clerGaps(event.clerQuestions) };
}

export async function listClerMocks(user: User) {
  requireCommittee(user);
  const events = await db.event.findMany({
    where: { type: "cler_mock" },
    orderBy: { date: "desc" },
    select: {
      id: true,
      title: true,
      date: true,
      clerQuestions: { select: { domain: true, rating: true } },
    },
  });
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    date: e.date,
    asked: e.clerQuestions.length,
    gaps: clerGaps(e.clerQuestions).filter((g) => g.reading === "gap").length,
  }));
}

export async function recordClerResponse(
  user: User,
  questionId: string,
  input: {
    respondent: string;
    response: string;
    rating: string;
    notes: string;
  },
): Promise<void> {
  requireCommittee(user);
  const q = await db.clerQuestion.findUnique({
    where: { id: questionId },
    select: { id: true, eventId: true },
  });
  if (!q) throw new CommitteeNotFoundError("That question");
  const respondent = input.respondent.trim();
  const response = input.response.trim();
  if (respondent.length < 3 || respondent.length > 60) throw new CommitteeRuleError('Record who answered by role, e.g. "PGY-2 resident" — never by name.');
  if (response.length < 3 || response.length > 1500) throw new CommitteeRuleError("Record the answer in a sentence or two.");
  if (!RATINGS.includes(input.rating as ClerRating)) throw new CommitteeRuleError("Rate how well the question was answered.");
  await db.clerQuestion.update({
    where: { id: questionId },
    data: {
      respondent,
      response,
      rating: input.rating as ClerRating,
      notes: input.notes.trim() || null,
      recordedById: user.id,
    },
  });
  await audit({
    userId: user.id,
    action: "cler.response_recorded",
    entity: "ClerQuestion",
    entityId: questionId,
    metadata: { eventId: q.eventId, rating: input.rating },
  });
}
