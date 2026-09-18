# 0008 — Mail behind an adapter, logging by default

**Status:** accepted (phase 0; implemented with the handoff packet in phase 5)

## Decision

`lib/mail` exposes one interface with three providers, selected by
`MAIL_PROVIDER`:

- `log` — **the default.** Renders the message, records it to the audit table,
  and sends nothing.
- `smtp` — an internal relay, the expected production path.
- `resend` — a hosted option for a pilot outside the firewall.

## Why

The handoff packet is emailed to the incoming owner, and a hospital-firewalled
deployment usually means an internal SMTP relay whose details are not yet
known. The adapter defers that decision without blocking the feature.

`log` as the default exists for a specific reason: **a demo must never send
mail.** The seed contains realistic names and a handoff packet; a committee
demonstration that emails a real address because someone forgot to configure a
provider is a failure mode worth designing out rather than remembering.

Recording the rendered message to the audit table means a handoff can be shown
to have been generated even where nothing was delivered — which is also what
makes the handoff a durable record rather than a hopeful email.

## Rejected

- **Sending directly via an SMTP library from feature code.** Same coupling
  problem as calling a vendor SDK directly.
- **No mail at all until a relay exists.** The handoff packet is the
  highest-leverage feature in the system; waiting on an SMTP host to build it
  would be the wrong order.
- **Defaulting to a real provider with an empty configuration.** Fails at
  runtime in front of a user instead of degrading predictably.

## Consequence

Handoff acceptance cannot rely on an email link alone, since mail may not be
delivered at all. Acceptance is an in-application action, which is the better
design regardless: an unaccepted handoff older than 14 days is its own stall
signal.
