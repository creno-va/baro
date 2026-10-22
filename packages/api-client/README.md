# @baro/api-client

Shared JSON requests, safe public errors and wire clients for session/consent, cases/intake and the public
lawyer directory. Inject transport, UUID creation and optional body encoding. Web credentials
and multipart bodies belong to the browser adapter; native API origin and session storage
belong to native adapters. No global fetch, React, cookie configuration or environment reads
are allowed here.

Writes use the caller's exact key/body/revision. This layer performs no automatic retry.
Domain clients must preserve their operation key across ambiguous failures. A supplied session
scope fences late success/error/body decode results after identity changes. Feature models also
fence superseded UI loads. Server authorization remains authoritative.

`createSessionClient` shares concurrent reads only and returns fresh permission data on the next
settled read. Session transitions must invalidate its scope and discard owner-bound domain
instances. `createDirectoryClient` validates canonical filters/cursor and response schemas.
Malformed responses and untrusted server messages become safe public errors.

The web retains its existing facade/mock composition; mobile has no implicit mock fallback.
Workspace/files/reports and remaining domains are subsequent #335 extraction units.
Run `bun run clients:check`, `mobile:check`, and
the existing web/domain tests when moving a module.

`createCasesClient` owns its key/revision/schema knowledge per session instance. Inject the
operation requester, SHA-256 fingerprint/UUID, logical operation storage and cancellable
challenge port. Browser composition retains the existing facade, optional sessionStorage and
Turnstile dialog. Native composition must use `persistence: "required"`: a missing/unavailable
durable store cannot start a write. Only opaque keys, owner/revision metadata and input hashes
persist; editor text stays in the in-flight instance. Native storage adapters must encode/hash
logical keys to meet their OS key naming restrictions.

Same-input pending writes coalesce before async storage or challenge work. Ambiguous responses
retain the key and exact wire revision; another owner gets a separate key while the original
owner can resume the unresolved operation. Every HTTP boundary and final result checks the
captured session generation. Invalidate the stable app scope on auth/lifecycle transitions to
abort its HTTP/challenge work and recreate private domain instances.
An optional instance signal cancels a feature's work when it closes without granting or changing
session permissions. Use a fresh feature instance after that signal is aborted.
