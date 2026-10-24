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

[Legal core40076630844](https://github.com/creno-va/baro/actions/runs/40076630844)
on exact main3e81310 used the existing preview LAW_API_OC through the manual
environment-readiness adapter. Five actual official API requests returned HTTP200;
three statute/precedent sources and three exact quotation integrity checks passed.
The precedent search remained truncated and that limitation is preserved. The
finite receipt is recorded as preview-credential-ci-adapter/runtimeWorker=false;
this is source adapter evidence, not Gemini legal chat or product acceptance. The
known pending guide was excluded rather than retried under unchanged conditions.

The separate manual legal_chat case tests a single public request (민법 제598조)
through the actual Workers workspace pipeline: Gemini requests the source, the
existing legal-retrieval module fetches and verifies it, the regenerated answer's
quotation/spans are validated, then an independent Gemini audit must pass. A passed
receipt requires actual HTTP reservations, a verified source, an accepted quotation
and a final audit; a schema-valid answer alone cannot pass. The existing durable
model cap remains3 and official HTTP requests are capped9. Other statutes, guides,
precedents and private queries are refused before HTTP in this isolated diagnostic.

Only this selected case temporarily receives the existing legal credential on the
isolated probe Worker. The runner deletes that Worker secret in finally and marks
cleanup failure as failure; product secrets are never changed. Fixed-scope deletion,
off-scope zero HTTP, bounded failed requests, finite reports and replay/provenance
checks have offline coverage. No issued keys or actual success is claimed for the
four external services that the user confirmed are not yet provisioned.

Web legal citations now show a separate title/original-link card next to the
external-tool cards, using only the existing public citation fields. No verification
timestamp or effective date is inferred from fields that this view does not carry.
The isolated browser fixture labels its synthetic citation, checks the exact
original link and clickability, and audits desktop/mobile overflow/accessibility.
This UI fixture is not evidence of an actual verified legal answer.

The numeric-grammar candidate on exact main1dbaf6d passed actual workspace chat
[40080102636](https://github.com/creno-va/baro/actions/runs/40080102636): generation
12671ms/11242input/1336output, independent audit6584ms/3377input/603output, two
attempts. The previous HTTP400 receipts remain preserved; the changed candidate is
accepted without claiming a unique historical root cause. A prepared JSON-mode
contingency was not adopted or dispatched. Offline50 legacy fixtures/60 v2 scenarios
reported zero critical findings; those remain scripted, not live model quality.

The subsequent [tool groups40080234578](https://github.com/creno-va/baro/actions/runs/40080234578)
passed business(HomeTax/TheCheat) and registry handling through requested-tools,
trusted not_configured results, regeneration and independent audit (three attempts
each). The earlier chat receipt was reused without another paid call. Property's
two generations succeeded, but its independent audit timed out at the unchanged
60000ms bound, with unknown usage retained. That group and the overall workflow are
failed; no unchanged-condition retry or timeout/attempt-limit increase was made.
No actual request to any of the four unprovisioned external services occurred.

Actual [legal chat40080290646](https://github.com/creno-va/baro/actions/runs/40080290646)
on1dbaf6d passed three Gemini calls, two official source requests, one verified
source, one accepted exact quotation and independent audit. The source-failure list
is empty. The workflow's temporary isolated credential cleanup also succeeded.
The retained generic unverified/legal label refers to remaining broader legal and
public approval, not a denial of this narrow source/quotation observation. These
finite receipts do not prove a deployed product/OAuth/full-corpus/legal approval.

The next separate video_media diagnostic connects the actual pinned native image's
8-second synthetic video output to two Gemini frame observations and Whisper on its
extracted audio. Native inventory/hash/position checks must pass before dispatch;
selected scene positions are1.4s/index14 and3.2s/index32, audio0–8s. A pass requires
both visible markers and spoken markers at the three-attempt cap. Offline tamper
tests and an actual local native extraction are distinct from the still-required
Linux-native-plus-Gateway run and deployed Cloudflare Container/product path.

Follow-up inspection found a test/runtime mismatch: workspace runtime already used
120000ms (the existing PR248 policy), while the isolated probe accidentally used
the generic gateway's60000ms default. The old property timeout receipt remains
failed and unknown; it is not a proof that the application failed at its actual
limit. Runtime and probe now import one120000ms constant. The application's value,
five-minute phase lease, twenty-minute job limit, three attempts and no-overlap
timeout behavior are unchanged. The outer probe observation deadline accommodates
three existing phase limits plus the legal case's existing120s source deadline,
within its ten-minute workflow; it never sends a second POST on ambiguity. This
changed harness condition permits one new property acceptance, not an unchanged
retry or an application timeout increase.

On exact main9c54011 [property40082162759](https://github.com/creno-va/baro/actions/runs/40082162759)
passed all three calls with the production-equivalent120s phase limit. Its first
generation actually took99615ms (11600input/720output), followed by9959ms/11797/653
and audit6425ms/3460/508. The older60s audit remains unknown/failed; this later pass
does not reveal that historical call's eventual outcome. Auth/replay guards passed.

[Video40082253954](https://github.com/creno-va/baro/actions/runs/40082253954)
completed its actual pinned Linux native stage09:32:31–09:37:55UTC:80 decoded
frames,8 one-second frames,2 scene frames and0–8s audio, with3 selected artifacts
verified. The first Gemini frame observation then timed out at60000ms. Its usage
remains unknown and the composed workflow failed after one call; no later frame or
audio model call was reached. Native success and model failure are separate receipts.

The changed vision candidate uses native inline JPEG data with explicit LOW thinking
and MEDIA_RESOLUTION_LOW, fixed JSON output and the unchanged observation prompt.
Cloudflare documents native contents input; Google documents global media resolution:
[CF model](https://developers.cloudflare.com/ai/models/google/gemini-3.8-flash/),
[media resolution](https://ai.google.dev/gemini-api/docs/generate-content/media-resolution).
This removes the image compatibility translation and explicitly pins its intended
low detail; it does not establish the old timeout's unique cause or a latency claim.
The exact native builder remains the budget identity/byte validator, rejects remote
URLs/additional instructions/mime/thinking/output changes, and requires native-wire
capability. Historical receipts/observations are unchanged. Whisper, model identity,
one-image/1MiB/output4000 bounds,60s media limit and no-overlap settlement are unchanged.
Finite media diagnostics distinguish an actual timer expiry from other failures.
Actual native-image/video acceptance remains required.

Exact main8fb0db3 [native media40084623164](https://github.com/creno-va/baro/actions/runs/40084623164)
passed: native JPEG vision50051ms/602input/104output with the expected visible marker,
Whisper2215ms/0/0 with the expected Korean spoken markers and one segment, both
quality=processed. This is not a latency improvement claim; earlier observations
and timeout failures remain preserved. The changed video's composed run is separate.

The explicit [full9c40082313723](https://github.com/creno-va/baro/actions/runs/40082313723)
failed in the workspace browser suite: the new tool-card test could not see its
mock result;78 other workspace cases passed. Unit/DB/offline/build and the preceding
browser suites had completed, but later CSP/security/audit/native stages were not
reached. The existing separate raw-audit high2 observation is not this run's cause.
No successful full receipt was produced.

The isolated local UI run had used real HTTP; full's PUBLIC_API_MODE=mock deliberately
handles apiRequest without fetch, so the test's Playwright route was never reached.
The fixture now forwards only its exact synthetic tool-result endpoint from that
mock HTTP adapter to the registered route, after reload. Both explicit mock and real
HTTP modes passed the same desktop/mobile, exact-original-link, overflow and axe
checks. Product requests and mock isolation are unchanged. A new exact-SHA full run
is still required; these focused checks do not rewrite the failed full result.

Exact main8fb0db3 [composed video40084771580](https://github.com/creno-va/baro/actions/runs/40084771580)
passed the pinned Linux native stage and all three Gateway observations. The two
actual scene frames at1.4s/index14 and3.2s/index32 matched their visible markers:
9594ms/586input/28output and9139ms/586input/77output. Extracted0–8s audio passed
Whisper5171ms/0/0 with its spoken markers and one segment. All three qualities were
processed; providerFailures was empty and auth/replay guards passed. Tokens0/0 are
observed ASR metadata, not a zero-cost claim. The old timeout receipt remains failed.
This is actual composed synthetic native/Gateway evidence, not a deployed R2/OAuth/
Cloudflare Container/full-product or public/legal approval.

The separate material_chat diagnostic checks actual model-directed attachment
reading. Only the first16 observations of a synthetic48-page document are initially
supplied; the requested final-page amount/code are absent. A scoped, revision-checked
read adapter can return at most two windows of32 observations in one round. Success
requires an actual read reaching page48, the hidden answer markers, a matching
file/revision/page reference and final independent audit, within three model calls.
Reports contain only counts/booleans, never excerpts or answers. This adapter uses
pre-extracted synthetic observations, not live D1/R2 or an actual48-page PDF. The
separate real encrypted-reader/deletion/revision tests remain necessary; neither
component substitutes for deployed product file/OAuth acceptance.

## Material reading and deployed intake follow-up (2026-10-24)

Exact main054b1e6 [material_chat40086793197](https://github.com/creno-va/baro/actions/runs/40086793197)
passed all three Gateway calls:8051ms/12972input/604output,
4376ms/16343input/255output and7365ms/7800input/788output. One actual read
returned32 observations, reached page48, and matched the hidden answer and exact
source position before independent audit. Auth/replay guards passed and providerFailures
was empty. The finite [original receipt](./ai-harness-2026-10-24/material-chat-054b1e6.json)
retains its real checkedAt; sourceManifest is withheld. This is still the pre-extracted
fixture described above, not an actual uploaded48-page PDF or live D1/R2 acceptance.

[Preview40086967281](https://github.com/creno-va/baro/actions/runs/40086967281)
deployed exact054b1e6. The actual ready endpoint matched release/schema0016; foundation,
all9 endpoint checks and text configuration readiness passed. Unavailable price/SKU
observations were warnings, not blockers. No model call is implied by deployment smoke.

In the existing authenticated Safari preview session, a new synthetic case produced
three first-round questions, saved its answers, produced two second-round questions,
and generated a matching summary after those answers. During the second-round
publication, the page displayed NOT_FOUND. A read-only reload, without repeating a
model request, recovered the saved answers and already-published questions. This is a
product observation, not proof that every possible cause of that UI error is known.

Inspection reproduced a concrete false404 path: metadata's post-decrypt fence returns
null when intake revision changes, and service.intake previously converted every null
to NOT_FOUND. The service now recovers only reads, at most three times, with a fresh
owner/tombstone check after each rejected snapshot. Continuous changes yield a transient
503; deleted/foreign workspaces remain denied. Four new expectations failed before the
fix; all101 targeted tests across read races, intake saves, snapshot recovery and actual
Hono/AES/SQLite load paths passed afterward. Frozen bun ci, validate:quick(server243)
and validate:build/local workerd passed. No schema, mobile/shared DTO, model request,
quota, execution hold or original provider observation changed. The fix still requires
its own exact PR/main CI and deployment;054's live results do not attest the new code.

## Actual product files and upload publication race

PR483's exact a076ba4 [CI40088293463](https://github.com/creno-va/baro/actions/runs/40088293463)
passed before normal merge to6559657. Its [main CI40088503615](https://github.com/creno-va/baro/actions/runs/40088503615)
and [preview40088744708](https://github.com/creno-va/baro/actions/runs/40088744708)
passed; ready matched exact655/schema0016 and all9 endpoint checks passed.
The finite [configuration receipt](./ai-harness-2026-10-24/preview-6559657.json)
retains its real observation time and remaining unverified scopes.

Before that deployment, the authenticated actual054 product completed chat tool
selection, regenerated/audited assistant output, encrypted opt-in result retrieval
and two readable not_configured cards for NTS/TheCheat. No real provider lookup or
lookup time was invented. Chat attachment of the317-byte synthetic UTF-8 TXT then
completed upload/processing, queued its message, returned both exact document markers
and linked the actual stored source. Reader text matched and original download bytes
exactly matched the local fixture. TXT has one stored page observation; this is not
evidence of two-page PDF processing or a new OAuth callback.

Exact054 [full40086795098](https://github.com/creno-va/baro/actions/runs/40086795098)
finished as failure at raw dependency audit: node-forge1.4.0 and Expo CLI's Zod3 retain
the two high advisories in #339. The repaired workspace browser fixture passed with
all79 workspace cases; CSP passed7 with1 skipped. Earlier unit/DB/offline/build and
browser stages completed. The later gitleaks scan/native stages were not reached;
downloading the scanner binary is not a completed history scan. No successful full
release receipt was produced and no paid model was called. Preserve the
[finite failure](./ai-harness-2026-10-24/full-validation-054b1e6.json); do not repeat
unchanged dependency failures or label the whole run successful.

In actual655, a batch of four synthetic files admitted JPEG and video. JPEG became
ready; the reader returned the Korean/English marker text and, on its next observation
page, the visible green triangle. The video remained an unfinished upload after
CONFLICT; audio and PDF were not yet admitted. Existing file/parts/ledger records and
remaining browser selections were preserved. No same-condition processing retry was
performed and these observations are not full multimedia acceptance.

The reproduced upload race occurs when native probing outlives another file's
workspace revision bump. Complete checked the request's entry revision and reread the
authorized session after probing, but discarded that current workspace snapshot and
used the older revision at finishUpload. The new version validates the same upload/file
revision, operation, reservation/bytes, workspace status/job, intake revision and
confirmed summary both after probing and before the final atomic CAS. A revision-only
background publication can complete the same original without repeating probe or PUT;
new workspace work, changed input/summary/status, deletion and revoked consent still
reject publication. Stale entry requests and explicit mobile conflict resolution stay
unchanged. Full local unit validation of the first candidate passed4054 and failed
the existing strict competing-completion contract once. That contract is preserved:
unversioned clients retain strict workspace CAS, while the web adapter explicitly
opts in with x-baro-upload-consistency:file-target-v1. Unknown versions fail before
probing. No legacy request/response DTO is extended. Both default strict behavior and
versioned normal/persisted-recovery HTTP clients are tested. The original regression
failed before the fix and passed afterward with89 targeted
tests across actual SQL/AES/R2-adapter uploads, signed-session revocation, paid-storage
boundaries, shared file clients and persisted upload recovery. Fresh CI/deployment and
the interrupted actual batch remain required; no schema/existing DTO/mobile change is
part of this repair.

## Actual d3f upload recovery and native capacity

PR485 merged after exact2d77f04 CI to d3f4e493. Main CI40091786099 and
[preview40091957950](https://github.com/creno-va/baro/actions/runs/40091957950)
passed; the [configuration receipt](./ai-harness-2026-10-24/preview-d3f4e49.json)
retains checkedAt12:02:21.055Z, matching SHA/schema0016 and observation-only warnings.
This is deployment/configuration evidence, not multimedia completion or a full pass.

In the existing synthetic case with the fresh d3f web client, reselecting the exact
remaining fixtures finalized the existing video upload and admitted the next audio
file. The previous upload session/file was reused; no video duplicate was created.
The later video Workflow failed at extract0, before interpret, at12:06:15UTC after
30.610 seconds. The application output was FILE_PROCESSING_FAILED even though the
platform marked the caught Workflow completed. Worker telemetry showed startup/unknown
(10,626ms); native instance history showed VMStopped afterward. No Gemini/Whisper
interpretation was reached. Audio completion stopped with503; PDF was not admitted.
The exact upstream startup cause remains unclassified. Preserve both failed work
and the previous successful JPEG/TXT receipts; no unchanged-condition retry was used.

Code inspection independently confirmed that upload probing and background extraction
use distinct named Container attempts and may start concurrently under max_instances=1.
The capacity repair keeps that physical limit, attempt identities, existing request/job
deadlines and all cost records. A persisted namespace-wide slot serializes starts;
native destruction must finish before its exact token is released. Elapsed time alone
never frees capacity. Abandoned holders require a confirmed stop, and failed cleanup
retains the slot. Caller-side preparation waits before opening the original stream,
then repeats current authorization; deletion/abort interrupts waiting. No schema,
old DTO, RN/auth or bundled native input changes are part of this repair.

Local coverage includes competing probe/extract streams, durable reconstruction,
stale releases, failed and concurrent orphan recovery, queued revocation, late claim
cancellation and post-wait consent loss before source open. The actual shipped
Container subclass and its real SQLite DO/RPC wiring also run in workerd with only the
native process stubbed, including the coordinator-to-old-attempt cleanup RPC cycle.
That local process stub is not an actual Cloudflare Container success receipt.
New preparation and post-wait fences add two fresh job/consent reads per native unit;
measured source-boundary tests retain all earlier five original-source fences.
The first broad local run exposed missing prepareCapacity in old native test adapters;
those synthetic adapters now explicitly grant a local test slot. Earlier failure logs
are preserved and are not real supplier failures. Exact-head CI, preview deployment
and actual resumed video/audio/PDF processing are still required.

The user also confirmed no existing accounts for the four unissued external APIs.
Operating identity, actual membership, required terms and service approvals remain
unprovided. The public DataHub guide search did not identify a current building address
search contract; absence of a guide does not establish discontinuation. Keep these
lookups unconfigured and the target/recipient-consent durable producer visibly pending.

## Native capacity merge and upload retry visibility

PR488 first passed exact6f2523a CI40094979622. The required latest-base rule rejected
merge after RN's iOS evidence PR487 landed; no admin bypass was used. After integrating
ff52c4d, exact5bc4df1 passed CI40095236994 and fresh frozen/quick/unit4127 (381 files,
172069 assertions)/build, including built Worker workerd. Normal squash merge produced
a74835b1b9577195e31380d12275b99acf7b00f5; main CI40095465168 passed. The manually
dispatched same-SHA preview40095659537 is still running at this record's creation.
It does not yet attest actual resumed video/audio/PDF success. RN holds main until
preview deployment finishes, while native input evidence remains owned by that session.

The actual file acceptance also exposed a web recovery defect: after a batch failed,
its remaining File objects survived, but opening an already accepted file cleared
the operation error and removed the only upload retry button nested inside that error.
The new browser regression first failed at the missing retry button after refresh,
file preview and close. Pending upload recovery is now rendered independently of the
error alert, gated by current ready ownership, busy/readonly state and upload consent.
Only the unaccepted remainder is retried. Accepted uploads, rejected-source exclusion,
owner/role/signout purges, readback-only recovery and session race fences remain intact.
The extended regression and22 related upload cases passed, including desktop/mobile
screenshots and axe checks. This separate web repair makes no server, schema, installed
mobile DTO or native input changes and does not call a paid provider.

## Actual a748 processing failures and source-scoped publication

The [a748 preview40095659537](https://github.com/creno-va/baro/actions/runs/40095659537)
finished SUCCESS, with matching a748/schema0016,9 routes and the actual
[configuration receipt](./ai-harness-2026-10-24/preview-a74835b.json) at12:57:39.707Z.
The main hold was released afterward. Resuming the retained audio/PDF selections
finalized the existing audio upload and admitted the PDF without duplicate audio.
Both later processing jobs failed, while all five stored originals were preserved.
Video was not retried under these unchanged processing conditions.

Audio extract0 completed in7.983s and interpret0 returned saved in12.053s. Preparation
continued, but coverage0 failed with STALE_REVISION at13:00:42UTC. A saved internal
interpretation step does not attest transcript accuracy or a ready public file; those
still require the actual reader/source checks. PDF extract0 completed in7.880s and
interpret0 in3.409s; its second extraction failed at13:00:58UTC. Worker telemetry was
startup/unknown5354ms. Native restart and final publication are separate remaining
failures, not proof that the Gateway or every AI feature is unavailable.

The publication race was reproduced with real SQLite/AES/R2-adapter processing by
uploading a second file between coverage preparation/append, observation staging,
and final publication. All three initially failed with STALE_REVISION. A fourth
preparation replay exposed an immutable-plan content-hash mismatch after revision
progress; the original encrypted plan/context is now reused on replay.

The new private plan captures semantic workspace context. Only file_coverage staging
may advance its operational workspace fence after fresh current source/owner/consent,
unchanged status/current workspace job/intake/summary, and exact target lease/fencing
checks. The SQL CAS repeats these fences atomically, including policy/file consent
revocation after the earlier guard. Header payload, source/file revision, parts,
timestamps, quota and cost evidence are unchanged. Generic staging, old plans lacking
the context extension and installed client DTOs remain strict. A failed CAS is
rechecked at most3 times only when a fresh read actually observes revision progress;
integrity/authorization refusal or ambiguous DB failure never retries provider IO.

Focused verification passed79 tests, including27 execution cases for replay, progress,
late revocation, semantic context changes, deletion/fencing and bounded continuous
races. Fresh install/quick276/DB schema/fresh/upgrade/unit4160 (382 files,172347
assertions)/build with local built Worker passed before integrating the independently
validated web PR489/main3ed0a59. The canonical processing fixture now measures
654/838 calls/SQL for one page and1160/1465 for two, with312/561 original authorization
reads. Extra work retains immutable-plan replay and atomic file-only fence checks.
Fresh integrated CI/deployment and actual media acceptance remain required. Native
startup is being investigated in the separate native-startup checkout; its underlying
platform cause is still not established and there is no same-condition live retry.

Self-review added explicit immutable manifest identity to that private context.
Two additional regressions first demonstrated that a replaced manifest could pass
the operational refresh. The manifest is now compared in the fresh source read and
in SQL. A shared publication scope repeats exact source/context/file and current
policy/file consent at observation staging and the final ready transaction, including
revocations after the earlier refresh. Eight added cases cover before/after-guard
manifest replacement and late file/policy consent loss at both write boundaries.
All87 focused cases (35 execution cases) then passed. These are synthetic SQL/AES
failure tests, not evidence of an actual customer source replacement or breach.


## Integrated da9 preview and retained publication retry

PR492 finaleb976ec3 passed focused87/quick302/DB fresh+upgrade/full4194/build and
CI40101624271; normal squash main e1b7b54 CI40102031237 passed. PR494 integrated
that main: exact89b0c063 passed frozen/quick302/full4206 across385 files with172656
assertions/build and CI40102057543. Normal squash main
`da9cc6d2bb3dd9b0a8e24793f44443206ceb2abd` passed CI40102819415 and
[preview40103079485](https://github.com/creno-va/baro/actions/runs/40103079485).
The [configuration receipt](./ai-harness-2026-10-24/preview-da9cc6d.json) has actual
checkedAt14:38:57.480Z; observation warnings are retained. Production is unchanged.
RN main hold was released after deployment success.

Original synthetic audio208526B/PDF25842B/video66723B downloads match their local
source bytes. On this changed preview, one explicit audio retry started14:40:01Z:
extract10.195s, interpret6.570s, unit preparation2.292s succeeded. Publication
preparation then failed DB_OPERATION_FAILED3.248s at14:40:23Z. No unchanged
retry, transcript accuracy or ready-file success is claimed.

The actual-SQL/AES regression retained an earlier publication header, coverage
parts, observations/derivatives or a sealed snapshot, then started a new explicit
runtime. All four failed with the same DB_OPERATION_FAILED at staging.begin:
the immutable snapshot unique key `(purpose,target_id,revision)` was occupied,
while the new attempt reused sourceFileRevision+1. This is a concrete local
reproduction matching the live stage/error; the live provider cause is not
claimed from raw exception/SQL output. Old observations/derivatives also reserve
their version namespace and must remain intact.

The candidate allocates a fresh output revision above the existing coverage,
observation and derivative revisions with one indexed read. Its encrypted
immutable publication plan carries that revision through operational fence
refresh, staging, seal, file metadata encryption and publication. Source revision,
manifest, current owner/consent/lease checks and per-operation quota are unchanged.
Older plans omit the optional field and keep their original exact version;
replays reuse the same plan. Completed replay checks the actual output revision
and the exact published job/runtime/fencing binding. No schema/migration or
installed mobile/public DTO changes; no old snapshot/part/result/hold deletion
or timestamp rewrite.

The five focused retry cases include the real workerd D1 binding, seeded before
upload and used for both complete processing attempts; native/R2/model ports
are explicit offline adapters. An initial attempt to clone already-processed
physical writer state was rejected by the existing physical-binding trigger;
the test now starts native D1 before upload and never bypasses that trigger.
This local test is not actual Container/STT/vision success. The canonical
one/two-page fixture adds exactly one DB call/SQL (655/839 and1161/1466), keeping
312/561 original authorization boundaries. Final broad checks, exact-head CI and
changed-preview ready media acceptance remain outstanding.


PR497 exactb08e5c9 passed frozen/finalquick303/full4212 across385 files with172781
assertions, DB schema/fresh/upgrade and build/local built Worker. CI40104481099
passed; normal squash main ebd90a0935e6783f5e7738fed482c3425537cadd passed
mainCI40104728606. This does not claim that the changed product retry is ready.

Meanwhile a single changed-condition da9 PDF attempt passed extract0/interpret0
but failed extract1 at14:52:41Z. The normalized startup event was
instance_unavailable196ms. The follow-up
[native ordering repair](./NATIVE-STARTUP-REPAIR-2026-10-24.md#idle-timeout-order-after-a-confirmed-allocation)
reproduces an idle-before-start error and moves idle configuration after
confirmed readiness with unchanged cleanup, cancellation and physical limits.
The RN session keeps the main merge interval while these independent fixes are
integrated for one final same-SHA preview. No source failure or original is removed.


## Integrated d842 actual audio/PDF and lookup-only chat scope

PR498 exact4b95d701 passed frozen/quick303/full4215 across385 files with172789
assertions, build/local built Worker and CI40105018914; focused23/106 included
the new idle-order rejection. Normal squash main
`d8423c6e979b621d46027107aa1d0d4cbb99cf5f` passed CI40105259098 and
[preview40105513572](https://github.com/creno-va/baro/actions/runs/40105513572).
The [receipt](./ai-harness-2026-10-24/preview-d8423c6.json) retains actual
checkedAt15:13:47.531Z and observation-only warnings. RN main hold was released
after deployment success; production is unchanged.

In the same authenticated synthetic product case, the retained208526B English
audio now reached ready. The reader shows full0–6.515s processed coverage and
three actual STT observations:0–1.32s “This is Synthetic Speech”,2–3.3s
“Blue Box 17”,4–5.6s “Green Triangle 9” (as rendered). Both marker
values match the synthetic TTS ground truth; digit normalization differs from the
spoken word spelling. The26KB two-page PDF also reached ready: both pages are
processed, Korean text is intact, BLUE BOX 17/ORANGE CIRCLE 42 and the final
END OF SYNTHETIC DOCUMENT marker are present at their correct pages. Local
private screenshots retain the actual UI, not a fixture-backed browser mock.
The original failed attempts and all source bytes are retained. Video is now
processing on this changed preview; its completion is not claimed here.

A separate actual law-chat request on earlier da9 at15:05:09–15:06:31Z performed
a verified statute retrieval but rejected its generated response. The safe
receipt reports prohibited_content / action_text / strategy with
canonicalRefusalOpening=false, rather than a failed legal API. No rejected text,
source identifiers or private case/owner IDs are recorded here. The response was
not published and the same request was not repeated unchanged.

Inspection found that general chat instructions allowed optional preparation
actions even for a request only asking to look up and explain existing law.
The candidate workspace prompt2.5 directs read/lookup/quotation/explanation-only
requests to text, references, sourceClaims and warnings, with empty structured
addition arrays unless the user also supplies new case facts or requests an
update/preparation task. Array maxima are ceilings, not quotas to fill. New
actual facts still require their exact references. This narrows unnecessary
generation without changing the content/privacy/strategy/fact/citation guards,
independent audit, tool rounds, generation count, timeouts or retries. It adds
no new model, provider or external target inference.

Existing focused113 tests across3 files/549 assertions pass, including preserved
action strategy rejection and factual/audit boundaries. Offline50 deterministic
fixtures and60 scripted v2 scenarios have zero critical findings. These are
scripted checks; actual prompt2.5 legal-chat quality remains unverified. Broad
validation, exact-head CI and a changed-source actual lookup acceptance remain
required before claiming this response is fixed.

Prompt2.5 on b4e-integrated source passes frozen install, quick305, full unit4217
across386 files/172812 assertions and build/local built Worker. No actual prompt2.5
provider success is inferred from these checks.


## Video artifact deadline and bounded frame observation profile

The changed d842 video attempt started15:22:08Z. Native extraction succeeded
in28.551s, followed by interpret0/0 in8.698s,0/1 in14.545s and0/2 in6.309s.
Interpret0/3 started15:23:07Z and failed JOB_TIMEOUT at15:24:09Z under the
existing60-second local media deadline (step elapsed about62s including its
other work). No unchanged-condition retry was sent. The exact remote cause,
late response and accuracy of the unpublished interpretation outputs are not
inferred from the timeout. Its unknown/late accounting records, prior outputs
and original file remain intact. Audio/PDF ready results are unaffected.

The candidate adds a server-owned video_frame vision profile: one bounded JPEG,
the same Gemini model through Cloudflare Gateway, LOW media and thinking,
2000 output tokens, at most6 brief observations/800 characters each. It asks
for frame-local visible facts and readable labels without inferring outside
events, identities, dates, clinical conclusions or legal outcomes. The regular
image/medical-document profile remains4000 tokens with its existing schema.
Both retain the same60s deadline, no automatic paid retry, source authorization,
artifact-position binding, maximum calls and conservative4000-token resource
reservation. Each actual position still has its own logical invocation even
when JPEG bytes repeat; this is not a cross-frame cache or fabricated reuse.

Exact wire validation accepts only the two generated profiles; mixing a frame
cap with another instruction or changing the cap is rejected. Wire/evidence
hashes distinguish them. Overlong/excess frame output preserves its actual paid
response but cannot publish observations or dispatch another request. The frame
timeout regression retains unknown exposure and its late real response without
re-dispatch. The isolated composed-video probe now uses this same frame profile.
The current focused110 tests across4 files/910 assertions and the two manual
probe contract tests pass. These local/scripted checks do not establish lower
provider latency or actual complete video interpretation. Broad validation,
exact-head CI and a single changed-request-profile actual acceptance remain.


## Main3942 observations and retained probe inspection

PR500 exact4ba2ea5 passed frozen install, quick305, full unit4221 across386
files/172850 assertions and build/local Worker. Normal squash main3942f5a passed
[CI40108396524](https://github.com/creno-va/baro/actions/runs/40108396524) and
[preview40108645938](https://github.com/creno-va/baro/actions/runs/40108645938).
The [configuration receipt](./ai-harness-2026-10-24/preview-3942f5a.json) retains
its actual15:55:09.962Z observation. This does not establish model success.

The separate changed-profile video probe
[40108643694](https://github.com/creno-va/baro/actions/runs/40108643694) prepared
the real pinned native fixture successfully:80 decoded frames,8 one-second
candidates,2 scene candidates,2 selected frames and8 seconds of audio. Its model
exchange then failed MODEL_RESPONSE_INVALID at15:52:29.654Z. No finite model
report artifact was written. Provider outcome, reserved attempts and failure
stage remain unknown; this is not a proved frame-schema failure or success.
No unchanged paid POST, durable-state reset or source-hash budget reset was made.

The real product legal chat on3942 started16:05:24Z and completed with a failed
result at16:07:25Z: context641ms, initial generation120416ms. The existing
120-second phase deadline expired before official-source retrieval. It is
different from da9's verified-statute/action-policy rejection, and does not
establish that prompt2.5 repaired legal chat. Original jobs and accounting remain.

A separate manual status-only workflow reads the retained isolated probe control
without deploying code, resetting storage or POSTing a model call. It shares the
probe concurrency group, validates the existing candidate/feature/source identity,
and records reserved permits separately from proven provider requests. Only a
strictly validated finite report may enter its artifact; raw stored content is
excluded. The workflow rotates only the isolated Worker READINESS_TOKEN using
the existing preview credential and removes that temporary secret even after an
ambiguous PUT or failed status read. Application credentials are not addressed.
GET propagation waits are bounded. Cleanup failure remains a failed observation
with the retained snapshot, rather than discarding diagnostic evidence. Local
adapters exercise these boundaries; actual retained status is still pending.


## Actual completed-material chat and readable material references

On preview3942, selecting the ready two-page PDF and English audio in the actual
case chat produced a completed response16:20:54–16:21:13Z. Context1530ms,
generation11271ms, independent audit5989ms and publication200ms completed. The
answer matched BLUE BOX17 on page1, ORANGE CIRCLE42 on page2, Blue Box17 at
2–3.3s and Green Triangle9 at4–5.6s. Four readable source links identified the
exact two PDF pages and two audio intervals. This is deployed encrypted-file/model/
publication/UI evidence, beyond the earlier pre-extracted material-chat probe.
It does not attest video or repair the separate legal-chat timeout. The answer
stated no case-fact or preparation-action addition; persisted UI checks are separate.
The screenshot is local/private and is not published as a GitHub artifact.

The response unnecessarily printed internal file UUIDs in its prose even though
readable original-name links were already rendered below it. Prompt2.5.1 asks chat
to describe material type plus page/time in prose and to keep exact internal IDs
in structured references. It must not invent unsupplied original filenames. No
additional filename/private metadata is sent to the model, and exact source binding,
server validation and independent audit are unchanged. This presentation change
is locally validated separately; the3942 response remains the actual observation.


The status-only [inspection40111474268](https://github.com/creno-va/baro/actions/runs/40111474268)
on normally merged main0a3162e passed after main CI40111242596. Its
[original finite observation](./ai-harness-2026-10-24/inspection-video-3942.json)
at16:25:31.728Z reports the target candidate/feature namespace started=false,
reservedAttempts=0, no stored report and no terminal failure; temporary credential
cleanup succeeded. This inspection issued zero model POSTs. The old failed POST's
HTTP/envelope was not retained, so its dispatch/propagation cause and any other
namespace are not inferred from the empty target state. No same-profile probe
POST was reissued. The changed frame profile remains pending actual acceptance.

The actual material-chat follow-up UI shows only the six original user facts,
timeline0 and preparation actions0; synthetic markers were not added there.
A separate narrow legal request specifying 민법 제598조 then produced an exact
quotation and a readable official-source card linking the actual law.go.kr
original. It completed at16:26:08Z on3942: context911ms, generation9959ms,
audit52168ms and publication137ms. There was no retrieval stage: this reused
previously verified material and is not evidence of a new law API request.
Quotation resolution reported valid_span1 and zero rejected/unavailable spans.
It does not erase the broad-query
initial-generation timeout or establish its cause.

Prompt2.5.1 validation: frozen install, quick307, focused60/3files/337 assertions,
50 deterministic and60 scripted v2 cases with zero critical findings, and build/
local built Worker passed. No actual2.5.1 provider or presentation result is claimed.


## Actual product video ready on3942 and concise lookup dispatch candidate

The actual uploaded video retry3 on3942 completed40 Workflow steps in about
3m35s and published ready revision3. Native extraction16:28:42–16:29:06Z took
23589ms. All11 interpretations completed: audio9736ms, then ten frame steps
26120,32800,11147,9393,8311,5920,5304,6180,22347 and11129ms. The original
60-second media deadline, call limits and independent per-position accounting
were not increased. The [finite manual receipt](./ai-harness-2026-10-24/product-video-3942.json)
labels its actual dashboard/UI basis, rather than representing an automated probe.
This changed request profile passed; it does not prove the unique cause of the
earlier timeout or a general latency guarantee.

The product reader reports processed frames at0–7s in one-second steps and at
1.4s/frame14 and3.2s/frame32, plus processed0–8s audio. Reading every observation
page confirmed the blue-box17, orange-circle42 and green-triangle09 labels at
their expected scenes, including the two scene-change samples. The Korean
transcript at0–6.36s matched the synthetic spoken markers. Original streaming
provided a video player without autoplay. A post-ready download at16:36:17Z
contained66723 bytes and matched the retained synthetic original byte for byte.
Failed jobs/unknown usage, old observations and original bytes remain preserved.
Private screenshots were shown in chat and are not published to GitHub.

Prompt2.6 additionally makes a source/tool/material-request round a concise
dispatch draft: a short neutral progress sentence, the necessary lookup requests
and empty proposed additions/claims. The existing server supplies evidence before
the final answer is generated and independently audited. New user facts remain in
context and can still produce requested supported final updates. This adds no
model phase or retry and changes no validator, quota, timeout or retrieval authority.
It is a targeted hypothesis for avoiding unnecessary hypothetical-answer work
before lookup, not a proved cause or repair of the broad-query timeout. Actual
changed-prompt source selection, citation, material chat and requested-update
acceptance remain required. The readable material-ID guidance is retained.

Prompt2.6 validation passed frozen install, quick307, focused60 across3files/337
assertions, offline50 deterministic+60 scripted scenarios with zero critical
findings, production build/dry-run/local built Worker and docs checks. These
checks are offline; actual changed-prompt dispatch/answer quality is pending.

## Actual prompt2.6 acceptance and source-card/composer readability

[PR505](https://github.com/creno-va/baro/pull/505) normally merged as
mainb9808b8 after exact-head CI40112543204; main CI40112762222 and manual preview
[40113006857](https://github.com/creno-va/baro/actions/runs/40113006857) passed.
The [original configuration receipt](./ai-harness-2026-10-24/preview-b9808b8.json)
has no blockers; missing monetary observations remain warnings. Production is
unchanged. The following are manual observations of the isolated synthetic case,
not automated CI/provider tests. Private screenshots were shown in chat only.

The same broad legal question completed16:54:12–16:54:45Z with exact Civil Act
598/603 quotations and two official-original cards. Context8006ms,
generation11681ms, audit11287ms and publication1012ms completed. Quotation
resolution reported valid_span2, all rejected/unavailable counts0. No retrieval
stage occurred, so this cached-source success does not establish fresh API
dispatch performance or explain the earlier initial-generation timeout.

A selected-video chat completed17:04:23–17:05:01Z and correctly identified the
1.4s/frame14 orange circle42,3.2s/frame32 green triangle09 and7s/frame70 green
triangle09, with exact readable frame links and an observed-window limitation.
The prose contained no internal file identifiers. Context8962ms, generation9331ms,
retrieval1605ms, generation8337ms, audit8549ms and publication739ms completed.
The generic retrieval metric does not expose a per-window read count; no exact
material-call count is inferred from it.

An explicit synthetic user-statement/update request completed17:11:54–17:12:50Z:
context9143ms, generation32023ms, audit8819ms, publication4735ms. Summary review
showed exactly seven user-reported facts (the six originals plus the requested
October24 copy-storage statement), followed by user confirmation. The workspace
then displayed exactly one October24 timeline entry marked as needing user
confirmation and one uncompleted preparation action about checking the copy's
storage location. No diagram markers became facts. This verifies requested
updates remain possible under the concise-dispatch instruction.

The DataHub connection-status request completed17:25:19–17:28:47Z. Both property
address and building-register cards reported not_configured, no returned factual
rows, and the official dataapi.co.kr guide link. No real target lookup occurred.
Context8791ms, generation84806ms, retrieval828ms, generation35267ms, audit76807ms
and publication613ms completed. This successful response still took about3m28s;
it is not a latency acceptance. The four unissued services and their runtime
target/consent producer remain external integration work.

Actual review also exposed two presentation defects: both statute cards were
labelled only “민법”, and the shared case stylesheet could make the empty sticky
composer220px tall, obscuring replies/tool disclosure controls. The shared
client now derives distinct statute article labels from existing optional raw
source fields while projecting the same id/title/url view and preserving HTTP
contracts, source identity and validation. RN ownership was coordinated before
this shared-file change; current native source parity requires new compilers.
The web composer selector now wins in either stylesheet order, preserves a16px
font floor and becomes static while tool details are open. A regression using
the actual shared stylesheet loaded last failed at220px before the fix and
passed at desktop/mobile widths afterward. Explicit real-adapter and mock
browser tests, accessibility/overflow checks and build/local Worker passed;
actual changed-UI preview acceptance remains pending deployment. After integrating
RN main7ec63528, frozen install and quick319/37files/3035 assertions passed;
focused shared-client/recovery22/3files/115 assertions and docs also passed.


A distinct Civil Act600 request then completed17:50:09–17:52:30Z on the same
preview. Unlike the cached598/603 answer, this executed retrieval7444ms and
reported legalRetrieval kind=statute, availability=verified, reason=null.
Context9122ms, initial generation29278ms, final generation81265ms, audit10992ms
and publication988ms completed; quotation resolution valid_span1 and all
rejected/unavailable counts0. The chat displayed the600 interest-calculation
article title, exact returned quotation and law.go.kr original link, with no
case/timeline/action additions requested. This verifies a fresh source lookup
path under2.6; its roughly2m20s duration remains a performance limitation. No
unchanged failed request was replayed and no deadline was increased.

## Deployed source readability and retained-analysis journal repair

[PR509](https://github.com/creno-va/baro/pull/509) passed exact-head
CI40118263799 and normally merged to main3b005f3. Main CI40118452372 and
[same-SHA preview40118642567](https://github.com/creno-va/baro/actions/runs/40118642567)
passed. The [original finite configuration receipt](./ai-harness-2026-10-24/preview-3b005f3.json)
is checked at18:05:30.731Z with no blockers; absent cost observations are still
warnings. Production remains unchanged. Main coordination was released after
this preview completed; RN will compile the shared mapper under a new source pin.

Reloading the existing synthetic chat confirmed distinct598/603/600 article
labels and a compact empty composer. Opening the two previously saved DataHub
cards showed readable not_configured notices/official guides and the composer
scrolled away with the page. No new AI message was sent for these checks.
Private screenshots were shown in chat, not published. Browser real/mock tests
had independently checked two viewport sizes, stylesheet-order regression,
font floor, accessibility and overflow; those are synthetic browser checks,
separate from the actual Safari preview observations.

[Issue506](https://github.com/creno-va/baro/issues/506) reproduces the actual
retained AnalysisWorkflow factory failure before provider dispatch: preview
requires an attempt ledger but the old factory supplied none. Its new factory
connects an explicit server invocation to the exact immutable wire identity and
a legacy-specific source/attempt journal. It does not fabricate a v2 workspace
or convert old cases. Additive0017 was generated sequentially after0016, with
RN confirming no competing schema work. Source pointers detach on deletion;
technical exposure, stable detached billing principals and original observations
remain. No prompt/input/output text is stored in the new journal.

Before dispatch and final confirmation the runtime checks current case/analysis,
revision, Workflow instance/attempt, plaintext-source digest, owner, current
customer role/consent, deletion/tombstone and explicit-upgrade fences. One
phase ordinal wins concurrent workers. Provider errors can use the original
bounded retry path; unknown transport blocks overlap, including an explicit
new Workflow attempt, until the actual late terminal receipt arrives. A newer
explicit retry may cancel only an old preparation with no dispatch token.
Nothing resets or erases an ambiguous provider call.

The logical response uses the same v2_daily_usage AI200/day counter. Publication
of questions or a result consumes its own reserved unit; failure/supersession/
deletion releases only that operation's unit. An explicit retry retains the
original request day and can reclaim a released unit within the same shared
limit. Mandatory terminal transport is recorded separately before optional
usage observations. Observation IO failure logs only a finite sanitized
category and retries the observation once in the background; valid output is
not failed and the model is not replayed. Missing quantity/price data stays
unknown. No price/funding/FX/monthly gate was introduced.

The existing single guarded analysis UPDATE may now fire a quota trigger. Its
success check accepts a positive affected-row count for that unique target,
including trigger writes, rather than treating a committed publication as a
stale failure. Completed phases return completed and the Workflow stops there.
Prompt1.2 limits newly generated legacy questions to3, with the bounded existing
correction path; historical up-to5-question DTOs remain readable. The single
legacy batch,24h answer wait, explicit maximum3 Workflow attempts,60s model-call
and10min analysis limits are not expanded. No new model/provider is used.

Local validation passed frozen install, quick319 on integrated3b005f3, full
unit4279/390files/173624 assertions, production build/dry-run/local built Worker,
DB drift/fresh/upgrade/import and replay, and offline50+60 with zero critical
findings. Follow-up focused48 tests include the actual preview-mode runtime→
encrypted publication→authenticated Hono readback, question waiting, policy
results, unknown/late/deletion, source/owner revocation, daily200, immutable
history, preserved old ciphertext/outstanding money/receipts through0017,
observation failure and missing-journal preflight. These use synthetic provider
and law adapters, not live model/legal calls. The fast CI profile now includes
the offline legacy journal/preflight regressions. Same-SHA CI/deployment and
actual retained-model acceptance remain pending; remote3b005f3 still has0016.
Unissued external services, latency, security and public release gates remain.
