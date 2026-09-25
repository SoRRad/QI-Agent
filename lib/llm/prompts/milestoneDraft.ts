import { z } from "zod";
import { LEVEL_LANGUAGE, MOCK_KINDS, type MilestoneFact, type Subcompetency } from "@/lib/committee/milestones";
import { sourceNumbersGuard } from "../guards/sourceNumbers";
import type { PromptDefinition } from "./types";

/**
 * The ACGME milestone mapper (§6.6): draft evaluation text for a program
 * director, mapping a resident's QI project to Systems-Based Practice and
 * Practice-Based Learning and Improvement subcompetencies.
 *
 * The model is given keyed facts built from the record and the subcompetency
 * list. Each paragraph it writes must cite the facts it rests on, may repeat a
 * number only from those facts, and must not assign or imply a level. The
 * output is stored as a draft requiring program director review, always.
 */

export interface MilestoneDraftInput {
  facts: MilestoneFact[];
  subcompetencies: readonly Subcompetency[];
}

const schema = z.object({
  entries: z
    .array(
      z.object({
        code: z.string().min(3).max(8),
        evidence: z.string().min(40).max(700),
        factKeys: z
          .array(z.string().regex(/^F\d+$/))
          .min(1)
          .max(8),
      }),
    )
    .min(1)
    .max(6),
});

export type MilestoneDraftOutput = z.infer<typeof schema>;

export const milestoneDraftPrompt: PromptDefinition<MilestoneDraftInput, MilestoneDraftOutput> = {
  id: "committee.milestone_draft",
  purpose:
    "Drafts evidence paragraphs mapping a resident's QI project to Systems-Based Practice and Practice-Based Learning and Improvement subcompetencies, for a program director to review, edit and rate.",
  maxTokens: 2_500,
  system: [
    "You help program directors in graduate medical education write milestone evaluations. You are given facts about a resident's quality improvement project, each with a key (F1, F2, …), and a list of ACGME subcompetencies with a short description of what each covers.",
    "",
    "For each subcompetency the facts genuinely bear on, write one entry:",
    "- code: the subcompetency code exactly as given.",
    "- evidence: one short paragraph, in the third person ('the resident'), describing what the project record shows that is relevant to that subcompetency. Plain, specific, and no longer than it needs to be.",
    "- factKeys: the keys of every fact the paragraph rests on.",
    "",
    "Rules:",
    "- Use only the facts given. If the facts do not bear on a subcompetency, leave it out; an empty-handed entry is worse than none.",
    "- Never assign, suggest or imply a milestone level, and never use rating words such as 'proficient', 'expert' or 'exceeds'. The program director rates; you describe evidence.",
    "- Never introduce a number. You may repeat a number that appears in a fact you cite, exactly as written.",
    "- Do not name anyone. Refer to 'the resident'.",
    "- The facts describe the project; do not claim the resident personally did something the facts do not attribute to them.",
  ].join("\n"),

  render(input) {
    return [
      "Subcompetencies:",
      ...input.subcompetencies.map((s) => `- ${s.code} ${s.title} (${s.domain}): ${s.covers}`),
      "",
      "Facts from the project record:",
      ...input.facts.map((f) => `- ${f.key}: ${f.text}`),
      "",
      "Write the entries.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const codes = input.subcompetencies.map((s) => s.code);
    const unknown = output.entries.filter((e) => !codes.includes(e.code));
    if (unknown.length) return `It used codes that are not in the list (${unknown.map((e) => e.code).join(", ")}). Use only the codes given.`;
    const written = output.entries.map((e) => e.code);
    if (new Set(written).size !== written.length) return "It wrote two entries for the same subcompetency. Write at most one each.";

    const byKey = new Map(input.facts.map((f) => [f.key, f]));
    for (const entry of output.entries) {
      const missing = entry.factKeys.filter((k) => !byKey.has(k));
      if (missing.length) return `The ${entry.code} entry cites facts that do not exist (${missing.join(", ")}). Cite only the keys given.`;
      const level = entry.evidence.match(LEVEL_LANGUAGE);
      if (level) return `The ${entry.code} entry uses rating language ("${level[0]}"). Describe the evidence; the program director assigns levels.`;
      if (/\bDr\.?\s+[A-Z]/.test(entry.evidence)) return `The ${entry.code} entry names someone. Refer to "the resident".`;
      const cited = entry.factKeys.map((k) => byKey.get(k)!.text).join("\n");
      const numbers = sourceNumbersGuard(entry.evidence, cited);
      if (numbers) return `The ${entry.code} entry ${numbers.replace("what you were given", "the facts it cites")}`;
    }
    return null;
  },

  mock(input) {
    const entries = input.subcompetencies.flatMap((s) => {
      const kinds = MOCK_KINDS[s.code] ?? [];
      const facts = input.facts.filter((f) => kinds.includes(f.kind));
      if (!facts.length) return [];
      const labels = [...new Set(facts.map((f) => f.label))];
      return [
        {
          code: s.code,
          evidence: `The project record shows ${labels.join("; ")}. The program director should confirm which of these the resident carried out personally.`,
          factKeys: facts.map((f) => f.key).slice(0, 8),
        },
      ];
    });
    if (entries.length === 0) {
      const first = input.facts[0];
      const code = input.subcompetencies.find((s) => s.code === "SBP2")?.code ?? input.subcompetencies[0]!.code;
      return {
        entries: [
          {
            code,
            evidence: `The project record so far shows only that the resident ${first ? first.label : "is part of an improvement project"}; there is not yet enough to describe.`,
            factKeys: [first?.key ?? "F1"],
          },
        ],
      };
    }
    return { entries };
  },
};
