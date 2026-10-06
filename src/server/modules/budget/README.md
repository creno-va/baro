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

Canonical schemas and pricing/receipt arithmetic come from the merged shared
runtime DB contract. `createGatewayBudgetService` prepares a branded hold for the
job repository's atomic admission. The caller uses the returned captured actor
with that batch; dispatch uses a fresh server clock and current job/fence guard.
`createLedger` binds the actual Gateway metadata to the original complete-wire
and token-bound evidence. Retry/correction reserves a separate actual attempt;
restored initial holds retain the same immutable evidence and skip double holds.
Unknown costs survive timeout and deletion. Only the DB's prepared/tokenless CAS
can confirm a `release_candidate`; a committed dispatch cannot be refunded locally.

The planner receives exact identity from the shared Gateway wire builder. It
requires an authenticated tokenizer/framing or model-context upper bound, plus
vision capability/dimension evidence when applicable. Bytes alone never prove
tokens. Missing verifier/pricing/funding/FX/coordination denies paid execution.
`createPaidAvailability` connects those durable proofs and current control to
usage display, including previous-month unresolved carryover. The final mutation
still reserves actual capacity atomically. No model/resource call occurs here.
A synthetic verifier is not live funding or a provider invoice. Environment-local
circuit snapshots are not global 1M KRW ledger snapshots.

No bundled price, fixed FX, default funding, payment setup or auto recharge is
provided. Actual billing/console reconciliation remains #71.

Authoritative contract: [cost controls](../../../../docs/operations/COST-CONTROLS.md).
