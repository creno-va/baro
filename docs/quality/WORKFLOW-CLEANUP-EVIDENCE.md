# Workflow cleanup receipt contract

Reviewed: 2026-10-15 KST. Refs #67, #71. Preview-only investigation; production unchanged.

## Observed failure and primary change

The operator observed preview `3283811` natural cron at 04:15:16.197 KST:
`workflow_get`, namespace `file`, `instance_missing_marker`, error shape/name `error`/`Error`,
119 attempts and age 13,662 seconds. No raw provider message or resource ID was collected.
The marker establishes that a missing-instance phrase was present; it does not establish
which exact exception representation Cloudflare returned or prove an absence receipt.

All retained job IDs are checked in file, asset, workspace, profile order. Therefore the
first `file` failure does not identify the original job namespace. The old implementation
accepted only a thrown `Error` with exact message `instance.not_found`; a differently
wrapped absence response could keep the retained inventory pending indefinitely.

The reconciler now calls `deleteBatch([retainedId])` once per namespace. It accepts only:

- exactly one deleted entry for that ID and no errors; or
- no deleted entries and exactly one error for that ID, numeric code `10400`, and exact
  message `workflows.api.error.instance.not_found`.

Thrown errors, malformed/extra/duplicate/contradictory results, other IDs and any other code
or message preserve the pending target. No broad exception-message match becomes success.
Native revocation still precedes Workflow deletion. Every required namespace must finish
before the job receipt; unknown legacy native processes, physical writer checks, R2 HEAD,
lease fencing, retained inventory and unsettled holds keep their existing protection.

The [official Workers API](https://developers.cloudflare.com/workflows/build/workers-api/#deletebatch)
states that a successful batch deletion removes stored state and stops current execution
without rollback handlers, matching instance deletion. It returns failures with stable
per-instance codes and messages. The exact absent pair is covered by Cloudflare's
[pinned Workerd test](https://github.com/cloudflare/workerd/blob/v1.20261001.1/src/cloudflare/internal/test/workflows/workflows-api-test.js).

## Local validation and limits

- Unit checks cover exact IDs, missing/duplicate/contradictory results, wrong codes/messages,
  and thrown exact/wrapped/non-Error/hostile errors without plaintext error logging.
- SQLite integration retains pending inventory and holds on failures, verifies all namespace
  boundaries, native revocation, physical cleanup and isolated restore/replay contracts.
- The pinned Miniflare/Workerd test exercises create, batch deletion, repeated deletion and a
  never-created ID through the real local Workflow binding. This is SDK compatibility
  evidence, not an actual Cloudflare deletion receipt. Miniflare's `get()` implementation
  collapses every status failure into exact `instance.not_found`, unlike the public Workerd
  binding's direct exception forwarding; old local success did not prove remote compatibility.
- Actual preview recovery and physical deletion remain to be verified after deployment.

## Narrow workspace replay recovery

A synthetic workspace job was deleted, then the later profile namespace failed. On retry,
all namespaces were absent. A plain UUID runtime ID alone cannot distinguish that job from
an older random native process. The initial structured-delete change preserved that
quarantine; a separate follow-up adds a narrowly scoped identity proof.

The fallback is considered only after four exact absence results, for a workspace journal
with a pending captured job ID, current cleanup lease, workspace tombstone, and no live
workspace. It requires all of the following:

- The captured runtime is a UUID plus its runtime attempt suffix. Every retained admission
  for that exact runtime must be a workspace model job for the same job UUID, workspace,
  environment, and principal. Model-call attempts and runtime attempts are different
  counters and are not equated.
- The same journal must capture retained reservations/blobs belonging to exactly one
  non-null principal and owner, created no later than the journal. This independent owner
  anchor must match the admissions. Journals have no owner column, so the admission alone
  is insufficient for cross-owner verification after the workspace has cascaded away.
- Each bounded payload passes the existing strict request schema, matches its retained
  identity/operation fields, and reproduces the original canonical digest. Admission and
  verification times precede the journal. Migration 0016 prevents identity mutation and
  admission deletion; the original insertion atomically binds owner, operation, job, and
  runtime under the admission claim. The digest covers the request; runtime and principal
  identity are protected by that insertion and immutability, not by pretending they are
  fields of the hashed request.
- Any missing, oversized, contradictory, native, or unknown admission fails the proof.
  Old priced plans/holds for that job also retain quarantine: those records do not bind
  an exact runtime, and this fallback does not infer their classification.
- The current lease and independent owner anchor are checked again after asynchronous
  hashing. The existing final receipt CAS remains required.

This evidence classifies historical identity only. It is not a stop, provider, settlement,
or physical deletion receipt. Expired model deadlines do not expire identity history; a
fresh cleanup lease is still required. Native presence in the current sweep cannot be
overridden by this proof. R2 absence, physical writer fencing, holds, inventory and receipt
guards are unchanged. No migration, raw-error logging, or cost freshness gate is added.

Synthetic integration uses the real workspace/admission/deletion repositories with SQLite
and explicit Workflow/R2 adapters. It verifies recovery after both a resolved deletion
followed by a later namespace failure and a lost deletion response; it also rejects forged
hashes, other owners/workspaces/environments/runtimes, unknown/native records, postdated
admissions, missing capture/tombstone, and a lease or owner lost during proof checking.
Immutability and retained admission contents are checked. These are local tests, not
Cloudflare deletion receipts.

Account/profile journals, text-only workspace journals without captured storage ownership,
no-admission legacy jobs, and mixed priced history remain quarantined with
`CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED`. Versioned named native jobs keep their existing
revocation path. Actual preview recovery still requires deployment and observation; this
change does not claim that the reported remote journal satisfies the narrower proof.
