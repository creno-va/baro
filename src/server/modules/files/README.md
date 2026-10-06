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

Server composition supplies storage cost admission, a trusted byte-format probe
and processing enqueue. Missing admission/probe denies new writes/finalization;
the client cannot provide evidence or mark a file processed. The Worker currently
binds private storage; actual pricing/funding and the Container processor remain
#59/#71 work. Public profile assets use a separate binding and are never returned
by this private API. The public gate stays intact.

Failed writes retain a durable cleanup intent. Deletion revokes access immediately,
while R2 delete plus negative head and a current journal lease are required for a
blob receipt. Cleanup of a failed chunk preserves a live upload's reservation.
Full job-stop, reservation inventory and restore orchestration remain #67.
