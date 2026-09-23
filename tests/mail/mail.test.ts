import { describe, expect, it } from "vitest";
import { MailConfigurationError, mailProvider, sendMail, type MailMessage } from "@/lib/mail";

const message: MailMessage = {
  to: ["incoming@example.edu", "incoming@example.edu", " "],
  subject: "Handoff: Discharge summary completion",
  text: "Current state…",
  purpose: "handoff.packet",
  entity: "Handoff",
  entityId: "h1",
};

function recorder() {
  const entries: Array<Record<string, unknown>> = [];
  return { entries, audit: async (entry: Record<string, unknown>) => void entries.push(entry) };
}

describe("mail adapter", () => {
  it("defaults to log, which records the rendered message and sends nothing", async () => {
    const r = recorder();
    let fetched = false;
    const result = await sendMail(message, {
      env: {},
      audit: r.audit as never,
      fetch: (async () => {
        fetched = true;
        return new Response(null);
      }) as typeof fetch,
    });
    expect(result).toEqual({ provider: "log", delivered: false });
    expect(fetched).toBe(false);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({
      action: "mail.logged",
      entityId: "h1",
      metadata: { purpose: "handoff.packet", to: ["incoming@example.edu"], text: "Current state…" },
    });
  });

  it("refuses an unknown provider rather than guessing", () => {
    expect(() => mailProvider({ MAIL_PROVIDER: "sendgrid" })).toThrow(MailConfigurationError);
  });

  it("sends through SMTP and audits recipients and subject, not the body", async () => {
    const r = recorder();
    const sent: unknown[] = [];
    const result = await sendMail(message, {
      env: { MAIL_PROVIDER: "smtp", SMTP_HOST: "relay.example.internal", MAIL_FROM: "qi@example.edu" },
      audit: r.audit as never,
      smtpSend: async (options) => void sent.push(options),
    });
    expect(result).toEqual({ provider: "smtp", delivered: true });
    expect(sent).toEqual([{ from: "qi@example.edu", to: ["incoming@example.edu"], subject: message.subject, text: message.text }]);
    expect(r.entries[0]).toMatchObject({ action: "mail.sent", metadata: { provider: "smtp", subject: message.subject } });
    expect(JSON.stringify(r.entries[0])).not.toContain("Current state");
  });

  it("needs its configuration before it will send", async () => {
    await expect(sendMail(message, { env: { MAIL_PROVIDER: "smtp" }, audit: recorder().audit as never })).rejects.toThrow(/SMTP_HOST/);
    await expect(sendMail(message, { env: { MAIL_PROVIDER: "resend" }, audit: recorder().audit as never })).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("posts to Resend with the key in a header, never the body", async () => {
    let request: { url: string; init: RequestInit } | null = null;
    await sendMail(message, {
      env: { MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_secret", MAIL_FROM: "qi@example.edu" },
      audit: recorder().audit as never,
      fetch: (async (url: string, init: RequestInit) => {
        request = { url, init };
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(request!.url).toBe("https://api.resend.com/emails");
    expect((request!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer re_secret");
    expect(String(request!.init.body)).not.toContain("re_secret");
    expect(JSON.parse(String(request!.init.body))).toMatchObject({ to: ["incoming@example.edu"], subject: message.subject });
  });
});
