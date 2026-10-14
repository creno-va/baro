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

## Separate replay limitation

A synthetic workspace job was deleted, then the later profile namespace failed. On retry,
all namespaces were absent. A plain UUID runtime ID cannot distinguish that job from an
older random native process, so the unchanged legacy guard retains it with
`CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED`. The regression explicitly records this unresolved
boundary. A versioned named native job recovers because its native instance can be revoked
again. This primary fix does not claim to resolve unclassified historical replay.

Follow-up must use authoritative retained/capture evidence for the exact runtime and
journal, reject conflicting native evidence, and preserve quarantine when evidence is
absent. A successful deletion result lost before durable observation cannot be guessed
from subsequent absence.
