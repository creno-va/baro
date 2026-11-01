# Automatic case research and analysis

`createAutomaticLegalAnalysis(deps).prepare(input)` is internal to one admitted durable
analysis task. Import its input/basis helpers from `context.ts`, model schemas from
`llm-gateway/analysis-schema.ts`, and versioned prompts from `analysis-prompts.ts`.
The shared DTO is `conversation-report-v1` from PR628.

Input is the current confirmed summary, current attributed facts, case context,
included file revision/hash tuples, actually read included material observations,
research revision and report scope (`excludedFileIds`, `maskIdentifiers`). The server
must filter/mask facts, overview, parties and observations before calling; the model
does not implement masking. References to excluded or mismatched files fail before
any model or legal request. `analysisBasis` hashes the full supplied facts, uncertainty,
references, summary, evidence, observations, procedure, purpose and scope. A file hash
alone is insufficient. `isAnalysisCurrent` checks this basis and dependencies; it
does not grant source authority. Pass the authenticated `researchRevisionBase`, not
the current display/CAS revision, to preserve comparison-only revision semantics.

Material observations preserve optional `coverage: {observationCertainty, userEdited}`
from the actual included observation window. Missing coverage remains unknown. An
uncertain, corrected or unknown observation cannot independently support a requirement,
including through a derived fact mislabeled observed at the same current reference.
Already verified current facts outside that window and qualified user statements stay
distinct. Coverage participates in the digest; changing it invalidates old analysis.

The trusted caller injects three `model.plan/analyze/audit` callbacks routed through
the existing llm-gateway and paid attempt ledger. Planning selects up to three issues
and four reviewed public requests. Retrieval uses the existing official parser/cache/
binding service, at most twelve actual attempts including retries and a 120-second
retrieval signal. Arbitrary private searches, URLs and research readTokens are not
inputs. The service never calls a model/provider directly or introduces a fallback.
Pass `analysisPrecedentDiscovery(input)` from `discovery.ts` as the official retrieval
factory's `precedentDiscovery` option: it ranks the existing title-first candidate
pool locally before selecting originals. Names, narratives and material text remain
inside the Worker. Verified bodies still undergo relevance checks and independent audit.
Generation and independent audit run once each; schema/provider retries remain within
the gateway's existing technical ledger. The owner/consent/revision/lease `authorize`
closure runs before and after asynchronous stages. `reserveRequest` must be a technical
attempt guard; cost observation failure must not recreate an execution gate.

`readBoundSources(ids, now)` must use `readBoundSourceBatch` for the current case. Public
search originals alone fail this check. Before release the service rechecks current
bindings, full original hashes, expiry and independent claim validation. Requirements
cite statutes and specific supplied facts/material positions. Precedent comparisons
cite their own exact original spans, including qualifications and preparation meaning.
Claimant gaps and defense response points are distinct. No-source cases skip generation
and audit and return empty/unavailable with a concrete confirmation action. Partial
source failure, bounded coverage, excluded unrelated judgments and source limitations
remain visible. A verified source is not a proven case fact or a final legal judgment.

The result is `{snapshot, sourceRetrieval}`. The caller persists the immutable snapshot
encrypted and uses `capturePublicationSourceAuthority` in the SAME atomic publication
claim, with current owner/consent/revision/lease and evidence/scope guards. A returned
object is not itself a durable publication receipt. Shared DB, API, client and runtime
registration are owned by00; task orchestration is04; report copying/export is05;
official procedural guidance is06 using the existing registry-approved guide key.

One factory coalesces concurrent/same-input calls and retains a failed attempt instead
of silently starting it again. A reused result still rechecks authorization and source
authority, and caller mutation cannot change its cached result. Cross-instance replay,
AI200 reservation, admission, outbox and retry limits remain the existing durable
job/operation/lease/attempt responsibility. Reads, page entry, polling and HTML/PDF
export must read the stored snapshot; they must never call `prepare`.

Tests use synthetic official response shapes and a fake model/auditor with real SQLite,
AES repositories, source parsers and citation bindings. They demonstrate local integrity,
revision and failure behavior only, not actual legal API/model quality or legal approval.
