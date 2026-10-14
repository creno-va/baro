# Budget

Current policy (2026-10-14): `APPLICATION_COST_LIMITS_ENABLED=false` means
**cost observation only**. See the [canonical policy and implementation status](../../../../docs/operations/PREBETA-COST-POLICY.md).
Do not reject, wait, freeze or fail a feature/deployment because of monetary
amounts, missing/stale pricing/FX/funding, monthly allocation/control, cost
approval/refresh, maintenance reservations, past estimate overruns, or cost-derived
IO counters (including the historical 50 GET/HEAD/DELETE reservations).
Do not restore these gates without a new explicit user instruction.

Preserve actual observations, prices, usage, receipts, estimates, unsettled costs
and holds. Missing/stale facts remain unknown/stale. Do not inflate funding or
rewrite checkedAt/validUntil to claim a fresh observation. Cost persistence or
reconciliation failures are separate operational observations and must not turn
a successful product operation into a failure. No default funding, fabricated
zero cost, new payment method or auto-recharge change is authorized.

Model receipt database failures emit a sanitized `model_cost_observation_failure`
diagnostic while preserving the dispatched hold and valid model output. Receipt
identity/CAS rejection, invalid output and actual provider failures still fail;
the observer does not manufacture a receipt or repeat the model call.

User quotas, physical byte/file capacity, authenticated ownership, signatures,
revision/CAS, fencing, leases, tombstones, actual runtime credentials, provider
errors and technical execution bounds remain enforced. The wire planner still
requires a real context/output bound and applicable vision capability; an expiry
inherited from billing metadata is not a model capability failure. Bytes alone
do not prove tokens. No model/resource call occurs in this module.

Accounting uses trusted evidence, exact decimal/rational arithmetic and original
attempt identities. Receipts contain bounded identifiers, metered quantities and
charge scalars, without prompt/file/output/token secrets. Unknown costs survive
timeouts and deletion; a late bill can be reconciled to the original price.
A committed dispatch cannot be refunded by treating an ambiguous call as unsent.

The historical allocation/proof/refresh records remain available for accounting.
Their absence, expiry or monthly rollover is not admission authority in the
observation-only mode. Physical reservations and job ownership guards remain
atomic. Cost bookkeeping must not reintroduce a product dependency through a
shared transaction or availability adapter. A synthetic verifier or local test
does not establish live funding or a provider invoice.

Authoritative operations: [cost observation](../../../../docs/operations/COST-CONTROLS.md).
