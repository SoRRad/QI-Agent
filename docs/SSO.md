# Single sign-on: what the identity team must supply

This page exists so that the conversation with the institution's identity team
is one meeting rather than three. It states exactly what is needed, what will
be done with it, and what the integration does **not** require.

## The short version

QI Agent needs SAML 2.0 or OIDC single sign-on, one attribute carrying an
institutional email address, and — ideally but not necessarily — one attribute
carrying a group or affiliation that distinguishes trainees from faculty.
Nothing else.

## Why this is a one-file change

Every code path that needs to know who the user is calls `getCurrentUser()`
from `lib/auth`. Nothing else in the application reads a cookie, a header, or
an environment variable to establish identity. Integrating SSO replaces the
body of one function, `resolveUser`, in `lib/auth/index.ts`.

The intended implementation is NextAuth (Auth.js) with a SAML or OIDC provider.
The role and program lookup stays exactly as it is: the identity provider
establishes *who*, and this application's own `User` table establishes *what
they may do*.

## What we need from you

### 1. Protocol and endpoints

Either:

**OIDC** — issuer URL, client ID, client secret, and confirmation that the
authorization code flow with PKCE is permitted.

**SAML 2.0** — IdP entity ID, SSO URL, IdP signing certificate, and the
NameID format. We will supply our SP entity ID, ACS URL and metadata.

### 2. Redirect URIs to register

- Production: `https://<host>/api/auth/callback/<provider-id>`
- Staging, if one exists: the same path on the staging host

We will confirm the final host before you register anything.

### 3. Attributes

| Attribute | Required | Used for |
|---|---|---|
| Email address | **Yes** | The sole identity key. Must be stable and institutional. |
| Display name | Preferred | Shown in the interface and on handoff packets. |
| Group, affiliation or `eduPersonAffiliation` | Preferred | Distinguishing trainees from faculty on first sign-in. |
| Training program or department | Optional | Pre-filling a new user's program. |

**We do not need, and do not want:** employee ID, national identifier, date of
birth, home address, telephone number, photograph, or any clinical
credentialing attribute. Please do not release them. Every additional
attribute is data this system would then be accountable for.

### 4. Provisioning model

Confirm which of these the institution prefers:

- **Just-in-time provisioning (our default).** A user who authenticates
  successfully and does not yet exist is created as a `trainee`, with their
  program inferred from the affiliation attribute where one is supplied. The
  chair promotes coaches and their successor.
- **Pre-provisioned only.** A user who authenticates but has no record is
  refused. This requires the institution to supply a roster and a process for
  keeping it current, including trainee arrivals each July.

Just-in-time is strongly preferred: a GME population turns over annually, and a
roster process that lags by a month means new interns cannot use the system
during the period they most need it.

### 5. Deprovisioning

Confirm the expected behaviour when someone leaves. Our default is to mark the
`User` record inactive rather than delete it, because deleting a user would
orphan the aim statements, data points and PDSA cycles they authored, and those
records are the registry's permanent history. An inactive user cannot sign in.

Tell us if the institution requires hard deletion, because that conflicts with
the permanence of the project record and needs a documented decision rather
than an implementation guess.

### 6. Session lifetime

Our default is an 8-hour session with a sliding refresh. Tell us if policy
requires shorter, and whether re-authentication must be forced on privilege
change.

## What happens until SSO exists

Production without SSO gates the entire application behind a single shared
passcode (`APP_PASSCODE`) set as an httpOnly cookie. This is workable for a
pilot and it is not acceptable as a steady state, for one specific reason: a
shared passcode produces no individual attribution, so the audit log records
which *session* acted, not which *person*. Every guarantee on the security page
that depends on knowing who did something is weakened until SSO replaces it.

The development role switcher is disabled in production entirely.

## What we will confirm back to you

Once we have the values above:

- Our SP metadata, ACS URL and entity ID (SAML), or our redirect URIs (OIDC).
- The exact attribute names we will read.
- A test account request, so the integration can be verified before trainees
  are pointed at it.

## Roles, for reference

Three roles, assigned within the application and not by the identity provider:

- **trainee** — resident and fellow physicians. Sees Ask, Projects, Charts and
  Pulse.
- **coach** — faculty QI coaches. Additionally sees Committee, and reads the
  restricted material of projects they are assigned to.
- **chair** — the committee chair. Sees everything, including named pulse
  responses and the audit log.

The read-visibility boundary between them is documented in `docs/SECURITY.md`.
