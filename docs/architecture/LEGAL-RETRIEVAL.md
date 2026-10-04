# 법률정보 검색과 인용

- Canonical source: 국가법령정보 공동활용 Open API
- Scope: 대한민국 현행 법령의 조문
- Out of scope for MVP: 판례, 행정해석, 블로그, 언론, 모델 기억

## 정본과 기준일

분석마다 `asOfDate`를 한국 날짜로 고정한다. 검색 결과에서 법령 ID와 시행 이력을
확인하고 그 날짜에 시행 중인 조문 원문을 상세 API로 다시 가져온다. 단순 검색 snippet,
검색 엔진 캐시, 생성 모델의 법률 지식은 인용 원문이 아니다.

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
필요할 것으로 예상되는 조문도 법률 전문가의 범위 검토를 통과한 뒤 fixture에 넣는다.

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
