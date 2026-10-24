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
## Live baseline and response boundaries

[Manual run40067350279](https://github.com/creno-va/baro/actions/runs/40067350279)
on exact mainaf42d0e passed screening in one provider attempt,5091ms,430input/
25output tokens. [Finite original observation](./ai-harness-2026-10-24/screening-af42d0e.json)
retains its actual timestamps and provenance; the workflow artifact retains the
source manifest. It does not establish workspace question/audit/chat/media success.
The provider accepts the existing simple Chat Completions request; blanket model
unavailability is not established. Next probe uses actual workspace questions and
independent audit with synthetic input, preserving the three-total-attempt cap.

Response repair accepts the documented native Gemini envelope as well as the
existing Chat Completions envelope, without changing the selected model. Native
thought parts/signatures are excluded, safety refusal and truncated/function-call
responses cannot become final output, and an explicit Cloudflare success/result
wrapper is decoded. Vision and ASR use the same bounded raw HTTP decoder. Image
observations require a final stop and cannot publish partial JSON after truncation.
Native output metering includes thinking via total minus input; absent cache/tier
observations remain unknown. Invalid usage metadata remains an invalid receipt
instead of invalidating a schema-valid answer or triggering another paid correction.
No production failure cause is inferred from this offline compatibility repair.

## Reproduced independent audit failure

[Manual run40068379225](https://github.com/creno-va/baro/actions/runs/40068379225)
on exact mainca08250 generated questions successfully (5370ms,1605input/249output
observed tokens) and then failed workspace_audit with HTTP400/provider_request in
2158ms. [Original finite observation](./ai-harness-2026-10-24/questions-audit-ca08250.json)
preserves the failure and two attempts. No unchanged-condition retry was made.
This narrows the common failure to audit dispatch rather than basic generation or
its question schema. The original privacy-safe receipt does not establish the
provider's detailed rejection reason.

The targeted wire change preserves medium thinking, independent audit, output caps,
model identity and Gateway. It supplies Google's documented explicit thinking_config
instead of the OpenAI compatibility reasoning_effort for validation/audit; mutually
exclusive controls are never combined. include_thoughts=false prevents requesting
thought summaries. The next changed-condition probe must confirm the actual result.
Future HTTP failures can retain only a finite requestIssue (thinking configuration,
thinking/output limit, unsupported parameter or schema constraint), never the body.
Sources: [Google compatibility](https://ai.google.dev/gemini-api/docs/openai) and
[model thinking support](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

## Explicit thinking candidate did not resolve audit

[Manual run40069615300](https://github.com/creno-va/baro/actions/runs/40069615300)
on exact maindd73eec again generated questions (7192ms,1605input/245output)
and failed audit with HTTP400/provider_request (3199ms), two total attempts.
[Finite observation](./ai-harness-2026-10-24/questions-audit-dd73eec.json)
preserves the original result. Explicit thinking configuration is not a proven fix.
The first diagnostic read only error.message and missed wrapper descriptions/string
errors. Bounded traversal of known wrapper fields now retains a finite category,
including schema complexity, while discarding all original text.

Workspace audit/chat output schemas include Zod default annotations absent from
successful questions. The provider projection now removes these server-only
annotations while retaining all required properties and server validation. This is
a changed-condition candidate requiring external verification, not accepted success.
Google documents a supported schema subset and HTTP400 rejection for excessively
complex schemas: [structured output](https://ai.google.dev/gemini-api/docs/structured-output).
