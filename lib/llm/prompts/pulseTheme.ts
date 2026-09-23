import { z } from "zod";
import { contentWords } from "@/lib/ask/text";
import { findVerbatim, VERBATIM_WORDS } from "@/lib/pulse/verbatim";
import { sourceNumbersGuard } from "../guards/sourceNumbers";
import type { PromptDefinition } from "./types";

/**
 * Theming (§6.4): clusters a quarter's free-text barrier responses into a few
 * themes, each with a paraphrased summary and an escalation target.
 *
 * What the model is not trusted with:
 *   - Counts. How many responses a theme holds is counted in code from the
 *     keys the model assigns; a summary may not contain a number at all.
 *   - Quotes. No run of VERBATIM_WORDS consecutive words from any response may
 *     appear in a label or summary. The same check runs again when the chair
 *     saves a barrier, whoever wrote the text.
 *   - Identity. The model sees response text only: never a name, a program or
 *     a date.
 *
 * The model proposes; the chair edits and saves. Nothing it writes is stored
 * until a person has read it.
 */

export interface ThemeResponse {
  key: string;
  text: string;
}

export interface ThemeBarrier {
  key: string;
  label: string;
  summary: string;
}

export interface ThemeInput {
  responses: ThemeResponse[];
  /** Open barriers a response may belong to instead of a new theme. */
  openBarriers: ThemeBarrier[];
}

export const MAX_THEMES = 6;

const schema = z.object({
  themes: z
    .array(
      z.object({
        label: z.string().min(4).max(80),
        summary: z.string().min(30).max(400),
        escalationTarget: z.enum(["committee", "gmec", "program"]),
        responseKeys: z.array(z.string().min(1).max(10)).min(1),
        barrierKey: z.string().min(1).max(10).nullable(),
      }),
    )
    .min(1)
    .max(MAX_THEMES),
});

export type ThemeOutput = z.infer<typeof schema>;

export const pulseThemePrompt: PromptDefinition<ThemeInput, ThemeOutput> = {
  id: "pulse.theme",
  purpose:
    "Groups a quarter's free-text pulse responses into a few themes, each with a paraphrased summary and a suggested escalation target, for the chair to review.",
  maxTokens: 2_500,
  system: [
    "You help the chair of a graduate medical education quality improvement committee read what trainees reported in a quarterly survey.",
    "",
    "You are given anonymous free-text responses, each with a key, and the barriers the committee is already working on, each with a key. Group the responses into themes: three to six where the responses genuinely differ, fewer if they do not. Never split one concern into two themes to reach a number.",
    "",
    "For each theme:",
    "- label: a short plain-language name for the problem (at most 80 characters).",
    "- summary: two or three sentences describing the problem in your own words, as a pattern across respondents.",
    "- escalationTarget: \"gmec\" when it needs institutional resources or policy (protected time, analyst support, IT changes); \"program\" when a single program can fix it; otherwise \"committee\".",
    "- responseKeys: the keys of the responses in this theme.",
    "- barrierKey: the key of an existing barrier if the theme is the same problem, otherwise null.",
    "",
    "Rules:",
    "- Every response key belongs to exactly one theme.",
    `- Paraphrase. Never copy ${VERBATIM_WORDS} or more consecutive words from any response. A trainee must not be recognisable by their phrasing.`,
    "- Write no numbers at all, in digits or words. How many responses a theme holds is counted separately.",
    "- Never guess who wrote a response, which program they are in, or when.",
    "- A response describing something that helped belongs in a theme about what helped.",
  ].join("\n"),

  render(input) {
    return [
      "Responses:",
      ...input.responses.map((r) => `- key ${r.key}: ${r.text}`),
      "",
      input.openBarriers.length ? "Barriers already being worked on:" : "No barriers are currently open.",
      ...input.openBarriers.map((b) => `- key ${b.key}: ${b.label}. ${b.summary}`),
      "",
      "Group the responses into themes.",
    ].join("\n");
  },

  schema,

  refine(output, input) {
    const responseKeys = new Set(input.responses.map((r) => r.key));
    const barrierKeys = new Set(input.openBarriers.map((b) => b.key));
    const seen = new Map<string, number>();
    for (const theme of output.themes) {
      for (const key of theme.responseKeys) {
        if (!responseKeys.has(key)) return `A theme listed a response key that was not given (${key}). Use only the keys given.`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      if (theme.barrierKey !== null && !barrierKeys.has(theme.barrierKey)) {
        return `A theme named a barrier key that was not given (${theme.barrierKey}).`;
      }
    }
    const repeated = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    if (repeated.length) return `Responses were put in more than one theme (${repeated.join(", ")}). Each belongs to exactly one.`;
    const missing = [...responseKeys].filter((k) => !seen.has(k));
    if (missing.length) return `Some responses were not put in any theme (${missing.join(", ")}). Every response belongs to exactly one.`;
    const linked = output.themes.map((t) => t.barrierKey).filter((k): k is string => k !== null);
    if (new Set(linked).size !== linked.length) return "Two themes were matched to the same existing barrier. Merge them.";

    for (const theme of output.themes) {
      if (sourceNumbersGuard(`${theme.label}\n${theme.summary}`, "")) {
        return `The theme "${theme.label}" contains a number. Write no numbers: how many responses a theme holds is counted separately.`;
      }
    }
    const hit = findVerbatim(
      output.themes.flatMap((t) => [t.label, t.summary]),
      input.responses.map((r) => r.text),
    );
    if (hit) return `A theme repeated a respondent's words ("${hit.run}"). Paraphrase: never copy ${VERBATIM_WORDS} or more consecutive words.`;
    return null;
  },

  mock(input) {
    const assigned = new Map<Bucket, string[]>();
    for (const r of input.responses) {
      const bucket = BUCKETS.find((b) => b.match.test(r.text)) ?? OTHER;
      assigned.set(bucket, [...(assigned.get(bucket) ?? []), r.key]);
    }
    const used = new Set<string>();
    const themes = [...assigned.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([bucket, keys]) => {
        const barrier = input.openBarriers.find(
          (b) => !used.has(b.key) && contentWords(b.label).some((w) => bucket.keywords.includes(w)),
        );
        if (barrier) used.add(barrier.key);
        return { label: bucket.label, summary: bucket.summary, escalationTarget: bucket.target, responseKeys: keys, barrierKey: barrier?.key ?? null };
      });
    // Seven buckets, counting "other", can exceed the cap of six: fold the
    // smallest theme into "other" (or into the last theme) until it fits.
    while (themes.length > MAX_THEMES) {
      const smallest = themes.pop()!;
      const other = themes.find((t) => t.label === OTHER.label) ?? themes[themes.length - 1]!;
      other.responseKeys.push(...smallest.responseKeys);
    }
    return { themes };
  },
};

interface Bucket {
  match: RegExp;
  keywords: string[];
  label: string;
  summary: string;
  target: "committee" | "gmec" | "program";
}

/** The mock's buckets, in priority order. Summaries are written to pass the prompt's own checks. */
const BUCKETS: Bucket[] = [
  {
    match: /\b(data|report|analyst|extract)\b/i,
    keywords: ["data", "analyst", "access"],
    label: "Getting data for a project",
    summary: "Respondents describe long waits for the data their project depends on, and not knowing whom to ask for it, so projects stall before the first test of change.",
    target: "gmec",
  },
  {
    match: /protected time|days off|competes|no time/i,
    keywords: ["protect", "time"],
    label: "No protected time for improvement work",
    summary: "Respondents describe improvement work squeezed into rest days and post-call hours instead of scheduled time, so progress depends on goodwill.",
    target: "gmec",
  },
  {
    match: /order set|approv|who signs|permission/i,
    keywords: ["approv", "change", "order"],
    label: "Unclear routes for approving system changes",
    summary: "Respondents could not find out who authorises changes to clinical systems such as order sets, so ideas that worked in testing could not be put in place.",
    target: "committee",
  },
  {
    match: /coach|mentor/i,
    keywords: ["coach", "match", "mentor"],
    label: "Coaching access and fit",
    summary: "Respondents describe too little contact with their coach, or a coach without the clinical background of the project, and uncertainty about whether a change could be requested.",
    target: "committee",
  },
  {
    match: /feedback|deadline|abstract/i,
    keywords: ["feedback", "deadline"],
    label: "Feedback arriving too late to use",
    summary: "Respondents describe reviews of their work reaching them after the point at which they could still act on them.",
    target: "committee",
  },
  {
    match: /useful|helped|changed how|more of that|statistician/i,
    keywords: ["help"],
    label: "What helped",
    summary: "Some respondents named supports that made a difference, such as reusable material from earlier projects and expert review of charts before presenting.",
    target: "committee",
  },
];

const OTHER: Bucket = {
  match: /.^/,
  keywords: [],
  label: "Other concerns",
  summary: "Respondents raised further concerns that did not fit the other themes. The chair should read these responses directly before deciding where they belong.",
  target: "committee",
};
