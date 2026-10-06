# Usage

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
Missing trusted paid availability reports `monthly_budget`; reads and deletion
do not require a paid dispatch. Shared router integration retains authentication,
consent, `no-store` and the production public gate.

Server-only `budgetProofs` binds the usage adapter to durable verified pricing,
funding and allocation IDs. It checks the active environment control, freshness,
fixed cost and old unresolved carryover without exposing provider ledger details.
Missing configuration remains unavailable; no browser proof activates paid work.

Authoritative contract: [domain lifecycle](../../../../docs/architecture/DOMAIN-LIFECYCLE.md).
