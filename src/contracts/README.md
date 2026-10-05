# Shared contracts v1

`index.ts` is the import boundary for HTTP, DB, Workflow, adapters and UI. Do not
redefine case/analysis statuses, question/answer shapes or public result types in
downstream modules. The existing consent contract and development policy versions
remain compatible.

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
