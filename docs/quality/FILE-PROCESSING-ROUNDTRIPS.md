# File-processing preparation and publication round trips

Reviewed 2026-10-15 KST. Refs #59, #71/P04. Base `2f73f8abc47a46d00fd0864c266404d2b79e5d5c`.

The canonical SQLite/AES test uses the real upload, job admission, execution ledger and
publication code with explicit offline R2/native adapters. It does not call an external
provider or claim a Cloudflare timing result. The fixture resumes execution between
extraction and interpretation and verifies original bytes, stored ciphertext/hash, stopped
physical writers and published extracted text.

| Canonical document | Before D1 calls / SQL statements | After D1 calls / SQL statements | Current authorization checks before / after |
| --- | --- | --- | --- |
| 1 page | 683 / 914 | 665 / 884 | 308 / 308 |
| 2 pages | 1214 / 1607 | 1184 / 1557 | 555 / 555 |

The change is limited to two repeated operations:

1. Artifact preparation reads job operation identity and reservation existence in one SQL
   snapshot. The subsequent source/revision/lease checks and reservation/blob CAS remain.
   This saves one call per new artifact: six calls for one page and ten for two pages.
2. File processing publishes the pending artifact and commits its derived reservation and
   logical-byte usage in one transaction. This saves a reservation lookup and a second
   batch per artifact. The original separate-commit method and stored-object replay path
   retain their existing behavior.

The combined publication retains the exact pending ciphertext/hash/bytes/key, source,
job/owner/lease/fence, consent, alive workspace, physical stopped writer and receipt-byte
predicates. Eligibility requires that the one pending artifact exactly matches the
reservation's logical bytes; the final CAS excludes every other live blob in that
reservation. This is equivalent to the old post-publication stored-byte sum. The batch
also requires its actual usage row and sufficient reserved bytes. It updates blob state,
usage and reservation state under the same claim. Derived reservations never update
original-file count/byte usage; the old no-op original-usage statement is unnecessary.

Tests revoke source/consent/owner/lease after the preparation snapshot or decryption,
replace ciphertext and byte counts, reject absent/insufficient usage, require the real
matching stopped-writer receipt, and verify one concurrent winner. Injected failures in
blob, usage and reservation updates roll back the entire batch. Existing physical-ledger
immutability rejects attempts to rewrite a stopped writer or its expected byte receipt.
No guards are cached or skipped, and cost observation, unknown transport recovery, physical
capacity and cleanup obligations remain intact. No schema or technical limit changes.

For the two-page fixture, extraction falls from 137/139 calls to 131/133, interpretation
97 to 94, unit preparation 96/120 to 93/117 and publication preparation 183 to 177.
Coverage staging, result publication and final publication counts are unchanged. These
are local method/statement counts, not network durations or D1 rows read. The reported
preview `3283811` PDF/WAV/PNG durations remain historical remote evidence; a new preview
measurement is required to establish elapsed-time improvement. The remaining 1184 calls
and 555 current checks for this fixture are not described as a solved latency problem.

## Dispatch follow-up

Base `1de0d785c080188eb7d6a97f6ba76dd161741e74` includes the changes above.
Each `current()` call already reads owner, operation/job/source, current policy and file
consent, revision and lease in one SQL snapshot. There are no internal round trips left
to combine in that function. This follow-up preserves every call and its position.

| Canonical document | Before D1 calls / SQL statements | After D1 calls / SQL statements | Current checks before / after |
| --- | --- | --- | --- |
| 1 page | 665 / 884 | 645 / 821 | 308 / 308 |
| 2 pages | 1184 / 1557 | 1148 / 1443 | 555 / 555 |

`dispatchExecution` previously read admission existence, created a guarded temporary
claim, updated the admission and removed the claim in a batch, then performed a fresh
receipt read. A single guarded `UPDATE ... RETURNING` now checks the same admission,
principal/owner, environment, operation, immutable runtime/target, current source, lease,
deadline and prepared state at its state transition. The separate fresh receipt read
remains unchanged. A late deletion or source/lease replacement denies a permit while
preserving evidence of the committed dispatch. This saves one D1 call and three SQL
statements per successful dispatch: 21 dispatches for one page and 38 for two pages.
The current totals also include the isolated optional maintenance-month observation:
one extra call for one page and two for two pages, with no extra SQL statements.

A zero-row update still reads existence. Only an absent admission can use the historical
priced route; an existing rejected or dispatched admission returns no permit. Historical
priced dispatch adds one unsuccessful D1 update before its original path. Neither route
changes admission payloads, scope/digests, transition/immutability triggers or unknown
transport recovery. Tests cover one concurrent winner, exact admission preservation,
before/after-CAS owner/source/lease/runtime/operation/deletion changes, SQL rollback and
post-commit response loss. Existing cross-route, scoped/unscoped model/GET, immutable
scope tampering and unknown/response recovery regressions remain covered.

The two-page profile before this follow-up also has 49 lease renewals, 29 checkpoint
reads, 42 stored-blob reads and 38 transport records. Transport records are durable
recovery evidence, including the rule that only a confirmed legacy GET response permits
a later scoped invocation; they cannot be dropped as optional financial metadata.
The later `prepareUnit` call resumes the immutable plan and reads its artifact count.
It does not repeat extraction or model interpretation. Reusing those results across
Workflow steps would change the existing recovery and fresh-check boundaries and is
outside this patch. No caches, skipped checks, timeout changes or retries are added.

These counts use offline adapters and do not establish remote elapsed-time improvement.
The remaining 1148 calls and 555 current checks are still a material latency concern.

### Asset fixture count reconciliation

On `8ebfbafcb2d551c860e51f7728821cf9630bea5b`, the same one-chunk JPEG asset fixture
uses **91 D1 calls / 120 SQL statements**, replacing the stale expectation of 93/129.
Its observed three guarded dispatches each save one call and three statements, while
all three fresh dispatch receipt reads remain. Separating the required maintenance
policy write from the optional monthly financial insert adds one call and no SQL:
`93 - 3 + 1 = 91` calls and `129 - 9 = 120` statements. The fixture observes each of
those two maintenance writes as a separate call; physical admission's separate guarded
policy write remains inside its original transaction.

The test still verifies 31 current checks, five original-source snapshots, three separate
consent reads, one native-adapter invocation and the real encrypted-output publication.
This corrects test expectations after already-merged changes; it changes no product code,
authorization boundary or limit and does not establish remote latency improvement.

## Preview location and latency observation

The preview runtime now observes its existing initial admission lookup, before the first
Workflow step. This is the same bounded `SELECT ... LIMIT 1`: preview uses `all()` once
and selects the first row's `attempt_id`, while production retains `first("attempt_id")`.
There are no added SQL statements, database writes, diagnostic endpoints or external
requests. Owner/runtime/operation predicates and all later authorization checks remain.

One `preview_file_runtime_d1` event is emitted per runtime entry (including a resumed
entry). Its fixed phase is `runtime_admission`. Fields contain only outcome, the await's
`wallMs`, D1 `sqlMs`, known D1 region, three-uppercase-letter D1 colo, primary status and
reported attempt count. Missing, malformed or unavailable metadata is `null`; a missing
clock is not reported as zero. Query text, parameters, result rows, identities and errors
are never logged. Metadata/clock/logger failures cannot change the original result or
exception. This is a first-call sample, not a full Workflow average. Wall time minus SQL
time also includes runtime, routing and queue overhead and is not pure network latency.

Cloudflare's [D1 metadata documentation](https://developers.cloudflare.com/d1/worker-api/return-object/)
defines SQL duration as excluding network time. Its [query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
and pinned runtime types also expose the database-serving colo. This observes the D1
callee; it does not reveal the Workflow execution colo. `request.cf.colo` describes the
[incoming request's data center](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties),
and Workflow events do not provide that request property.

[Worker placement](https://developers.cloudflare.com/workers/configuration/placement/)
documents fetch-handler scope, so enabling it is not evidence that Workflow steps moved.
The [2025-02-13 changelog](https://developers.cloudflare.com/workers/platform/changelog/#2025-02-13)
also removed automatic D1-binding colocation. Independently, the [Workflow create API](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/)
and pinned `WorkflowInstanceCreateOptions` support a best-effort `locationHint` for new
instances. No placement, location hint, replication, database creation or relocation is
changed here. The recorded preview DB region is APAC, but that alone does not establish
its exact colo or prove geographic round trips caused the observed latency.
