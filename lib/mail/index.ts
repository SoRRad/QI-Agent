import { audit } from "@/lib/audit";

/**
 * Mail behind an adapter (ADR-0008).
 *
 *   log     the default. Renders the message and records it to the audit log;
 *           sends nothing. A demo must never send mail.
 *   smtp    an internal relay: the expected production path behind a firewall.
 *   resend  a hosted option for a pilot outside the firewall.
 *
 * Feature code calls sendMail() and never learns which provider ran. Delivery
 * is not assumed anywhere: a handoff is accepted in the application, not by
 * clicking a link in an email that may never have been sent.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  /** What the message is for, e.g. "handoff.packet". Recorded in the audit log. */
  purpose: string;
  entity?: string;
  entityId?: string;
}

export interface MailResult {
  provider: MailProviderName;
  delivered: boolean;
}

export type MailProviderName = "log" | "smtp" | "resend";

export class MailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigurationError";
  }
}

export interface MailDependencies {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Replaces the SMTP transport, for tests. */
  smtpSend?: (options: { from: string; to: string[]; subject: string; text: string }) => Promise<unknown>;
  audit?: typeof audit;
}

export function mailProvider(env: Record<string, string | undefined> = process.env): MailProviderName {
  const name = (env["MAIL_PROVIDER"] ?? "log").trim() || "log";
  if (name !== "log" && name !== "smtp" && name !== "resend") {
    throw new MailConfigurationError(`MAIL_PROVIDER must be log, smtp or resend; got "${name}".`);
  }
  return name;
}

export async function sendMail(message: MailMessage, deps: MailDependencies = {}): Promise<MailResult> {
  const env = deps.env ?? process.env;
  const record = deps.audit ?? audit;
  const provider = mailProvider(env);
  const from = env["MAIL_FROM"] || "qi-agent@localhost";
  const to = [...new Set(message.to.map((t) => t.trim()).filter(Boolean))];
  if (to.length === 0) throw new MailConfigurationError("A message needs at least one recipient.");

  if (provider === "log") {
    // The rendered message is the record. It was built from text that already
    // passed the PHI guard, and the audit write is itself block-tier scanned.
    await record({
      action: "mail.logged",
      entity: message.entity ?? null,
      entityId: message.entityId ?? null,
      metadata: { purpose: message.purpose, to, from, subject: message.subject, text: message.text },
    });
    return { provider, delivered: false };
  }

  if (provider === "smtp") {
    const send = deps.smtpSend ?? (await smtpTransport(env));
    await send({ from, to, subject: message.subject, text: message.text });
  } else {
    const key = env["RESEND_API_KEY"];
    if (!key) throw new MailConfigurationError("MAIL_PROVIDER=resend needs RESEND_API_KEY.");
    const response = await (deps.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) throw new Error(`The mail service refused the message (HTTP ${response.status}).`);
  }

  // Delivered mail is audited by recipient and subject, not body.
  await record({
    action: "mail.sent",
    entity: message.entity ?? null,
    entityId: message.entityId ?? null,
    metadata: { purpose: message.purpose, provider, to, subject: message.subject },
  });
  return { provider, delivered: true };
}

async function smtpTransport(env: Record<string, string | undefined>) {
  const host = env["SMTP_HOST"];
  if (!host) throw new MailConfigurationError("MAIL_PROVIDER=smtp needs SMTP_HOST.");
  const nodemailer = await import("nodemailer");
  const port = Number(env["SMTP_PORT"] || 587);
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    ...(env["SMTP_USER"] ? { auth: { user: env["SMTP_USER"], pass: env["SMTP_PASSWORD"] ?? "" } } : {}),
  });
  return (options: { from: string; to: string[]; subject: string; text: string }) => transport.sendMail(options);
}
