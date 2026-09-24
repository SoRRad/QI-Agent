# Architecture decision records

One short record per adapter and per architectural choice that would be
expensive to reverse. Each states the decision, why, what was rejected, and
what would make us revisit it.

| # | Decision |
|---|---|
| [0001](0001-scheduled-jobs.md) | Scheduled jobs run through a protected route, not a platform cron handler |
| [0002](0002-llm-provider-adapter.md) | One LLM interface, four providers, mock by default |
| [0003](0003-similarity-search.md) | Trigram recall plus LLM re-rank for duplicate detection; pgvector deferred |
| [0004](0004-auth-adapter.md) | Identity behind one function, SSO-ready |
| [0005](0005-append-only-records.md) | Aim statements and measure definitions are append-only |
| [0006](0006-pdf-rendering.md) | No headless Chrome in the runtime image; charts rasterised from the UI's own SVG |
| [0007](0007-data-store.md) | Prisma with an explicit driver adapter |
| [0008](0008-mail-adapter.md) | Mail behind an adapter, logging by default |
| [0009](0009-phi-chokepoint-in-the-database-client.md) | The PHI guard runs inside the database client |
| [0010](0010-spc-studio.md) | The SPC studio: URL state, frozen baselines, special-cause encoding, write-once reproducibility evidence |
| [0011](0011-projects-workspace.md) | Projects: intake blockers, owner and handoff, the prediction lock, stall signals, per-model PHI exemptions |
| [0012](0012-pulse.md) | Pulse: participation apart from responses, browser-held receipts, frozen surveys, paraphrase check, closed-only digest |
| [0013](0013-scholarship.md) | Scholarship: SQUIRE assembled from the record, a screening that cites policy or declares the gap, validated venues |
