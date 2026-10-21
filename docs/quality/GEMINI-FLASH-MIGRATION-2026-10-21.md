# Gemini Flash migration verification — 2026-10-21

Scope: #305, ADR-0016, dedicated codex/305-gemini-flash-pipeline worktree. Existing approved UI main57a91de was integrated; #304/PR306 legal source changes are not included. No deployment or remote DB mutation was performed.

## Implemented contract

- Current text/audit/vision model: google/gemini-3.8-flash; generation/vision low, audit/validation medium. Whisper unchanged.
- Prompt v1.1.0 / workspace v2.2.0: concrete factual instructions/answer formats, neutral clarification of ambiguities/contradictions, unknown/skip preservation and no claim of complete understanding. Initial questions remain2×3.
- Cloudflare Chat Completions wire: singleton enum conversion, supported reasoning, no OpenAI store flag, content_filter treated as refusal without schema retry. Model output is private until all existing checks pass.
- Model-bound technical configuration uses the separately observed documentary capability; historical GPT costs/funding/dates are unchanged. New plan model identity prevents cross-model pricing in both directions; missing details remain unknown/incomplete.

## Local evidence

Bun1.4.0 bun ci completed. validate:quick (docs/boundaries/lint/typecheck +19 required tests), validate:build (production/bundle/Worker dry-run) and validate:db (drift/fresh/file-import/upgrade replay) passed.

- Focused model/schema/ledger/evaluation tests:305 passed across15 files.
- File/preflight/calendar/retry/cleanup/storage tests:94 passed across6 files.
- Independent native workerd/D1 runtime tests:2 passed, including both cost modes and intentional provider rejection.
- Validation-selector harness tests:17 passed, including current model/capability paths.
- Fixed offline evaluation: v1 50 fixtures / v2 60 scenarios, zero deterministic critical findings.

The initial broad bun test run was stopped after selector timeouts during concurrent cold validation. A combined native run also exited with a Windows Bun ERROR_ABANDONED_WAIT_0. Native and focused suites above subsequently passed in separate processes; this is not a claim that the entire repository suite passed. Cleanup fixture provenance timing was isolated: SQLite wall time does not follow Bun mocked Date. Synthetic admission is now explicitly before its deletion journal; future-row/identity/CAS guards remain tested.

## External evidence still separate

These are scripted/synthetic/offline results, not actual Gemini response quality, speed, account acceptance or privacy/retention evidence. No live provider request was made. The changed corpus/wire hashes prevent reuse of prior model receipts. Independent human review includes concrete_clarification and uncertainty. Final integrated main full validation, same-SHA preview smoke and production approval/release remain the existing coordinated release process. #305 remains referenced until its external evidence is recorded; no external gate is declared complete.
