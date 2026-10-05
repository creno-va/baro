# Official legal response fixtures

Collected: 2026-10-05. Reviewed by BARO implementation agent on 2026-10-05.
API schema: eflaw JSON, official 시행일 목록/본문 guide.

- Official guides: https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide and https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdInfoGuide
- Source: https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415
- Official law ID: 001706; MST: 284415; effective date: 2026-03-17.
- Public guide sample OC=test was used for collection; no approved private OC or case input was used.
- official-sample.json is a response subset retaining original basic information and articles 598–608. No text was synthesized.
- SHA-256 of saved subset: 68462b93af712ef02bdfdefe6bd5d17e8df1c78a5f3084a8c026fb1528409ba7
- official-list.json is the public list response. Public sample links retain OC=test; application citation URLs never include OC.

These fixtures validate parsing/cache/URL/date/hash behavior, not legal applicability approval. Actual approved OC/environment smoke and response availability remain #27; public scope/legal approval remains #20. Runtime imports of test fixtures are forbidden by boundaries:check.
