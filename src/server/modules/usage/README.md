# Usage

Current policy (2026-10-14): `APPLICATION_COST_LIMITS_ENABLED=false` removes
monthly, cumulative-funding and per-request monetary blocks. Usage preflight must
not recreate them or present an exhausted monetary allowance as a product quota.
Daily counts, media duration, storage capacity, authorization and verified provider
availability remain separate checks. See [current cost policy](../../../../docs/operations/COST-CONTROLS.md).

Authenticated counter reads and advisory preflight use the server clock and
owner identity. No private ciphertext is decrypted and no counter is changed by
a read. Daily units, pending storage, exact media duration and overlimit values
use the shared v2 contracts. Case metadata is checked against ownership and
tombstones again before returning it.

Preflight is not reservation. Workspace/file/job repositories atomically admit
the actual mutation. New cases consume at create commit, media at first actual
processing start, and visible AI at validated publication. Failure/retry keeps
the original operation/day and does not re-charge consumed units.

The usage route accepts no owner, role, timestamp, funding or quote input.
Missing trusted provider availability reports `ai_funding` in the
cost-limit-off mode; `monthly_budget` is retained only for explicitly capped test
configurations. Reads and deletion
do not require a paid dispatch. Shared router integration retains authentication,
consent, `no-store` and the production public gate.

Server-only `budgetProofs` binds the usage adapter to durable verified pricing,
funding and allocation IDs. It checks the active environment control, freshness,
fixed cost and old unresolved carryover without exposing provider ledger details.
Costs and carryover remain accounting observations and do not impose monetary
admission limits in the cost-limit-off mode.
Missing configuration remains unavailable; no browser proof activates paid work.

Authoritative contract: [domain lifecycle](../../../../docs/architecture/DOMAIN-LIFECYCLE.md).
