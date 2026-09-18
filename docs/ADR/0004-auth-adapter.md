# 0004 — Identity behind one function, SSO-ready

**Status:** accepted (phase 0)

## Decision

`lib/auth` exposes `getCurrentUser()`, `getCurrentUserOrNull()` and
`requireRole(...roles)`. Nothing else in the application reads a cookie, a
header or an environment variable to establish identity. Integrating SSO
replaces the body of one private function, `resolveUser`.

Development resolves the user from a role-switcher cookie or `DEV_USER_EMAIL`.
Production without SSO gates the whole application behind `APP_PASSCODE` as an
httpOnly cookie. The role switcher is disabled outright in production.

Read visibility is a separate concern, in `lib/auth/scope.ts`: the identity
provider establishes *who*, the `User` table establishes *what they may do*,
and one configuration object establishes *what they may see*.

## Why

The institution may mandate an internal identity provider, and that must be a
one-file change. Keeping roles in our own table rather than mapping them from
IdP groups also means the chair can promote a coach without filing a ticket
with the identity team — which matters in a population that turns over every
July.

## Rejected

- **Reading the session in each route.** Guarantees a route eventually forgets.
- **Deriving roles from IdP group claims.** Couples a committee's own
  appointment process to an institutional directory.
- **Shipping NextAuth in phase 0.** Configuring a provider we have no values
  for yet would produce speculative code. The seam is what matters now.

## Consequence

A shared passcode produces no individual attribution, so the audit log
identifies a session rather than a person until SSO lands. This is stated
plainly in `docs/SECURITY.md` rather than left to be discovered.

## Revisit when

The identity team supplies the values in `docs/SSO.md`.
