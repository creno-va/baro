# AI harness repair — 2026-10-24

Scope: [#458](https://github.com/creno-va/baro/issues/458), separate
`codex/458-gemini-harness-repair` worktree. RN/authentication remain owned by the
mobile chat. Predecessors PR309 and PR306 are merged with successful Quality gates.

## Initial observations

- Frozen Bun1.4.0 installation and live work graph succeeded on base062bdcdf.
- Existing Gateway, HTTP transport, media and workspace pipeline tests:117 passed.
  These are synthetic adapters, not live Gemini acceptance.
- Public AI configuration endpoints reported ready for production57121d2 and
  previewf912441. Their readiness does not execute a model request.
- Local isolated probe could not deploy because this shell has no Cloudflare
  authentication. No model attempt was dispatched and no token was extracted from
  the existing browser login.
- The user confirmed that HomeTax, TheCheat, registry and DataHub credentials have
  not been issued. DataHub means <https://dataapi.co.kr/>. These services must not
  claim successful lookup using simulated responses.
- Workspace context currently reads at most the first8 material observations;
  later pages, video frames and transcript intervals need a bounded retrieval path.

## Manual live observation

`ai-synthetic-readiness.yml` uses the existing preview Environment credential and
requires the exact current main SHA, successful CI and explicit
`single-synthetic-probe` input. It is separate from automatic CI and full validation:
neither invokes paid models. This manually requested external acceptance runs the
isolated Worker with no application DB, R2, OAuth credentials or user cases.

The existing durable single-run/candidate limit (three total attempts), authenticated
request, source manifest, replay denial, logging/cache settings and synthetic prompt
are preserved. Reports add only finite provider category/HTTP status. They do not
contain provider messages, prompt text or model output. A failed/ambiguous run cannot
be reset by changing its source hash. It is not full feature or release evidence.

No cost metadata refresh or new provider/key is introduced. Actual provider
rejection and technical/security guards remain enforced.

## Bounded material reading

The model now receives initial observation windows and a positional catalogue,
rather than silently stopping at the first8 observations. It may request up to two
additional windows (32 observations each) from files already authorized in this
conversation. Current selections precede recent historical attachments. Deleted or
unavailable historical files are skipped; an explicitly selected unavailable file
still fails. The catalogue and context are private model inputs, not new HTTP fields.

Initial material input is bounded to192KiB; the extra read round retains at most
384KiB of complete excerpts. Excerpts are not cut into misleading partial quotes.
There is one material-tool round and at most one existing official-source round,
followed by independent audit: at most four generation/audit phases under the
existing20minute Workflow deadline. Each provider call retains its original retry,
timeout, admission and durable accounting limits. Large documents/videos can remain
partial; the prompt explicitly retains those unread ranges instead of claiming full
coverage. This is not a full-file review guarantee.

The reader rechecks owner, workspace, file revision/state, snapshot/ciphertext
pointers and the exact observation rows across decryption; user exclusions never
enter context. Multiple observations at one frame/page position remain separate
exact sources, including uncertain user edits. A quote from a later observation at
the same position is accepted, while a fabricated concatenated quote is rejected.
Date checking similarly considers separate observations and preserves ambiguity.

Prompt workspace2.3 changes the wire/evaluation identity. No public message DTO,
mobile package, schema migration or installed-app parser is changed. Local tests
cover later windows, excluded/corrected text, ownership/revision/deletion, continued
attachments, duplicate-position quotes/dates and tool loops. External Gemini/media
quality and deployed customer journeys still require their own observations.
