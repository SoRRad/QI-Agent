import { db } from "@/lib/db";
import type { ClerDomain } from "@/lib/generated/prisma/client";
import { responseRates } from "./rates";

/**
 * What the chair sees about a survey: response rate by program, the spread of
 * answers, and the answers to the chair's own questions. All counted here.
 */

export async function surveyRates(surveyId: string) {
  const [programs, trainees, participations] = await Promise.all([
    db.program.findMany({ select: { id: true, name: true } }),
    db.user.groupBy({ by: ["programId"], where: { role: "trainee", active: true }, _count: { _all: true } }),
    db.pulseParticipation.findMany({ where: { surveyId, user: { role: "trainee" } }, select: { user: { select: { programId: true } } } }),
  ]);
  const responded = new Map<string, number>();
  for (const p of participations) {
    if (p.user.programId) responded.set(p.user.programId, (responded.get(p.user.programId) ?? 0) + 1);
  }
  return responseRates(
    programs.map((program) => ({
      programId: program.id,
      program: program.name,
      trainees: trainees.find((t) => t.programId === program.id)?._count._all ?? 0,
      responded: responded.get(program.id) ?? 0,
    })),
  );
}

export interface ChoiceCount {
  value: string;
  count: number;
}

export async function surveyResults(surveyId: string) {
  const survey = await db.pulseSurvey.findUniqueOrThrow({
    where: { id: surveyId },
    include: {
      questions: { orderBy: { position: "asc" } },
      responses: { select: { confidence: true, clerDomain: true, answers: { select: { questionId: true, text: true, number: true } } } },
    },
  });
  const tally = <T extends string | number>(values: T[], order: readonly T[]): ChoiceCount[] =>
    order.map((value) => ({ value: String(value), count: values.filter((v) => v === value).length }));

  const questions = survey.questions.map((q) => {
    if (q.core === "confidence") {
      return { question: q, counts: tally(survey.responses.map((r) => r.confidence), [1, 2, 3, 4, 5]), texts: [] as string[] };
    }
    if (q.core === "cler_domain") {
      const domains = survey.responses.map((r) => r.clerDomain).filter((d): d is ClerDomain => d !== null);
      const order = [...new Set(domains)].sort();
      return { question: q, counts: tally(domains, order), texts: [] as string[] };
    }
    if (q.core === "barrier") return { question: q, counts: [], texts: [] as string[] };
    const answers = survey.responses.flatMap((r) => r.answers.filter((a) => a.questionId === q.id));
    if (q.kind === "scale") return { question: q, counts: tally(answers.map((a) => a.number ?? 0), [1, 2, 3, 4, 5]), texts: [] as string[] };
    if (q.kind === "single_choice") return { question: q, counts: tally(answers.map((a) => a.text ?? ""), q.options), texts: [] as string[] };
    return { question: q, counts: [], texts: answers.map((a) => a.text ?? "").filter(Boolean) };
  });
  return { survey, responses: survey.responses.length, questions };
}
