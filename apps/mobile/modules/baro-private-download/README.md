# Private native disk transfer

Native disk transfer for #361. The original/report composition consumes it after producer
PR370 exact iOS/Android compilation and shared original port PR374 were merged. Successful
HTTP bytes do not enter an Expo fetch byte-event queue or a JS Response body.

The Android core uses the app's pinned RN OkHttp with no cookie jar/authenticator, redirects,
HTTP retry or disk cache. It copies/decompresses into an app-private file using 64KiB and
incremental SHA256. The Apple core uses an ephemeral URLSession download task, no cookie or
credential storage, and rejects redirects. The OS temporary file is moved into private cache
and hashed with a 64KiB read buffer. Each transfer supports GET/JSON POST, explicit headers,
a decoded byte maximum, bounded HTTP error metadata and cancellation. Native errors do not
export request values, low-level errors or stacks.

The package/bundle identifier fixes the permitted origin: `site.baro.app.preview` only
preview.baro.site, `site.baro.app` only baro.site, and `site.baro.app.dev` only local/private
network origins. Native validation also rejects userinfo, fragments, non-API paths, unsafe
normalization and unexpected credential headers. The JS credential frame remains the only
cookie writer: the consumer accepts returned Set-Cookie only through its captured current
frame, then discards that header before publishing artifact metadata.

`reserve` registers synchronously before `download`; cancellation cannot overtake registration.
`release` waits for native IO to end and unlinks the temporary file. A process-wide registry
survives React runtime reload; each module instance cancels only its own jobs on destruction,
and new-runtime `clear` drains old jobs before removing recognized orphan files. Failed cleanup
is retryable. The module never clears unresolved server operation keys/holds.

The bridge returns `fileId`, byte count, digest, MIME/HTTP metadata and the observed copy window.
It returns neither URI nor binary/base64 data. Only bounded non-success JSON/text error metadata
crosses the bridge. A consumer borrows the fixed `baro_native_transfers/<fileId>.bin` under the
app cache. It moves it to owned private cache, compares actual size and a separate pinned SDK
native streaming SHA256 readback (64KiB), and binds the adopted handle to the lease signal.
Reset waits for native transfer, asynchronous move and readback IO before unlink. Report
signature/bounded HTML text checks remain separate validated reads from the private file. The temporary path is released even on success. No caller filename
or server URL becomes a filesystem destination. No SDK-byte fallback or size reduction is
allowed when this native module is unavailable.

Profile asset upload producer:

- Optional `upload` takes only a UUID source name, expected byte length/hash and sealed HTTP
  headers. It fixes PUT to `/api/v2/me/lawyer/assets/<opaque ID>/content`, requires positive
  If-Match and application/octet-stream, and preserves the existing 100MB limit.
- The app ID/origin selects `baro_<environment>_private_uploads` under app cache. No caller URI,
  arbitrary source directory, symlink or traversal is admitted. A native 64KiB copy into an
  exclusive private `<transferId>.upload` validates actual size and SHA256 before HTTP dispatch.
- Android sends the staged file with a one-shot bounded OkHttp RequestBody. Apple uses an
  ephemeral URLSession upload task from the staged file. Its serial native data delegate caps
  response JSON/error bytes at 64KiB; it does not accumulate response Data in a completion handler.
- Cancel/release/clear wait for staging, request/file IO and response completion before unlinking
  `.upload` and `.bin`. Caller source files remain owned by the source adapter; its lease must
  stay alive until the native operation ends. Startup removes only canonical UUID files with
  these recognized suffixes and preserves unexpected files.
- `createNativeDiskJobs().runUpload` shares the download epoch/cleanup registry, snapshots input
  before awaits and returns only a bounded response file lease. `supportsUpload` detects older
  development apps; missing upload capability fails before reservation without a JS fallback.

The common source upload port was merged in PR377. Actual source leases, captured credentials,
private asset response parsing and RN profile UI consume this producer only after its exact
two OS CI/main integration. No actual app/device/provider acceptance is claimed here.

Verification:

- `bun run mobile:check` resolves the real SDK autolinker and checks the pure job/abort/cleanup port.
- `bun run mobile:native:probe` on macOS compiles this exact Swift core and transfers synthetic
  100MB/1GB from a local HTTP server, matching independent JS SHA256 and recording peak RSS,
  copy window, redirect/cookie/gzip/cancel/error/orphan behavior. It uses no provider credentials.
- The native-module PR workflow compiles both app platforms; Android JUnit runs this exact core
  with a 128MiB JVM heap and synthetic HTTP bytes. Apple runs the same macOS core probe.
- Both native cores additionally upload 100MB to an independent streaming HTTP receiver and
  compare its actual byte count/hash. They test source corruption, path/symlink/size rejection,
  cancel/clear, redirect, bounded responses and preserved caller sources. Apple records RSS;
  Android records the 128MiB heap. These are core tests, not React Native IPC/device evidence.

Core probes, app compilation, actual iOS/Android runtime memory and app/API/provider acceptance
are separate evidence. The native module is included by the SDK's local-module autolinker;
no new package version, cloud provider, storage, payment, server schema or web UI is introduced.

The Apple resource bundle declares C617.1 for metadata of its own app-container files, following
[Apple's required-reason API reference](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype).
This technical API declaration does not replace the app-wide M8 privacy/store review.
