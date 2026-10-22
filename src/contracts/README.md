# Shared contracts v1

`index.ts` is the import boundary for HTTP, DB, Workflow, adapters and UI. Do not
redefine case/analysis statuses, question/answer shapes or public result types in
downstream modules. The existing consent contract and development policy versions
remain compatible.

## Client workspace exports

`@baro/contracts` resolves directly to these canonical sources; it is private and
does not publish or copy schemas. `@baro/contracts/v1` exports `client.ts` public v1
contracts, and explicit `@baro/contracts/v2` / `@baro/contracts/v2/<module>` paths
expose v2. Bare `@baro/contracts`, internal `pipeline.ts` and unrestricted wildcard
exports are excluded from the client package. Use only named public subpaths.

The package `main` retains `index.ts` solely for existing relative directory
imports such as `../../contracts`. Without this separate legacy entry, the web
bundler can accidentally redirect server imports to the client barrel. Web callers
need not migrate their imports during the UI redesign. Both the production web
build and native Metro builds verify this resolution boundary.

Run `bun run contracts:check` for portable types and `bun run mobile:check` for
transitive public-export boundaries and contract identity/strictness tests.
`URL` and `TextEncoder` use portable Web API types, without Workers bindings,
React, DOM document/window or Node imports. Schema changes still require the
existing API compatibility review; package exports do not change wire semantics.

- `common.ts`: finite limits, code-point text normalization, UTC timestamps,
  calendar dates, UUIDv4 entity IDs, opaque child IDs, error/status/failure enums.
- `cases.ts`: strict admission/list/detail/status/answer/retry/deletion wire shapes.
  Request bytes are limited by the Hono body limiter; `MAX_REQUEST_BYTES` is 64 KiB.
- `questions.ts`: a single batch of up to five questions. Use
  `answersForQuestionsSchema(storedQuestions)` to check exact coverage and choice
  options in addition to the standalone request shape.
- `results.ts`: guidance/out-of-scope/urgent union, finite presentation fields,
  official citation metadata, reference integrity and server link allowlists.
- `pipeline.ts`: versioned minimization, screening, attributed facts, retrieval
  and validation outputs. A failed validation has no sanitized result.

`resultSchema` validates a stored/wire result shape, not legal truth. At generation
validation, use `resultForAllowlistSchema({ citations: verifiedCitations,
helpLinks: approvedServerLinks })`. Passing an empty citation allowlist rejects all
citations. Never populate either allowlist from model output. The factory compares
every citation field, including source ID, date, URL and hash. Semantic support for
a claim, raw source content hash verification and prohibited-output evaluation
remain the citation/policy modules' responsibilities (#14/#15/#18).

Generation citation and policy links default to empty allowlists until a verified source or approved server configuration
supplies exact label/URL pairs. The schema does not invent or approve help links.
Reason codes are finite: unsupported jurisdiction/case type or immediate danger/
urgent safety concern; screening additionally admits in-scope/clarification codes.

`tests/fixtures/contracts` contains synthetic contract examples only. The law name,
source ID and hash are invented and never represent live legal verification. They
must not be imported into product code or used as release evidence. #31 owns the
broader evaluation corpus and test adapters.
