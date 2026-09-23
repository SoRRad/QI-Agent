import { describe, expect, it } from "vitest";
import type { PulseQuestion } from "@/lib/generated/prisma/client";
import { mockDriver } from "@/lib/llm/drivers/mock";
import { pulseDigestPrompt, pulseThemePrompt, type ThemeInput } from "@/lib/llm/prompts";
import { runPrompt } from "@/lib/llm/run";
import { allowedTransitions, checkTransition } from "@/lib/pulse/lifecycle";
import { nextQuarter, quarterLabel, quarterOf } from "@/lib/pulse/quarter";
import { responseRates } from "@/lib/pulse/rates";
import { addReceipt, MAX_RECEIPTS, newReceipt, parseReceipts, receiptHash } from "@/lib/pulse/receipts";
import { parseAnswers } from "@/lib/pulse/survey";
import { findVerbatim, sharedRun, VERBATIM_WORDS } from "@/lib/pulse/verbatim";

/** The twelve seeded responses (§8), as theming sees them: text and a key. */
const SEEDED = [
  "I could not get the data I needed. I asked for a report in March and still do not have it in September.",
  "Nobody told me who the analyst was. I emailed three people and gave up.",
  "The data request took so long that the resident who started the project had rotated off before it arrived.",
  "My project needed an order set change and I never found out who approves those.",
  "We were told to do a QI project but not given protected time, so it happened on days off or not at all.",
  "No protected time. Realistically this competes with sleep after nights.",
  "My coach was excellent but I only met them twice because of scheduling.",
  "I was assigned a coach outside my specialty who did not know the clinical context, so most meetings were spent explaining it.",
  "I did not know I was allowed to ask for a different coach.",
  "The handoff project template from last year was genuinely useful. More of that.",
  "Having a statistician look at our run chart before the symposium changed how we presented it.",
  "Feedback on the abstract came after the submission deadline had passed.",
];
const themeInput: ThemeInput = {
  responses: SEEDED.map((text, i) => ({ key: `r${i + 1}`, text })),
  openBarriers: [
    { key: "b1", label: "No protected time for improvement work", summary: "Respondents describe improvement work competing with rest." },
    { key: "b2", label: "Coach matching ignores clinical domain", summary: "Coaches are assigned without regard to specialty." },
  ],
};
const llm = { driver: mockDriver(), audit: async () => undefined };

describe("barrier lifecycle", () => {
  it("moves forward one step, through GMEC when escalated there", () => {
    expect(allowedTransitions("raised", "gmec")).toEqual(["at_gmec"]);
    expect(allowedTransitions("raised", "committee")).toEqual(["at_gmec", "decided"]);
    expect(allowedTransitions("at_gmec", "gmec")).toEqual(["decided"]);
    expect(allowedTransitions("decided", "program")).toEqual(["closed"]);
    expect(allowedTransitions("closed", "committee")).toEqual([]);
  });

  const decision = "GMEC approved a named analyst liaison for trainee requests.";
  const changed = "Trainee data requests now go to one named analyst with a two-week turnaround.";

  it("accepts each valid step with what it needs", () => {
    expect(checkTransition({ from: "raised", to: "at_gmec", target: "gmec", decision: null, whatChanged: null })).toBeNull();
    expect(checkTransition({ from: "at_gmec", to: "decided", target: "gmec", decision, whatChanged: null })).toBeNull();
    expect(checkTransition({ from: "decided", to: "closed", target: "gmec", decision, whatChanged: changed })).toBeNull();
    expect(checkTransition({ from: "raised", to: "decided", target: "committee", decision, whatChanged: null })).toBeNull();
  });

  it("refuses skipping GMEC, going backwards, reopening, and deciding or closing without words", () => {
    expect(checkTransition({ from: "raised", to: "decided", target: "gmec", decision, whatChanged: null })).toMatch(/goes to GMEC before it is decided/);
    expect(checkTransition({ from: "raised", to: "closed", target: "committee", decision, whatChanged: changed })).toMatch(/moves to at gmec or decided next/);
    expect(checkTransition({ from: "decided", to: "at_gmec", target: "gmec", decision, whatChanged: null })).toMatch(/forward only/);
    expect(checkTransition({ from: "closed", to: "raised", target: "gmec", decision, whatChanged: changed })).toMatch(/raise it as a new barrier/);
    expect(checkTransition({ from: "at_gmec", to: "decided", target: "gmec", decision: "ok", whatChanged: null })).toMatch(/Record the decision/);
    expect(checkTransition({ from: "decided", to: "closed", target: "gmec", decision, whatChanged: " " })).toMatch(/Say what changed/);
    expect(checkTransition({ from: "decided", to: "decided", target: "gmec", decision, whatChanged: null })).toMatch(/already decided/);
  });
});

describe("the paraphrase check", () => {
  it(`finds a run of ${VERBATIM_WORDS} words regardless of case and punctuation`, () => {
    expect(sharedRun("Several said: nobody told me who the ANALYST was!", SEEDED[1]!)).toBe("nobody told me who the analyst");
    expect(sharedRun("Trainees did not know whom to ask about analysis.", SEEDED[1]!)).toBeNull();
  });

  it(`allows a shared run one word shorter than ${VERBATIM_WORDS}`, () => {
    // "ask for a different coach" is five words.
    expect(sharedRun("Some did not realise they could ask for a different coach.", SEEDED[8]!)).toBeNull();
  });

  it("reports which source a hit came from", () => {
    expect(findVerbatim(["x", "Work that this competes with sleep after nights."], SEEDED)).toEqual({
      text: "Work that this competes with sleep after nights.",
      sourceIndex: 5,
      run: "this competes with sleep after nights",
    });
  });
});

describe("theming (exit criterion: no verbatim substring above the threshold)", () => {
  it("groups every seeded response exactly once, in at most six themes, matching open barriers", async () => {
    const output = await runPrompt(pulseThemePrompt, themeInput, { userId: null }, llm);
    const keys = output.themes.flatMap((t) => t.responseKeys).sort();
    expect(keys).toEqual(themeInput.responses.map((r) => r.key).sort());
    expect(output.themes.length).toBeGreaterThanOrEqual(3);
    expect(output.themes.length).toBeLessThanOrEqual(6);
    expect(output.themes.find((t) => t.label === "No protected time for improvement work")?.barrierKey).toBe("b1");
    expect(output.themes.find((t) => t.label === "Coaching access and fit")?.barrierKey).toBe("b2");
  });

  it("contains no run of six or more words from any response, and no number", async () => {
    const output = await runPrompt(pulseThemePrompt, themeInput, { userId: null }, llm);
    for (const theme of output.themes) {
      for (const response of SEEDED) {
        expect(sharedRun(theme.label, response), theme.label).toBeNull();
        expect(sharedRun(theme.summary, response), theme.summary).toBeNull();
      }
      expect(`${theme.label} ${theme.summary}`).not.toMatch(/\d/);
    }
  });

  const base = { label: "Getting data", summary: "Respondents describe long waits for the data their project depends on.", escalationTarget: "gmec" as const, barrierKey: null };
  const all = themeInput.responses.map((r) => r.key);

  it("rejects a theme that quotes a respondent", () => {
    const quoted = { themes: [{ ...base, summary: "Trainees said the data request took so long that residents rotated off.", responseKeys: all }] };
    expect(pulseThemePrompt.refine?.(quoted, themeInput)).toMatch(/repeated a respondent's words \("the data request took so long"\)/);
  });

  it("rejects numbers, unknown or missing keys, and double assignment", () => {
    expect(pulseThemePrompt.refine?.({ themes: [{ ...base, summary: `${base.summary} Three people said so.`, responseKeys: all }] }, themeInput)).toMatch(/contains a number/);
    expect(pulseThemePrompt.refine?.({ themes: [{ ...base, responseKeys: [...all, "r99"] }] }, themeInput)).toMatch(/not given \(r99\)/);
    expect(pulseThemePrompt.refine?.({ themes: [{ ...base, responseKeys: all.slice(1) }] }, themeInput)).toMatch(/not put in any theme \(r1\)/);
    expect(pulseThemePrompt.refine?.({ themes: [{ ...base, responseKeys: all }, { ...base, responseKeys: ["r1"] }] }, themeInput)).toMatch(/more than one theme \(r1\)/);
  });
});

describe("digest prompt", () => {
  const input = {
    barriers: [
      { key: "c1", label: "Data access is slow", decision: "GMEC approved an analyst liaison.", whatChanged: "Requests have a two-week turnaround.", closedMonth: "August 2026" },
      { key: "c2", label: "Templates are hard to find", decision: "The committee agreed to share templates.", whatChanged: "Templates are in the library.", closedMonth: "September 2026" },
    ],
  };

  it("writes one item per closed barrier given, and its mock passes its own checks", async () => {
    const output = await runPrompt(pulseDigestPrompt, input, { userId: null }, llm);
    expect(output.items.map((i) => i.key)).toEqual(["c1", "c2"]);
  });

  it("refuses items about barriers it was not given, left-out barriers, and invented numbers", () => {
    const ok = pulseDigestPrompt.mock(input);
    expect(pulseDigestPrompt.refine?.({ ...ok, items: [...ok.items, { key: "c3", text: "Something else entirely changed." }] }, input)).toMatch(/not given \(c3\)/);
    expect(pulseDigestPrompt.refine?.({ ...ok, items: ok.items.slice(0, 1) }, input)).toMatch(/left out barriers it was given \(c2\)/);
    expect(pulseDigestPrompt.refine?.({ ...ok, intro: "Over 40 trainees reported these." }, input)).toMatch(/numbers that are not in what you were given \(40\)/);
    // A number from the records may be repeated.
    expect(pulseDigestPrompt.refine?.({ ...ok, intro: "Requests now have a two-week turnaround, as of August 2026." }, input)).toBeNull();
  });
});

describe("response rate", () => {
  it("is participation over active trainees, per program and in total, as whole percents", () => {
    const { programs, total } = responseRates([
      { programId: "s", program: "Surgery", trainees: 9, responded: 5 },
      { programId: "m", program: "Medicine", trainees: 14, responded: 7 },
      { programId: "e", program: "Empty", trainees: 0, responded: 0 },
    ]);
    expect(programs.map((p) => [p.program, p.percent])).toEqual([
      ["Empty", null],
      ["Medicine", 50],
      ["Surgery", 56],
    ]);
    expect(total).toMatchObject({ trainees: 23, responded: 12, percent: 52 });
  });
});

describe("receipts", () => {
  it("bind to the user, so a shared workstation does not reveal the last person's response", () => {
    const token = newReceipt();
    expect(receiptHash(token, "user-a")).not.toBe(receiptHash(token, "user-b"));
    expect(receiptHash(token, "user-a")).toBe(receiptHash(token, "user-a"));
  });

  it("keep the most recent receipts and ignore anything malformed", () => {
    let cookie: string | undefined;
    const tokens = Array.from({ length: MAX_RECEIPTS + 2 }, () => newReceipt());
    for (const t of tokens) cookie = addReceipt(cookie, t);
    expect(parseReceipts(cookie)).toEqual(tokens.slice(-MAX_RECEIPTS));
    expect(parseReceipts("not-a-token.<script>")).toEqual([]);
  });
});

describe("quarters", () => {
  it("are calendar quarters", () => {
    expect(quarterOf(new Date("2026-09-23T12:00:00Z"))).toBe("2026-Q3");
    expect(nextQuarter("2026-Q4")).toBe("2027-Q1");
    expect(quarterLabel("2026-Q3")).toBe("July – September 2026");
  });
});

describe("answers", () => {
  const q = (over: Partial<PulseQuestion>): PulseQuestion =>
    ({ id: "q", surveyId: "s", position: 0, kind: "free_text", core: null, prompt: "Q", help: null, required: false, options: [], ...over }) as PulseQuestion;
  const questions = [
    q({ id: "conf", kind: "scale", core: "confidence", prompt: "Confidence?", required: true }),
    q({ id: "cler", kind: "cler_domain", core: "cler_domain", prompt: "Area?" }),
    q({ id: "bar", kind: "free_text", core: "barrier", prompt: "Barrier?" }),
    q({ id: "time", kind: "single_choice", prompt: "Time?", options: ["None", "Some"] }),
  ];

  it("maps core questions to columns and custom ones to answers", () => {
    expect(parseAnswers(questions, { conf: "4", cler: "supervision", bar: " Slow data. ", time: "Some" })).toEqual({
      confidence: 4,
      clerDomain: "supervision",
      barrierText: "Slow data.",
      custom: [{ questionId: "time", text: "Some", number: null }],
    });
  });

  it("names the question it refuses", () => {
    expect(() => parseAnswers(questions, {})).toThrow(/“Confidence\?” needs an answer/);
    expect(() => parseAnswers(questions, { conf: "7" })).toThrow(/takes a number from 1 to 5/);
    expect(() => parseAnswers(questions, { conf: "3", time: "Lots" })).toThrow(/Choose one of the listed answers for “Time\?”/);
    expect(() => parseAnswers(questions, { conf: "3", cler: "cardiology" })).toThrow(/listed focus areas/);
  });
});
