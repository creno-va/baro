# Private files

`createFilesService` uses the shared D1 repositories and the private R2 port only.
The API authenticates the SQL session, origin and consent before consuming binary
parts. JSON requests retain the 64 KiB limit; an authorized part is bounded to
8 MiB from actual streamed bytes, independent of Content-Length.

Every file has a wrapped data key. Each part has an independent nonce and binds
its environment, owner, file, upload revision, ordinal and byte count. The binary
header is encrypted with the existing envelope cipher and bound to the payload.
Only opaque object keys and ciphertext are written to private R2. Exact R2 write
key/size and the durable pending intent must match before the atomic part receipt
can publish. The original manifest validates ordered parts and incremental SHA-256
without retaining the whole file. Download rechecks current access per part.

The first part's encrypted receipt may retain the server-produced wrapped data
key. Subsequent uploads authorize and decrypt that receipt instead of retrieving
and decrypting the first 8 MiB again. Legacy receipts without the optional key
use the original full verification path. The final probe still reads and verifies
every byte before publication; downloads still verify both ciphertext and content
hashes, AEAD identity and current access after decryption. Download's first part
and provenance lookup share one indexed query, and its header is decrypted once.
No key is added to public DTOs, logs or unencrypted storage. A rollback must retain
the optional receipt reader for files written by this version.

Server composition supplies physical storage admission, cost observation, a trusted byte-format probe
and processing enqueue. Missing admission/probe denies new writes/finalization;
the client cannot provide evidence or mark a file processed. The Worker currently
binds private storage; actual Container processing remains #59/#71 evidence work.
Under [cost observation only](../../../../docs/operations/PREBETA-COST-POLICY.md), missing/stale
pricing/funding, monthly cost projection, refresh and historical IO50 reservations
must not block upload/read/download/delete. Physical capacity, writer/lease,
ownership/signatures and actual provider errors remain. The canonical document
separates current deployment from the new implementation and bootstrap remainder. Public profile assets use a separate binding and are never returned
by this private API. The public gate stays intact.

An explicit native Office input/protection refusal is distinct from a failed probe
transport. Only the bounded, strict `office_input` refusal receipt can become
`DefinitiveFileRejection`; ordinary 422 responses, protocol faults, timeouts and
authorization changes cannot. The inline probe lease records a verified refusal
as optional `uploadRejection: FILE_REJECTED` in the existing encrypted file
metadata, fenced by the same owner, upload, file metadata, lease, current consent
and requesting session. This does not finalize or fail the upload, release its
storage/paid reservations, erase original parts, or create an original manifest.
Fresh list/session reads preserve the refusal so the UI requests a corrected file
and stops polling that terminal admission result. Unclassified legacy pending
uploads retain conditional interrupted-transfer recovery; no refusal is inferred
from missing results. Other processing failures remain retryable and retain the
same upload identity. A corrected file gets a new reservation.

Unversioned completion retains strict workspace CAS and explicit conflict recovery.
The web adapter opts in to `x-baro-upload-consistency: file-target-v1`. Only that
version may use the fresh post-probe workspace revision after revalidating the same
file/upload revision, operation, reservation/bytes, current consent and requesting
session, plus unchanged workspace status/job/intake/confirmed summary. The request's
entry CAS and the final atomic file/workspace/part guards still apply. Unsupported
versions fail before probing. The version does not authorize processing or replace
format/byte verification. Existing clients send no new header or DTO fields.

Failed writes retain a durable cleanup intent. Deletion revokes access immediately,
while R2 delete plus negative head and a current journal lease are required for a
blob receipt. Cleanup of a failed chunk preserves a live upload's reservation.
Full job-stop, reservation inventory and restore orchestration remain #67.
