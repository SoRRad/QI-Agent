# 0005 — Aim statements and measure definitions are append-only

**Status:** accepted (phase 0)

## Decision

`AimStatement` and `MeasureDefinition` rows are never updated. A change
inserts the next `version`. Enforced by database triggers (migration
`hard_guarantees`), not by application convention.

`MeasureDefinition` permits exactly one post-insert mutation: recording that
the user confirmed the plain-language restatement matches their intent. Nothing
that changes the definition's meaning can be updated.

A superseded library measure is marked `deprecated` with `supersededById`
rather than edited, and charts built on it carry a banner naming the change and
its date.

## Why

An older aim explains what a chart meant at the time it was plotted. An older
operational definition explains what the numbers counted. Editing either
silently rewrites the past: the chart still renders, the numbers still look
plausible, and the claim they support has quietly changed.

This is most dangerous for shared library definitions. If the committee revises
"readmission" in place, every program's historical chart changes meaning with
no visible event. That is how an institution loses the ability to compare
anything, and it happens in year two, long after anyone would connect it to a
schema decision.

## Why triggers rather than application code

Application code gets refactored. A trigger does not quietly stop applying.
`tests/db/guarantees.test.ts` asserts the triggers fire, so a future migration
cannot drop one and leave the guarantee documented but absent.

## Rejected

- **Mutable rows plus a separate history table.** Two sources of truth, and the
  history table is the one that gets forgotten in a hotfix.
- **Soft delete plus insert.** Same effect with more states to reason about.
- **Application-level guards only.** Not enforcement.

## Consequence

Reading "the current aim" means taking the highest version, so query helpers
must do that consistently. Seeding and tests must insert versions rather than
update rows.
