import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import { LlmError, type LlmDependencies } from "@/lib/llm";
import { runPrompt } from "@/lib/llm/run";
import { pulseDigestPrompt, type DigestOutput } from "@/lib/llm/prompts";
import { sendMail, type MailDependencies } from "@/lib/mail";
import { PulsePermissionError, PulseRuleError } from "./errors";

/**
 * "You reported, we changed" (§6.4, addition C2).
 *
 * A digest covers closed barriers that no published digest has reported yet.
 * It is generated from closed barriers ONLY: the query selects them, the
 * prompt's check refuses any other key, and publishing refuses any barrier
 * that is not closed. The generated text is a draft; the chair edits it and
 * publishes, and the PHI guard reads what the chair publishes.
 */

function requireChair(user: User): void {
  if (user.role !== "chair") throw new PulsePermissionError("Only the chair publishes the digest.");
}

const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export async function undigestedClosedBarriers() {
  const published = await db.pulseDigest.findMany({ where: { publishedAt: { not: null } }, select: { barrierIds: true } });
  const reported = new Set(published.flatMap((d) => d.barrierIds));
  const closed = await db.barrier.findMany({
    where: { status: "closed" },
    orderBy: { closedAt: "asc" },
    select: { id: true, themeLabel: true, decision: true, whatChanged: true, closedAt: true },
  });
  return closed.filter((b) => !reported.has(b.id));
}

export interface DigestDraft {
  headline: string;
  intro: string;
  items: Array<{ barrierId: string; label: string; text: string }>;
  /** "model", or "records" when the model was unavailable and the draft is assembled from the barriers' own text. */
  source: "model" | "records";
}

export async function draftDigest(user: User, deps: LlmDependencies = {}): Promise<DigestDraft> {
  requireChair(user);
  const barriers = await undigestedClosedBarriers();
  if (barriers.length === 0) throw new PulseRuleError("Every closed barrier has already been reported in a published digest.");
  const keyed = barriers.map((b, i) => ({ key: `c${i + 1}`, barrier: b }));
  const input = {
    barriers: keyed.map(({ key, barrier }) => ({
      key,
      label: barrier.themeLabel,
      decision: barrier.decision ?? "",
      whatChanged: barrier.whatChanged ?? "",
      closedMonth: barrier.closedAt ? monthYear(barrier.closedAt) : "",
    })),
  };
  let output: DigestOutput;
  let source: DigestDraft["source"] = "model";
  try {
    output = await runPrompt(pulseDigestPrompt, input, { userId: user.id }, deps);
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    console.error("[pulse.digest] unavailable", error);
    output = pulseDigestPrompt.mock(input);
    source = "records";
  }
  const byKey = new Map(keyed.map(({ key, barrier }) => [key, barrier]));
  return {
    headline: output.headline,
    intro: output.intro,
    items: output.items.map((item) => {
      const barrier = byKey.get(item.key)!;
      return { barrierId: barrier.id, label: barrier.themeLabel, text: item.text };
    }),
    source,
  };
}

export interface DigestToPublish {
  headline: string;
  intro: string;
  items: Array<{ barrierId: string; text: string }>;
}

export async function publishDigest(user: User, digest: DigestToPublish, mail: MailDependencies = {}): Promise<string> {
  requireChair(user);
  const headline = digest.headline.trim();
  const intro = digest.intro.trim();
  const items = digest.items.map((i) => ({ barrierId: i.barrierId, text: i.text.trim() })).filter((i) => i.text);
  if (headline.length < 4 || intro.length < 10) throw new PulseRuleError("Give the digest a headline and a sentence of introduction.");
  if (items.length === 0) throw new PulseRuleError("A digest reports at least one closed barrier.");

  const ids = items.map((i) => i.barrierId);
  if (new Set(ids).size !== ids.length) throw new PulseRuleError("Each barrier appears once in a digest.");
  const eligible = new Set((await undigestedClosedBarriers()).map((b) => b.id));
  const notClosed = await db.barrier.findMany({ where: { id: { in: ids }, status: { not: "closed" } }, select: { themeLabel: true } });
  if (notClosed.length) {
    throw new PulseRuleError(`The digest reports closed barriers only. “${notClosed[0]!.themeLabel}” is not closed yet.`);
  }
  if (ids.some((id) => !eligible.has(id))) throw new PulseRuleError("One of these barriers has already been reported in a published digest.");

  const created = await db.pulseDigest.create({
    data: { headline, intro, items, barrierIds: ids, createdById: user.id, publishedAt: new Date() },
  });
  await audit({ userId: user.id, action: "pulse.digest_published", entity: "PulseDigest", entityId: created.id, metadata: { barriers: ids.length } });

  const trainees = await db.user.findMany({ where: { role: "trainee", active: true }, select: { email: true } });
  if (trainees.length) {
    // Blind copies: a broadcast must not show every trainee everyone's address.
    await sendMail(
      {
        to: [],
        bcc: trainees.map((t) => t.email),
        purpose: "pulse.digest",
        entity: "PulseDigest",
        entityId: created.id,
        subject: headline,
        text: [headline, "", intro, "", ...items.map((i) => `- ${i.text}`), "", `${process.env["APP_URL"] ?? ""}/pulse`].join("\n"),
      },
      mail,
    );
  }
  return created.id;
}

export interface PublishedItem {
  barrierId: string;
  text: string;
}

export async function latestDigest() {
  const digest = await db.pulseDigest.findFirst({ where: { publishedAt: { not: null } }, orderBy: { publishedAt: "desc" } });
  if (!digest) return null;
  return { ...digest, items: digest.items as unknown as PublishedItem[] };
}
