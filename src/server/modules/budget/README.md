# Budget

Quote inputs come from trusted server dependencies. Pricing, FX, fees, funding,
execution bounds and hidden retries are bound by an immutable proof digest.
Money uses decimal strings and exact rational arithmetic; reservations round up
to integer KRW. Actual receipts omit the reservation safety margin and preserve
overruns. Missing/stale proof or an unsupported free allowance fails closed.

Receipts contain only bounded identifiers, metered quantities and charge scalars.
They are persisted before output validation, including refusal/invalid output.
Unknown or incomplete usage retains exposure. Only definitively unsent calls may
release; expired proof/account deletion does not discard a late verified bill.

The calculation/advisory layer does not dispatch a model or activate a cloud
resource. Persistence/dispatch adapters must use the shared runtime DB contract
after its prerequisite PR is merged: atomic job+quota+cost admission, current
target/fence dispatch, authenticated proof verification, durable receipt CAS,
carryover and environment allocation controls. A callback returning `true` in a
test is not live funding or a provider invoice. Environment-local circuit
snapshots are not global 1M KRW ledger snapshots.

No bundled price, fixed FX, default funding, payment setup or auto recharge is
provided. Actual billing/console reconciliation remains #71.

Authoritative contract: [cost controls](../../../../docs/operations/COST-CONTROLS.md).
