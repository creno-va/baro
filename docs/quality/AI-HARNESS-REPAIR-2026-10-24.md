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

## Native audit transport candidate

[Manual run40070563340](https://github.com/creno-va/baro/actions/runs/40070563340)
on exact main01cf84b still failed audit HTTP400 after questions succeeded
(7546ms,1605input/244output); audit1783ms, two attempts. The
[original receipt](./ai-harness-2026-10-24/questions-audit-01cf84b.json) is retained.
Default annotation removal is not an established failure cause. The GenerateContent
reference explicitly describes defaults as ignored documentation annotations.

Audit/validation now send native GenerateContent contents/systemInstruction,
generationConfig.responseMimeType/responseJsonSchema and thinkingConfig MEDIUM
through the same Cloudflare binding and Gateway. The existing independent audit,
server schema, output caps, lease/admission and model identity remain. Exact wire
identity hashes the native bytes actually dispatched; the canonical private planner
retains its schema/output budget fields. Generation/vision stay on the already
accepted Chat Completions wire. No runtime fallback retries another format. A new
changed-condition manual probe is still required. HTTP error text may be non-JSON:
a bounded text body is classified and discarded, never emitted as an error cause.

Sources: [Cloudflare native binding](https://developers.cloudflare.com/ai/models/google/gemini-3.8-flash/),
[GenerateContent configuration](https://ai.google.dev/api/generate-content).

The same candidate avoids positive maxItems grammar expansion for nested arrays,
as recommended in Google's structured-output complexity guidance. Existing server
Zod bounds (including questions2×3 and audit findings30/IDs300), output token caps,
required fields, closed objects and zero-item constraints remain unchanged. This is
provider grammar projection, not authorization to publish larger arrays. The
specific original HTTP400 cause remains unproven pending live verification.

## Actual native audit accepted

[Manual run40072018097](https://github.com/creno-va/baro/actions/runs/40072018097)
on exact main83f6972 passed actual workspace questions plus independent audit in two
attempts. Questions6659ms/1587input/260output; audit7149ms/2368input/733output.
[Finite receipt](./ai-harness-2026-10-24/questions-audit-83f6972.json) retains the
actual observations. This accepts the combined native-wire/grammar-projection
candidate; it does not isolate one original HTTP400 cause or prove summary/chat,
media, production serving, user-specific quality or external-provider acceptance.
Final offline c90d47c quick151/full3866/build/workerd and exact CI40071608812 passed.

Protocol3 adds seven fixed feature cases (questions, summary, chat, media and three
external-tool groups). Each
exact candidate/feature has one durable run with at most three attempts (all-seven matrix: at most21 total); source-hash
changes, replay, ambiguous POST or redeployment cannot reset that run. Selected case
is part of provenance/control/authenticated forwarding and source identity. Automatic
CI/full still never invokes a model. Manual dispatches serialize deployments of the
isolated worker. Image/WAV assets are locally authored/TTS synthetic fixtures with
exact tracked-byte hashes, not user files. Media reports retain only latency, finite
quality/segment-count and marker-match checks, never observed text or audio. Missing
ASR confidence/timing remains low_quality; the probe must not invent it. There is no
application DB/R2/OAuth or external4API credential in this isolated campaign.

## Tool publication and feature campaign

The follow-up combines the validated private tool-result producer and web cards
with the manual acceptance selector. Existing strict installed-client messages
remain unchanged; only the separate owner-checked endpoint exposes encrypted stored
results. Readback rechecks the workspace/row after AES and account changes abort web
requests. Desktop/mobile cards passed real Chromium/axe and were visually inspected.
No database migration, mobile source or package change is made.

An actual workerd regression caught added tool context missing from the immutable
initial chat admission. Preparation and execution now initialize the same catalog,
lookup flag and result array before wire hashing. Cost-enabled/observation-only
chat outage/retry/full audit tests pass again; the guard was preserved. Catalog is
sent only for chat, avoiding unrelated intake/summary input. Tool cases run the real
Gemini planner/re-generation/audit with missing-key adapters and a forbidden external
HTTP test adapter. They validate unconfigured results, not actual HomeTax/TheCheat/
registry/DataHub records. A single all-seven manual matrix is serial, fail-fast=false,
with max21 total model reservations. The fixture asset hashes are verified before
media dispatch and no expected answers are added to model prompts.

Queued admissions can predate a prompt/wire/catalog deployment. A failed restore now
stops before any model dispatch with retryable MODEL_UNAVAILABLE instead of terminal
INTERNAL_ERROR. A fresh explicit retry still creates/verifies a new immutable
admission, checks all existing permission/revision/technical/unknown-exposure guards,
and does not rewrite the old proof. Actual workerd tests cover a legitimate catalog
configuration change between admission and dispatch in both cost modes: zero old
model calls, unchanged old plan/payload/digest, successful new retry, and replay with
no additional provider calls. Existing cost/unknown observations remain preserved.

The full release gate remains blocked by the separately owned raw high audit
advisories in mobile developer tooling (#339). Do not repeat that failed full run
without a changed condition or bypass it. The same manual workflow offers
native_materials (no model calls) to run the actual pinned Linux Container fixture
profile where Docker is available. It is component evidence only and creates no
full-validation/release/#71 receipt. The all-seven selector remains limited to the
seven AI cases and max21 reservations.

Feature failures may retain only a finite policy reason/fact category/audit code list.
Media Gateway HTTP diagnostics now expose the same sanitized category/status/finite
request issue to an optional observer; an observer exception cannot replace the
processing failure or release its unresolved receipt. No provider body or generated
text is attached. These diagnostics prepare actual per-feature failure analysis and
are not success receipts.

## Seven-feature actual results and chat-specific repair

[Manual matrix40075712423](https://github.com/creno-va/baro/actions/runs/40075712423)
on exact main3e427aa completed all seven independent feature cases. Questions and
summary each passed generation plus independent audit (two attempts each). Image
interpretation passed in4481ms with the visible green-triangle09 marker; Korean
Whisper passed in2023ms with all spoken markers and one processed segment. Both media
quality observations were processed, not invented fallback quality. Voice token0/0
is the observed response metadata, not a statement of zero billed audio cost.

Chat and all three external-tool groups failed the first workspace_chat dispatch
with HTTP400/provider_request. No audit or external4API call was reached. The seven
finite original receipts are preserved in this directory's ai-harness subfolder;
no unchanged-condition model retry was made. This is not all-feature success.

The changed chat candidate uses native LOW GenerateContent and reusable JSON Schema
$defs/$ref for repeated fact/material unions, retaining server parsing and all
existing limits. Simple questions/summary/vision requests and native MEDIUM audit
remain unchanged. Zod's raw chat schema was19681 bytes inline versus11145 bytes
with shared definitions before common provider projection; this is payload size,
not a token/cost/latency prediction. JSON Schema roundtrip tests verify required
fields and closed objects remain enforceable, and server max2 tool requests remains.
Actual changed-condition chat/tool acceptance is still required.

The compact/native LOW candidate did **not** repair chat. Exact main eb57a03
[run40077233826](https://github.com/creno-va/baro/actions/runs/40077233826)
failed its first generation with HTTP400/provider_request after21462ms. Its finite
receipt is preserved; there was no tool call or independent audit. No unchanged
condition retry was made.

The next candidate removes numeric range grammar only from chat's provider schema.
The schema contained17 bounded numbers, including maximum safe-integer revisions,
UTF-16 spans, frame indices and material ordinals repeated across nested references.
[Google's structured-output guidance](https://ai.google.dev/gemini-api/docs/structured-output)
identifies numeric bounds as a cause of excessive constrained-decoder states. This
is a changed-condition hypothesis, not a confirmed diagnosis. Integer types, closed
objects, required properties and native LOW remain. The original server Zod schema
still rejects invalid revisions, ranges and counts before retrieval/publication;
tests demonstrate that distinction. Other already-accepted feature wire bytes and
all token, attempt, ownership, consent and quota limits remain unchanged. Actual
changed-condition acceptance is required before claiming repair.

[Native component40075714391](https://github.com/creno-va/baro/actions/runs/40075714391)
on3e427aa succeeded through the actual pinned Linux Docker fixture profile, including
document/office/HEIF, sampled video/audio, sanitization and report-native tests.
The finite native-materials receipt records actual job times and reference. It is
not deployed Cloudflare Container/product/OAuth or full/security acceptance. No model
calls occurred. The manual chat_tools selector lets a changed chat candidate test
only the four affected cases, retaining each case's durable counter and observations.
