import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { logKnowledgeGap } from "@/lib/knowledge-gaps";
import { LlmOutputError, type LlmDependencies } from "@/lib/llm";
import { renderPlaceholders } from "@/lib/llm/guards/numeric";
import { askAnswerPrompt, devilsAdvocatePrompt, tutorPrompt, type TutorTurn } from "@/lib/llm/prompts";
import type { DevilsAdvocateOutput } from "@/lib/llm/prompts";
import { runPrompt } from "@/lib/llm/run";
import { guardOutbound } from "@/lib/phi/outbound";
import { factValues, projectFacts } from "@/lib/projects/facts";
import { loadProjectRecord } from "@/lib/projects/access";
import { recordUsage } from "@/lib/usage";

/**
 * Ask, tutor mode and devil's advocate.
 *
 * Callers run these inside a request context (runWithContext) carrying the
 * user and any PHI acknowledgements, so that both the outbound scan and any
 * storage write can see them.
 */

// ---------------------------------------------------------------- ask

export interface CitationView {
  documentId: string;
  slug: string;
  title: string;
  isLocal: boolean;
  quote: string;
}

export type AskResult =
  | { kind: "answered"; answer: string; citations: CitationView[]; citesLocal: boolean }
  | { kind: "not_covered"; gap: string; suggestedDocument: string; askedBefore: boolean }
  | { kind: "unavailable"; message: string };

export async function askQuestion(user: User, question: string, deps: LlmDependencies = {}): Promise<AskResult> {
  // Scanned AS the knowledge gap row it may become, so one acknowledgement
  // covers the model call and the stored copy of the same words.
  await guardOutbound("ask.answer", { model: "KnowledgeGap", field: "question" }, question);

  const documents = await db.libraryDoc.findMany({
    orderBy: { title: "asc" },
    select: { id: true, slug: true, title: true, isLocal: true, body: true },
  });

  const actor = { id: user.id, role: user.role, programId: user.programId };
  await recordUsage("ask_query", actor);

  let output;
  try {
    output = await runPrompt(askAnswerPrompt, { question, documents }, { userId: user.id }, deps);
  } catch (error) {
    // Twice ungrounded — a citation to a document it was not given, or a
    // quote the document does not contain. That is a model failure, not
    // evidence the library lacks the answer, so no gap is logged.
    if (error instanceof LlmOutputError) {
      return {
        kind: "unavailable",
        message:
          "Ask could not produce an answer grounded in the library, so it has not answered. Nothing was answered from outside the library. Try rephrasing the question.",
      };
    }
    throw error;
  }

  if (output.status === "not_covered") {
    const gap = await logKnowledgeGap({
      question,
      gapSummary: `${output.gap} Suggested document: ${output.suggestedDocument}.`,
      askedById: user.id,
    });
    await recordUsage("knowledge_gap", actor, { entityId: gap.id });
    return {
      kind: "not_covered",
      gap: output.gap,
      suggestedDocument: output.suggestedDocument,
      askedBefore: gap.merged,
    };
  }

  const byId = new Map(documents.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const citations: CitationView[] = [];
  for (const c of output.citations) {
    const document = byId.get(c.documentId);
    if (!document || seen.has(document.id)) continue;
    seen.add(document.id);
    citations.push({ documentId: document.id, slug: document.slug, title: document.title, isLocal: document.isLocal, quote: c.quote });
  }

  const local = citations.filter((c) => c.isLocal);
  if (local.length > 0) {
    // An answer that had to lean on a placeholder is a document the
    // institution still owes. It goes in the chair's queue either way.
    const gap = await logKnowledgeGap({
      question,
      gapSummary: `The answer relied on the placeholder ${local.map((c) => `"${c.title}"`).join(" and ")}; the institution has not yet supplied this policy.`,
      askedById: user.id,
    });
    await recordUsage("knowledge_gap", actor, { entityId: gap.id });
  }

  return { kind: "answered", answer: output.answer, citations, citesLocal: local.length > 0 };
}

// ---------------------------------------------------------------- tutor

export async function tutorTurn(
  user: User,
  args: { projectId: string | null; history: TutorTurn[] },
  deps: LlmDependencies = {},
): Promise<{ question: string }> {
  // Every trainee turn is scanned, not just the newest: the history comes
  // back from the browser and is not trusted. Each turn keeps a stable path,
  // so an acknowledgement given once still matches on later turns.
  const traineeTurns = args.history.filter((t) => t.role === "trainee").map((t) => t.text);
  if (traineeTurns.length > 0) {
    await guardOutbound("ask.tutor", { model: "TutorConversation", field: "turns" }, traineeTurns.join("\n"));
  }

  let project = null;
  if (args.projectId) {
    const record = await loadProjectRecord(user, args.projectId);
    project = {
      title: record.title,
      problemStatement: record.problemStatement,
      aimText: record.aim?.text ?? null,
      aimCheck: projectFacts(record).aim,
    };
  }

  const output = await runPrompt(tutorPrompt, { project, history: args.history }, { userId: user.id }, deps);
  await recordUsage("coach_submission", { id: user.id, role: user.role, programId: user.programId }, {
    ...(args.projectId ? { entityId: args.projectId } : {}),
  });
  return output;
}

// ---------------------------------------------------------------- devil's advocate

export async function runDevilsAdvocate(
  user: User,
  projectId: string,
  deps: LlmDependencies = {},
): Promise<DevilsAdvocateOutput> {
  const record = await loadProjectRecord(user, projectId);
  const facts = projectFacts(record);
  const output = await runPrompt(
    devilsAdvocatePrompt,
    { facts, problemStatement: record.problemStatement, aimText: record.aim?.text ?? null },
    { userId: user.id },
    deps,
  );

  // Placeholders are filled here, from the computed facts, after the numeric
  // guard has passed — the only numbers the user sees are ones TypeScript
  // computed.
  const values = factValues(facts);
  return {
    risks: output.risks.map((risk) => ({
      ...risk,
      title: renderPlaceholders(risk.title, values),
      argument: renderPlaceholders(risk.argument, values),
      mitigation: renderPlaceholders(risk.mitigation, values),
    })),
  };
}
