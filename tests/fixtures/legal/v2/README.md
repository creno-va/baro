# V2 legal source synthetic preparation corpus

- Reviewed: 2026-10-06
- Issue: #63, independent fixture preparation only; #55 must close with its PR merged before product implementation.
- Base: ac756408155dd9d300129014b906984ff2f7a09f, including #54 shared v2 contracts.
- Every response, identifier, sentence, HTML element and case narrative here is synthetic. Nothing was captured from an authenticated API. No actual OC or private case is included.
- `adapterValidation: not_run` means the expected upstream acceptance/rejection is a future adapter requirement, not an executed result. A fixture's expected `verified` status is conditional on a future adapter, authorized source registry and claim review; it is not a claim of verified live content.
- The tests execute manifest/hash/span integrity and existing shared-schema boundaries only. They do not exercise retrieval, caching, authorization, AI, claim entailment, production registry admission or live services.

## Files and interpretation

`manifest.json` indexes 43 synthetic responses, 16 family scenarios and 5 negative citations. Raw responses are in `statutes.json`, `precedents.json`, `guides.json`, and `failures.json`. `families.json` covers civil, criminal, family, labor, administrative, commercial, tax and mixed/unknown contexts with both candidate availability and gaps. `citation-negatives.json` contains deliberately invalid public DTOs.

Each response records credential-free request parameters, HTTP status/media type, raw body and its UTF-8 SHA-256, plus expected availability/reason. Optional normalized text, canonical identity, public citation, and half-open UTF-16 span are **expected annotations**, not parser output. `bodySha256` hashes the stored raw string exactly. `contentHash` hashes the stored normalized string exactly, including newlines; no Unicode normalization or whitespace folding occurs. Changed extraction rules need a different normalization version. `captureStatus: not_captured` and `shapeStatus: provisional_documented_fields_not_captured_json_shape` prohibit treating guessed nested JSON wrappers/cardinality as official captured shapes.

Synthetic guide `data-fixture-*` attributes exist only to illustrate scoped text/date extraction. They are not selectors observed on the real site. Image-only, pending revision and dynamic-empty fixtures must not manufacture text or dates. `candidate_only` requires a separately verified detail response. `limited` is distinct from complete coverage; an undated guide retains `publishedDate: null`, and a summary-only precedent cannot claim its full text was read.

The nationwide narratives test shared intake acceptance and factual source references. They do not establish source coverage for those families, legal applicability or successful navigation. The `available` label means selected fixture candidates exist, not that their synthetic law or precedent supports the narrative.

## Official request documentation

Current [eflaw list guide](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide), [eflaw detail guide](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdInfoGuide), [precedent list guide](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precListGuide), and [precedent detail guide](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precInfoGuide) describe `OC` as a required string, **신청한 API인증값**. Do not assume it means an email prefix or substitute a generic bearer token. The approved value is supplied only by the server environment and is omitted from all corpus requests. No sample API links were called during this preparation.

[Official application guidance](https://open.law.go.kr/LSO/information/guide.do) requires membership, selection/application for the intended data, and approval before use; operational application includes an application-use example. A law service registration does not prove precedent activation. The public documentation does not establish this account's current activation, IP acceptance, credential validity or fixed request quota. The existing two live law diagnostics still showed a required-term HTTP200 error after optional filters were removed; this does **not** establish account/IP rejection. The synthetic required-term and registration-looking errors are deliberately separate and remain unclassified upstream failures until there is reliable evidence.

List request profiles: `OC`, `target`, and `type` are documented mandatory; `type=JSON` is explicit even where XML is the documented default. `eflaw` supports query/search, LID, nw, display (max100), page, sort and efYd. `prec` supports query/search (1 title, 2 body), display (max100), page, org/curt, JO **reference law name**, sort, date/prncYd, nb and datSrcNm. Precedent JO must not be confused with eflaw detail JO.

Detail profiles: `eflaw` needs ID or MST; ID retrieves current law and ignores efYd, while MST plus efYd pins the selected version. Its JO is six digits (four article digits plus two branch digits). `prec` requires ID; the guide expressly identifies an HTML-only detail exception for National Tax Service precedent data. Exact JSON wrappers, numeric/string variants, nested cardinality and optional fields need approved capture before production parsing is finalized. Keep the existing v1 captured corpus intact.

## Registry proposals and rights boundary

`testOnlyGuideRegistry` exists only for executed shared-schema tests. It is not a product registry. Candidate hosts/paths in the manifest are proposals requiring root technical review and applicable live/public gates.

- MOLEG DRF endpoints are official documented paths. Never trust upstream/model/user URLs; construct requests and credential-free display links from server-validated IDs.
- EasyLaw `/CSP/CnpClsMain.laf` is a candidate exact path with numeric `csmSeq/ccfNo/cciNo/cnpClsNo` identity. The [official copyright policy](https://easylaw.go.kr/CSP/InfoCopyright.laf) permits commercial use of its provided information, with third-party works excluded. Admission must inspect the particular text and preserve attribution. Page-authored basis dates and pending-update notices are distinct from fetch timestamps. There is no broad whole-site or image crawl approval.
- KLAC `/legalstruct/summary.do` is corpus-disabled pending document-specific rights and date review. The cited [public-data page](https://www.klac.or.kr/disclosure/openingPublicData.do) marks its relevant works as KOGL type2 (noncommercial). This does **not** decide the rights of every KLAC page or dataset. Do not promote the historical synthetic KLAC example into an approved source.
- `ecfs.scourt.go.kr/psp/index.on?m=PSP720M01` is an adapter-unsupported candidate: the public fetch exposed no readable body; identity, extraction and reuse conditions remain unverified.

Existing shared URL checks are a minimum shape boundary, not complete SSRF protection or permission evidence. A future adapter additionally checks exact route, allowed query names/cardinality, numeric document identity, rights status and registered redirect hops. Sensitive search queries stay out of public cache. Publicly visible content is not automatically approved for caching or redistribution.

## Remaining adapter and live acceptance

Manifest `unexecutedAcceptanceCases` tracks stream byte limits, timeouts/Content-Length deceit, request reservations, consent/owner/revision/deletion races, immutable cache versions, exact span/hash and unrelated-claim rejection, and prompt/active-content isolation. The malformed responses and URL counterexamples are expectations only. No test here pretends to execute those adapters.

After #55 closes and its repository/cache PR merges, integrate bounded Workers transport, separate eflaw/prec/approved guide adapters, typed source availability and deterministic identity/span validation. #64 performs model semantic/policy review through llm-gateway; an intact citation never by itself proves applicability. Source gaps must retain factual preparation and prohibit model-memory legal fallback. #70/#71 retain policy/legal publication approval and same-SHA actual external evidence. This preparation does not close #63.
