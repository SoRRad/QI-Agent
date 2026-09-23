import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, LlmOutputError, type LlmCallRecord, type LlmDriver } from "@/lib/llm";

/**
 * completeJSON: validate, retry ONCE with the reason, then throw. And every
 * call audited — who, what feature, tokens, latency — never the prompt or the
 * reply.
 */

function scripted(...replies: string[]): LlmDriver & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    name: "mock",
    model: "scripted",
    prompts,
    async generate(request) {
      prompts.push(request.prompt);
      const text = replies[Math.min(i, replies.length - 1)] ?? "";
      i += 1;
      return { text, model: "scripted", inputTokens: 10, outputTokens: 3 };
    },
  };
}

const schema = z.object({ answer: z.string(), confidence: z.number().min(0).max(1) });

function setup(driver: LlmDriver) {
  const audits: LlmCallRecord[] = [];
  const llm = createLlm(
    { feature: "test.json", userId: "user-1" },
    { driver, audit: async (r) => void audits.push(r) },
  );
  return { llm, audits };
}

describe("completeJSON", () => {
  it("returns a valid reply on the first attempt", async () => {
    const { llm } = setup(scripted('{"answer":"yes","confidence":0.8}'));
    await expect(llm.completeJSON({ prompt: "Q", schema })).resolves.toEqual({ answer: "yes", confidence: 0.8 });
  });

  it("tolerates a code fence and surrounding prose", async () => {
    const { llm } = setup(scripted('Here you go:\n```json\n{"answer":"yes","confidence":1}\n```'));
    await expect(llm.completeJSON({ prompt: "Q", schema })).resolves.toMatchObject({ answer: "yes" });
  });

  it("retries once with the reason, and succeeds", async () => {
    const driver = scripted("not json at all", '{"answer":"yes","confidence":0.5}');
    const { llm } = setup(driver);
    await expect(llm.completeJSON({ prompt: "Q", schema })).resolves.toMatchObject({ answer: "yes" });
    expect(driver.prompts).toHaveLength(2);
    expect(driver.prompts[1]).toMatch(/previous reply could not be used/);
  });

  it("retries a schema violation with the specific issue", async () => {
    const driver = scripted('{"answer":"yes","confidence":7}', '{"answer":"yes","confidence":0.7}');
    const { llm } = setup(driver);
    await llm.completeJSON({ prompt: "Q", schema });
    expect(driver.prompts[1]).toMatch(/confidence/);
  });

  it("gives up after the second failure rather than looping", async () => {
    const driver = scripted("nope", "still nope", '{"answer":"too late","confidence":1}');
    const { llm } = setup(driver);
    await expect(llm.completeJSON({ prompt: "Q", schema })).rejects.toBeInstanceOf(LlmOutputError);
    expect(driver.prompts).toHaveLength(2);
  });

  it("treats a refine failure as a failure, sharing the same single retry", async () => {
    const driver = scripted('{"answer":"42 exactly","confidence":1}', '{"answer":"about right","confidence":1}');
    const { llm } = setup(driver);
    const result = await llm.completeJSON({
      prompt: "Q",
      schema,
      refine: (v) => (/\d/.test(v.answer) ? "it contained a digit" : null),
    });
    expect(result.answer).toBe("about right");
    expect(driver.prompts[1]).toMatch(/it contained a digit/);
  });

  it("includes the JSON schema in the system prompt", async () => {
    let system = "";
    const driver: LlmDriver = {
      name: "mock",
      model: "m",
      async generate(request) {
        system = request.system ?? "";
        return { text: '{"answer":"a","confidence":0}', model: "m" };
      },
    };
    const { llm } = setup(driver);
    await llm.completeJSON({ system: "Be careful.", prompt: "Q", schema });
    expect(system).toMatch(/^Be careful\./);
    expect(system).toContain('"confidence"');
  });
});

describe("audit of every call", () => {
  it("records user, feature, provider, model, tokens and latency — never prompt or reply", async () => {
    const { llm, audits } = setup(scripted('{"answer":"secret reply text","confidence":1}'));
    await llm.completeJSON({ prompt: "a prompt body with private words", schema });

    expect(audits).toHaveLength(1);
    const [record] = audits;
    expect(record).toMatchObject({
      userId: "user-1",
      feature: "test.json",
      provider: "mock",
      model: "scripted",
      inputTokens: 10,
      outputTokens: 3,
      ok: true,
    });
    expect(record?.latencyMs).toBeGreaterThanOrEqual(0);
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain("private words");
    expect(serialised).not.toContain("secret reply text");
  });

  it("records each attempt of a retried call", async () => {
    const { llm, audits } = setup(scripted("nope", '{"answer":"a","confidence":0}'));
    await llm.completeJSON({ prompt: "Q", schema });
    expect(audits).toHaveLength(2);
  });

  it("records a failed call as not ok", async () => {
    const failing: LlmDriver = {
      name: "mock",
      model: "m",
      async generate() {
        throw new Error("upstream down");
      },
    };
    const { llm, audits } = setup(failing);
    await expect(llm.complete({ prompt: "Q" })).rejects.toThrow("upstream down");
    expect(audits).toEqual([expect.objectContaining({ ok: false, feature: "test.json" })]);
  });
});
