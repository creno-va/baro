# Production review follow-up · 2026-10-27

Scope: #558. Landing code, assets and styles remain unchanged. External lookup APIs and stores remain on user hold; raw audit high2 and genuine legacy unknown records are preserved.

## Actual observations and implementation

- On production 4ab477d, the benign structured update failed the chat-text strategy guard. PR #561 keeps that guard and an independent audit, clarifies negated strategy instructions, and permits one newly admitted factual regeneration for the narrow structured-output case.
- Actual preview 405ef70 then passed generation but failed the independent audit with MODEL_SCHEMA_INVALID. [Read-only inspection 40473897481](https://github.com/creno-va/baro/actions/runs/40473897481) records generation 1099 output tokens, followed by two audit responses of 2383 tokens against the 2400 ceiling. The historical finish reason was not recorded, so token exhaustion is an inference, not recovered provider output.
- [Google's thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking) explains that thinking and visible output share the output envelope. The workspace audit now has bounded 8000-token headroom, retaining MEDIUM reasoning, strict output/policy/source checks, one schema correction and existing attempt/time/quota guards. This fits the existing 65536-token model capability and is the same scale as the retained validation envelope. New wire identities/admissions use the actual new ceiling; old plans, observations and holds are untouched.
- Finite schema-failure diagnostics retain only phase, reason, known top-level field and issue code. Completion text, nested paths, values, messages, stacks and provider identifiers are excluded. Incomplete or invalid responses remain unpublished.
- Actual preview summary and new report show the original question separately from unchanged quoted answers. Missing, ambiguous or older question references are not guessed; stored historical reports remain immutable.
- Actual preview help describes PDF download and review, matching the current UI. Historical ZIP APIs remain compatible.
- Actual preview PDF was acquired and all three A4 pages rendered and visually checked for Korean text, question context and clipping. It is a no-attachment synthetic case. The original production failure remains preserved; production PDF acquisition and the new audit ceiling's live acceptance are still pending.

## Verification boundary

Focused gateway/schema/terminal-receipt regressions passed (48 tests). Required quick/build, ledger/runtime regressions and fixed offline evaluations are being run for the implementation candidate; exact CI, final main full validation, same-SHA preview and production receipts are recorded in #558/#71. Prior candidate 405ef70 is held after its actual AI failure and must not be treated as repaired or as full/security acceptance.

## Follow-up after the 8000-token preview run

Read-only inspection 40477660853 shows that audit now completed with a valid structured verdict and rejected an unsupported timeline assertion based on the intake narrative. The historical rejected text is not retained, so its exact wording is not claimed. Prompt 2.7.2 explicitly distinguishes a reported occurrence from an agreed deadline and preserves unsupported date components as unknown. A sole critical unsupported-timeline finding with supported legal claims, no strategy and no unsupported fact IDs may use the existing single shared draft-correction slot. The fresh draft still passes every original source/content check and a new independent audit; a second failure stops, mixed critical findings do not enter this path, and lookup side effects cannot be repeated.

The first full run of 3863863 passed 4407 tests but stopped at two stale test expectations for the old audit ceiling. Update those expectations to the actual 8000 output / 1040576 input envelope; all other technical rejection assertions remain intact. New focused timeline/ceiling tests passed (131). Actual success and final release verification remain separate records in #558/#71.
