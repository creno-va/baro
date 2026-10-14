# Usage

Current policy (2026-10-14): `APPLICATION_COST_LIMITS_ENABLED=false` means
cost observation only. Usage preflight must not turn monetary amounts,
missing/stale pricing/FX/funding, monthly allocation, cost approval/refresh or
cost-derived IO counters into a product quota or `ai_funding` blocker.
See the [current policy and implementation status](../../../../docs/operations/PREBETA-COST-POLICY.md).
Do not reintroduce a cost gate without a new explicit user instruction.

Authenticated counter reads and advisory preflight use the server clock and
owner identity. No private ciphertext is decrypted and no counter is changed by
a read. KST daily AI200, case counts, media duration, physical storage capacity,
authorization and actual provider/runtime capability remain separate checks.
Case metadata is checked against ownership and tombstones before returning it.

Preflight is not reservation. Workspace/file/job repositories atomically admit
the actual product mutation. New cases consume at create commit, media at first
actual processing start, and visible AI at validated publication. Failure/retry
keeps the original operation/day and does not re-charge consumed units.

The usage route accepts no owner, role, timestamp, funding or quote input.
Historical `monthly_budget`/`ai_funding` codes do not authorize cost blocking.
Missing runtime binding/credential or an actual provider/capability error remains
a technical unavailable state; an unavailable billing observation is not proof
of that error. Reads/deletion do not require cost admission or manual refresh.
Authentication, consent, `no-store` and the production public gate remain.

Server-only cost proof/carryover records are observations. Preserve their
timestamps, amounts and unknown/stale state without exposing ledger details to
the browser. Cost observation errors must not block usage reads or actual
product work. No browser proof activates paid work.

Authoritative contract: [domain lifecycle](../../../../docs/architecture/DOMAIN-LIFECYCLE.md).
