# Case and precedent factual comparison — 2026-10-25

Scope: [#524](https://github.com/creno-va/baro/issues/524), direct web feature
request, branch `codex/524-precedent-comparison`. The existing topic research tab
becomes **유사 판례**. Select and read a verified official judgment before explicitly
requesting a comparison against the current confirmed summary.

## Meaning and evidence

The checklist has eight fixed factual indicators: parties' roles/relationship,
transaction/action, formation, disputed conduct, sequence, kind of harm, contested
facts, and kinds of records. The model returns yes, no or unknown with a short
explanation. Every yes/no needs an exact continuous quote from a current case fact
and an exact original UTF-16 span from the supplied judgment excerpt. Unknowns do
not become negative findings. Uncertain/conflicting or official-source facts cannot
support a definitive case-side match. A separate MEDIUM model audit checks the
semantics, qualifications, all explanations and evidence after literal checks.

The server calculates `round(100 * yes / 8)`, never model-supplied scores or weights.
Unknowns stay in the denominator. The UI separately shows the number of comparable
indicators and unavailable evidence, both sides' quotes, the official source link,
actual comparison time and stale/partial notices. This is an indicator match rate,
not legal similarity ranking, a legal conclusion or a winning probability. The
comparison covers the supplied facts and verified excerpt, not an entire long
judgment or all case material.

## Execution and persistence

The explicit comparison is a genuine existing `chat_response` operation and visible
user message. It uses the shared AI200 quota, durable immutable Gateway admission,
native Gemini LOW generation, separate MEDIUM audit, and existing bounded correction,
lease, time and attempt limits. All inference remains in `llm-gateway` through the
existing Cloudflare AI Gateway. No dummy job, new provider or migration is added.

The signed source capability is validated before admission and again at execution
against the original case revision plus the admitted user message. It pins owner,
case, source hash, citation and expiry. It is encrypted with the private request and
removed before model context/public message projection. The comparison result is
encrypted with the validated assistant message. Opt-in owner-checked endpoints
preserve the strict existing search/message/mobile DTOs. Publication uses the same
atomic current-owner/revision/lease/consent/source authority fence as normal chat.
Generic retry cannot reinterpret an old comparison capability: an unsuccessful
comparison needs a new explicit request using a freshly selected current source.

The web retains only an opaque job hint in session storage. GET polling/recovery
never starts a new model call. A lost acknowledgment reuses the pending job or the
same in-memory idempotency key. Foreground verification restarts read-only polling
without cancelling a same-owner admission. Access changes hide the private view and
invalidate delayed responses. A later case/source change marks a saved comparison
as historical; it does not silently update the score.

## Local evidence and remaining external acceptance

- Literal/schema/API/runtime integration: 23 tests, 248 assertions. These use the
  actual Hono, encrypted D1 repository, durable admission, workspace runtime and
  publication code with synthetic model and official-source adapters. They are not
  live provider calls.
- Rejected audits publish no comparison/assistant response. Forged/foreign/stale
  requests fail before model dispatch. Source corruption between admission and
  execution dispatches zero model calls. Source revocation after both successful
  synthetic generation/audit receipts fails with `reference_unauthorized` at the
  existing publication fence. Completed results become historical after a case
  revision change and are unavailable to another owner.
- Six real Chromium tests cover search/read/comparison, pending admission across
  foreground, failed/lost responses, owner sign-out, reload without another POST,
  unknown indicators, evidence expansion and stale notices. Viewports 320–1440px
  have no horizontal document overflow after layout settles; axe finds no violation.
  Screenshots contain only explicitly synthetic browser fixtures.
- Frozen Bun installation, `validate:quick` (572 focused tests/48 files/5,336
  assertions plus source/tooling/shared-client/mobile checks), full unit suite
  (4,351 tests/396 files/174,436 assertions), production build, bundle limits,
  Wrangler dry-run and actual local built workerd boot passed. After the shared
  pipeline return type was made consistent, the affected comparison/chat/source
  tests passed again (177 tests/912 assertions). No provider calls run in these
  validation profiles. No database schema changed.

Actual Gemini comparison against a live verified official judgment remains a
separate external acceptance. Neither synthetic adapters nor existing intake/chat
Gemini receipts establish that result. No production deployment or full-MVP/#71
acceptance is claimed. Unissued four-service credentials and their target/recipient
consent execution producer remain separate work under #458.

## Bounded manual external check

The independent `precedent_compare` selector in the existing manual synthetic
workflow retrieves one official Supreme Court precedent for the fixed public term
`대여금`. It sends no private narrative/search term to the law service. Its facts
come from the existing explicitly synthetic loan narrative, with exact reported
excerpts; expected answers/scores are not inserted into the prompt. The product's
same 4,000-character excerpt builder, real comparison pipeline, native LOW phase
and separate MEDIUM audit are used.

The existing durable three-total-model-attempt limit, authenticated invocation,
exact clean current-main/CI/source-manifest identity, source timeout/request cap,
replay refusal and temporary legal-credential cleanup remain. The all-seven matrix
still has seven entries and max21 reservations; comparison requires its own explicit
manual selection. Automatic CI/full never calls a model. The isolated Worker has
no application DB, OAuth credential or private case.

Acceptance requires eight indicators, at least one genuinely comparable indicator,
the fixed denominator score, a verified source and successful independent audit.
A finite receipt preserves actual counts/timing/usage and the public original's
numeric ID, content hash, verification time and excerpt bounds. It omits source
body, user/model text and credentials. Unrun or failed comparison counts remain
null. Offline control/source/privacy tests and isolated Worker bundling validate
the harness, not Gemini acceptance. Frozen/quick598 (50 files, 5,614 assertions)
and 45 targeted probe tests pass before dispatch.

## Delayed acknowledgment regression

Foreground GET recovery can observe a completed comparison before the original
POST acknowledgment arrives. Clearing the result when that same job's late receipt
arrives erased a valid result without changing the job ID, so completed polling
would not restart and the view remained pending. Admission now preserves state
already read for the acknowledged job; a genuinely different job still clears it.

A real Chromium test holds the synthetic POST receipt, recovers the complete
eight-indicator result through foreground GET, then releases that receipt. It fails
against the previous component and passes with the guard. All seven precedent
browser tests, frozen/quick572, build/bundle/dry-run and local built workerd boot
passed before incorporating the script-only acceptance parent. No provider call,
retry limit, public contract, stored result or technical guard is changed.

## First actual comparison and literal-evidence repair

[Manual run40139011354](https://github.com/creno-va/baro/actions/runs/40139011354)
on exact main5122e7a failed before independent audit. The official source was
verified with two real public API requests. Gemini native comparison generation
returned successfully twice (12,188ms/4,116 input/830 output and
11,614ms/4,127 input/929 output); each draft failed the existing literal-evidence
check. No comparison was published. The original
[finite failed receipt](./ai-harness-2026-10-24/precedent-compare-5122-40139011354.json)
is retained unchanged. Its generic `unsupported_fact` category does not establish
which individual quote, coordinate or case reference failed. No unchanged-condition
paid retry was made.

As with the existing chat quotation resolver, comparison now corrects only numeric
coordinates when the model's exact quote occurs uniquely in the exact verified
excerpt it received. The original offset is retained when already valid. Quotes
absent from the excerpt, repeated/overlapping ambiguous matches, malformed Unicode,
unknown fact IDs, altered case quotes and uncertain/conflicting definitive matches
still fail. Text, facts, source identity, scores and evidence scope are never
rewritten or inferred. The corrected draft passes the same separate MEDIUM semantic
audit and atomic source/owner/revision publication fence. Paid wire identity binds
the actual corrected audit input; no old admission is rewritten.
Evidence strings use a dedicated non-normalizing validator instead of the shared
display-prose trimming validator. Leading/trailing spaces are preserved exactly;
an altered case quote cannot become valid by silently trimming it. The existing
Unicode length, nonempty and markup bounds remain enforced.

Case-side evidence is further restricted to `user_statement`/`user_material` facts;
AI organization cannot masquerade as a user fact. Comparison prompt1.1 makes this
explicit in generation and audit. Other prompt versions/wires and all model/token/
attempt/time/AI200 limits remain unchanged. Old comparison wire proofs are not
relabeled; a changed admission follows the existing explicit-current-source flow.

Private Workflow/synthetic receipts add only a finite literal-check reason and
counts of valid/uniquely resolved spans, capped and schema-checked. `accepted` here
means literal integrity only, never approval of meaning or publication. A failed
semantic audit still publishes nothing. Diagnostics contain no quote, fact ID,
offset, source text, user/model content or arbitrary error message. Synthetic
API/runtime tests exercise correction through the real immutable admission/audit
wire and prove that rejection after correction still blocks publication.

Frozen/quick602 (50 files/5,671 assertions), affected grounding/runtime/probe166
tests (960 assertions), production build/bundle/dry-run/local built workerd and
isolated probe bundling pass. New tests cover unique UTF-16/emoji offsets, ambiguous
or unread quotes, input immutability and public/private projection. The changed
candidate still requires a new bounded actual observation; numerical correction is
not yet an established explanation or fix for the original live failure.
The full unit suite passed 4,357 tests/396 files/174,534 assertions before the final
AI-organization restriction; affected tests passed again with that stricter guard.
Final quote-whitespace/type checks add one regression (51 targeted tests/481
assertions); this is an additional literal-integrity condition, not a relaxed
source-matching rule.
