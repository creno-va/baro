# @baro/api-client

Shared JSON requests, safe public errors and wire clients for session/consent and the public
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
Cases/workspace/files/reports and remaining domains are subsequent #335 extraction units,
not claimed complete by this initial package. Run `bun run clients:check`, `mobile:check`, and
the existing web/domain tests when moving a module.
