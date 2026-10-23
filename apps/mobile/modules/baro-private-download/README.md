# Private native disk transfer

Producer for #361. This module is not yet consumed by the original/report composition; the
consumer must be integrated only after the exact PR native compilation succeeds. Current
Expo fetch byte-event downloads do not establish a bounded end-to-end JS network queue.

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
cookie writer: a future consumer must accept returned Set-Cookie only through its captured
current frame, then discard that header before publishing any artifact metadata.

`reserve` registers synchronously before `download`; cancellation cannot overtake registration.
`release` waits for native IO to end and unlinks the temporary file. A process-wide registry
survives React runtime reload; each module instance cancels only its own jobs on destruction,
and new-runtime `clear` drains old jobs before removing recognized orphan files. Failed cleanup
is retryable. The module never clears unresolved server operation keys/holds.

The bridge returns `fileId`, byte count, digest, MIME/HTTP metadata and the observed copy window.
It returns neither URI nor binary/base64 data. Only bounded non-success JSON/text error metadata
crosses the bridge. A consumer borrows the fixed `baro_native_transfers/<fileId>.bin` under the
app cache, must move it to the owned private cache and bind the adopted handle to the lease
signal before returning. The temporary path is released even on success. No caller filename
or server URL becomes a filesystem destination. No SDK-byte fallback or size reduction is
allowed when this native module is unavailable.

Verification:

- `bun run mobile:check` resolves the real SDK autolinker and checks the pure job/abort/cleanup port.
- `bun run mobile:native:probe` on macOS compiles this exact Swift core and transfers synthetic
  100MB/1GB from a local HTTP server, matching independent JS SHA256 and recording peak RSS,
  copy window, redirect/cookie/gzip/cancel/error/orphan behavior. It uses no provider credentials.
- The native-module PR workflow compiles both app platforms; Android JUnit runs this exact core
  with a 128MiB JVM heap and synthetic HTTP bytes. Apple runs the same macOS core probe.

Core probes, app compilation, actual iOS/Android runtime memory and app/API/provider acceptance
are separate evidence. The native module is included by the SDK's local-module autolinker;
no new package version, cloud provider, storage, payment, server schema or web UI is introduced.

The Apple resource bundle declares C617.1 for metadata of its own app-container files, following
[Apple's required-reason API reference](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype).
This technical API declaration does not replace the app-wide M8 privacy/store review.
