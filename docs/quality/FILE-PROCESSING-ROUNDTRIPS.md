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
