import { describe, expect, it } from "vitest";
import { PhiAcknowledgementRequiredError, PhiBlockedError } from "@/lib/phi/errors";
import { scanWriteData } from "@/lib/phi/guard";
import { guardOutbound } from "@/lib/phi/outbound";
import { runWithContext } from "@/lib/request-context";

/**
 * Text bound for a language model is scanned like text bound for a table.
 */

type Entry = Parameters<NonNullable<Parameters<typeof guardOutbound>[3]>["audit"] & object>[0];

function collect() {
  const entries: Entry[] = [];
  return { entries, audit: async (e: Entry) => void entries.push(e) };
}

const AS = { model: "KnowledgeGap", field: "question" };
const ctx = (acknowledged: string[] = []) => ({ userId: "u1", acknowledgedPhi: new Set(acknowledged) });

describe("guardOutbound", () => {
  it("lets clean text through without auditing anything", async () => {
    const { entries, audit } = collect();
    await runWithContext(ctx(), () => guardOutbound("ask.answer", AS, "What are the four run chart rules?", { audit }));
    expect(entries).toEqual([]);
  });

  it("refuses to send block-tier text, and audits the block without the text", async () => {
    const { entries, audit } = collect();
    await expect(
      runWithContext(ctx(), () =>
        guardOutbound("ask.answer", AS, "Why was MRN 00123456 readmitted?", { audit }),
      ),
    ).rejects.toBeInstanceOf(PhiBlockedError);
    expect(entries.map((e) => e.action)).toEqual(["phi.block"]);
    expect(entries[0]?.entity).toBe("llm.outbound:ask.answer");
    expect(JSON.stringify(entries)).not.toContain("00123456");
  });

  it("requires acknowledgement for warn-tier text, then records it", async () => {
    const text = "For admissions seen on 14 March 2025, does the IRB policy apply?";
    const { entries, audit } = collect();

    const error = await runWithContext(ctx(), () => guardOutbound("ask.answer", AS, text, { audit })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhiAcknowledgementRequiredError);
    const fingerprints = (error as PhiAcknowledgementRequiredError).flags.map((f) => f.fingerprint ?? "");

    await runWithContext(ctx(fingerprints), () => guardOutbound("ask.answer", AS, text, { audit }));
    expect(entries.map((e) => e.action)).toEqual(["phi.warn_acknowledged"]);
    expect(JSON.stringify(entries)).not.toContain("March");
  });

  it("produces the same fingerprints as storing the same text in the same field", async () => {
    // This is what lets one acknowledgement cover both the model call and the
    // knowledge gap row that records the same question.
    const text = "Seen on 14 March 2025.";
    const error = await runWithContext(ctx(), () => guardOutbound("ask.answer", AS, text, collect())).catch(
      (e: PhiAcknowledgementRequiredError) => e,
    );
    const outbound = (error as PhiAcknowledgementRequiredError).flags.map((f) => f.fingerprint);
    const storage = scanWriteData("KnowledgeGap", { question: text }).map((f) => f.fingerprint);
    expect(outbound).toEqual(storage);
  });
});
