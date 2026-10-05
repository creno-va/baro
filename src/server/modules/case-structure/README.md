# Durable analysis execution

The Worker Workflow persists only analysis references and fixed status strings in step output. All model outputs, questions and per-phase reservations are stored in encrypted D1 `encrypted_context` version 1. Parameters remain compatible with the existing `{analysisId,inputRevision}` dispatch contract. Unknown checkpoint versions fail closed; no fixture or provider fallback runs in production.

Before each external model attempt the checkpoint CAS consumes its durable phase budget (three including schema correction). Schema correction has an independent one-use reservation. Output checkpoints are reused after replay, and transitions recover when a crash occurs between checkpoint and state commit. Explicit user retry creates a new bounded attempt (at most three total), after confirming the prior Workflow instance is terminal. The same analysis/revision remains current; old attempt guards cannot write. Each attempt has a fresh ten-minute execution budget. A minute scheduler handles process death and clarification expiry.

External success and D1 checkpoint commit are not atomic. A crash in between can incur duplicate cost, bounded by durable reservations and Gateway spend limits. `exactly once` provider billing is not claimed. Workflow retries are disabled for model phases; adapters own bounded transient retries. A user retry deliberately authorizes a fresh attempt budget.

Official law HTTP requests additionally reserve a durable budget by fixed list/article reference before each transport attempt. Each reference permits at most three calls across adapter retries and Workflow replay, so the budgets do not multiply after a checkpoint crash. Model/law calls are refused when the remaining execution window cannot accommodate their60s/10s timeout. Unknown checkpoint versions fail closed as non-retryable schema failures.

Answers authenticate, require current consent and abuse allowance, then validate ownership, current questions/options, revision, waiting state and the 24h deadline. The new case revision/input, superseding old analysis/answers, new analysis/outbox and replayable 202 are one D1 batch. The event contains only the new analysis reference; delivery failure cannot undo the admission or lose its outbox.

Validated result/citations and terminal case/analysis state commit together. Owner/current revision/attempt/status guards and cascading foreign keys prevent resurrection during deletion. Output provenance checks compare quoted user facts with the locally masked original; model validation additionally audits semantic claims and official citation support.

Offline tests exercise real auth/consent, SQLite-backed D1 transactions, encrypted checkpoints, the pinned gateway wire/schema boundary and captured official law responses. They do not prove live model quality, actual provider authentication or platform Workflow timing. Live smoke/evaluation remains #27/#18; no production gate is bypassed.

Workflow API reference: https://developers.cloudflare.com/workflows/build/workers-api/ (checked 2026-10-05).
