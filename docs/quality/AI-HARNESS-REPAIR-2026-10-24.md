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
