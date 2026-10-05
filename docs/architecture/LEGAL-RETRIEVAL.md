# 법률정보 검색과 인용

- Canonical source: 국가법령정보 공동활용 Open API
- Scope: 대한민국 현행 법령의 조문
- Out of scope for MVP: 판례, 행정해석, 블로그, 언론, 모델 기억
- 승인된 OC: `crenova` (환경 secret에 등록, query/로그에서 값 노출 금지)

위 범위는 v1의 법령 전용 adapter 계약이다. v2는 아래 공식 출처 확장을 목표로 하며
기존 adapter와 승인 OC의 live 성공을 자동 가정하지 않는다. private credential 오류 진단은
안전한 category만 남기고 raw 오류 메시지·OC·요청 URL은 기록하지 않는다.

## 정본과 기준일

분석마다 `asOfDate`를 한국 날짜로 고정한다. 검색 결과에서 법령 ID와 시행 이력을
확인하고 그 날짜에 시행 중인 조문 원문을 상세 API로 다시 가져온다. 단순 검색 snippet,
검색 엔진 캐시, 생성 모델의 법률 지식은 인용 원문이 아니다.
MVP 기준일은 사건 발생일이 아니라 신규 분석 admission 당일 KST다. 과거 행위에 적용될
법령·시효·기한의 확정 판단은 하지 않고 시점 적용의 불확실성을 표시한다. 법령 목록·상세
adapter의 target/type/ID와 시행일 query는 #14에서 공식 가이드·실응답으로 fixture에 고정한다.
문서만으로 확인되지 않은 endpoint shape를 구현자가 추측하지 않는다.

## 검색 절차

1. 사건 구조에서 법률 개념 검색어를 생성한다. 사람 이름·연락처·계좌번호는 검색어에
   포함하지 않는다.
2. 법령 목록 검색으로 후보와 공식 식별자를 얻는다.
3. 상세 조회로 법령명, 조문 구조, 공포·시행일을 확인한다.
4. `asOfDate`에 유효한 조·항·호를 최소 chunk로 자른다.
5. 원문 SHA-256, source URL, fetched/verified time을 기록한다.
6. 명확한 내부 citation ID를 생성해 모델에는 이 ID와 원문만 전달한다.
7. 결과의 모든 citation ID가 allowlist에 있고 주장을 실제로 뒷받침하는지 검사한다.

## 출처 식별자

정본 키는 다음 조합이다.

```text
statute:<official-law-id>:<effective-date>:<article-path>:<content-sha256>
```

표시에는 법령명, 조·항·호, 시행일, 확인일, 공식 HTTPS URL을 포함한다. URL은 허용된
`law.go.kr` 또는 `open.law.go.kr` host인지 파싱해 검사하며 문자열 prefix 검사만 하지
않는다.

## 캐시

- 공개 법령 원문만 `legal_source_cache`에 저장한다.
- TTL 만료 시 조건부 재검증하고 내용 hash가 바뀌면 새 버전으로 저장한다.
- TTL은24시간이며 stale cache를 새로운 분석에 쓰지 않는다. API가 조건부 요청을
  지원하지 않으면 다시 조회하고 동일 hash로 검증한다. 오래된 버전은 완료 인용 참조가
  있는 동안 유지한다. unique key에 content_hash도 포함해 기존 버전을 덮어쓰지 않는다.
- 완료된 분석의 citation은 당시 검증한 effective date와 hash를 유지한다.
- 재열람 시 원문이 바뀌었으면 `이후 변경될 수 있음`을 표시하고, 최신 분석을 자동으로
  덮어쓰지 않는다.

## 개발 fixture

API 승인 전 local/CI는 `tests/fixtures/legal/`의 snapshot을 쓴다. 각 fixture에는 다음이
필수다.

- 공식 source URL과 official source ID
- 수집 시각, 시행일, 조문 경로
- 원문 SHA-256
- 검수자와 검수일
- API 응답 schema version

fixture는 비운영 환경의 명시적 adapter에서만 읽는다. production build는 fixture import를
정적 검사로 금지하고, `LAW_API_OC`가 없으면 시작 또는 분석을 실패시킨다. 최초 사건에
필요할 것으로 예상되는 조문의 **공개 적용 범위**는 #20의 법률 검토를 통과해야 한다.
offline adapter fixture는 공식 응답 출처·hash 검증과 synthetic 입력만으로 준비할 수 있으며
법률 적용의 승인을 뜻하지 않는다. 외부 전문가 대기가 schema/adapter 개발 전체를 막지 않는다.

## 실패 처리

| 실패 | 동작 |
| --- | --- |
| API timeout/5xx | 제한 재시도 후 분석 실패, 기존 캐시를 무조건 최신으로 간주하지 않음 |
| schema 변경 | adapter 실패와 운영 경보, 결과 생성 중단 |
| 시행일 불명확 | 해당 조문 제외 |
| 조문과 주장 불일치 | 주장 삭제 또는 결과 실패 |
| URL host/ID 불일치 | 보안 실패로 격리, 인용 금지 |
| 빈 검색 결과 | 모델 지식으로 보충하지 않고 확인 불가 표시 |

## 운영 검수

주 1회 cache 실패율과 hash 변경을 확인하고, 법령 변경 알림이 있는 경우 관련 평가셋을
다시 실행한다. 인용 오류 신고는 사건 원문 없이 citation ID와 analysis ID로 추적한다.
오류가 확인되면 영향받은 결과를 표시 중단하고 사용자에게 재분석을 안내한다.

## 참고

- [국가법령정보 공동활용 Open API 가이드](https://open.law.go.kr/LSO/openApi/guideList.do)
- [공동활용 이용·신청 안내](https://open.law.go.kr/LSO/information/guide.do)

## v2 공식 출처 확장

[ADR-0011](../adr/0011-verified-official-source-expansion.md)에 따라 법령·공식 판례·공공기관
절차 안내를 별도 source type으로 검증한다. 모든 조회는 `legal-retrieval` 밖에서 호출하지
않는다. 임의 웹 검색·블로그·법무법인 마케팅·모델 기억을 official source로 바꾸지 않는다.

| type | 정본 식별·시간 | 인용 검증 |
| --- | --- | --- |
| `statute` | 법령ID·시행일·조항·hash | 기준일 시행 이력과 원문, 기존 v1 source ID 보존 |
| `precedent` | 공식 판례일련번호·법원·사건번호·선고일·원문 위치·hash | 목록 뒤 상세 원문 재조회, 사건명/법원/선고일 일치, 법령 시행일로 표기하지 않음 |
| `official_guide` | 승인된 기관/URL·문서ID·개정/게시/확인일·section·hash | 공식 host+redirect allowlist·문서 내용 최신성, 날짜 없으면 불확실성 표시 |

국가법령정보 `target=prec`의 목록과 상세 `ID` 경로는 공식 가이드에 존재하지만 account
권한/응답/필드 구조·이용 조건은 실제 승인 OC로 확인한다. HTML 전용 예외 자료를 JSON이
있다고 가정하지 않는다. 판례는 비슷한 사실에 동일 결과를 보장하거나 AI 승소 예측의 근거로
쓰지 않고 변호사에게 확인할 자료의 공식 reference로 제공한다.
[판례 목록](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precListGuide),
[판례 본문](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precInfoGuide)

source metadata는 type별 strict discriminated union으로 확장하고 lawName/article/
effectiveDate 필수인 v1 citation을 억지로 guide/판례에 적용하지 않는다. fetchedAt,
verifiedAt, hash, canonicalUrl, exact text span은 공통이며 `confidence`는 실제 검증 수준을
넘지 않는다. 사용자 파일 관찰은 `user_material`로 별도 처리하고 official citation으로
승격하지 않는다. query는 최소화된 법률 개념만 쓰며 이름·회사 고유정보·연락처·계좌를 넣지 않는다.

기관 안내 adapter는 승인된 기관/endpoint/문서 형식 allowlist와 timeout/body-size/HTML
safe extraction을 갖추고 redirect·사설IP·임의 URL을 거부한다. raw corpus의 개인정보와
active content는 공개 cache에도 그대로 복사하지 않는다. 기준일/본문/hash가 불명확하면
사용자에게 확인 필요를 표시하고 단순 검색 snippet으로 인용하지 않는다.

공식 출처 unavailable 시 사실 정리·자료 목록·선택 원본 내보내기는 유지할 수 있다.
법적 판단·기한·전략은 생성하지 않고 검증 못한 법률 설명은 PDF/채팅에서 제외한다.
source cache의 hash mismatch, 잘못된 판례 ID/선고일, stale guide, redirect 위조,
구조 변경·등록/IP/credential 오류와 live Worker 성공을 각각 검증한다. 실제 출처 확장,
업데이트 운영과 공개 법률 범주는 downstream 구현/승인 이슈의 미완료 조건이다.
