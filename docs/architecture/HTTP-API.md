# HTTP API 계약

- Base path: `/api`
- Transport: HTTPS JSON
- Server: Hono in the Astro Worker
- Canonical contract after implementation: shared Zod schemas and inferred Hono RPC types
- 상태·한도·idempotency·revision의 정본: [실행 계약](./DOMAIN-LIFECYCLE.md)

## 공통 규칙

- 인증 쿠키는 `Secure`, `HttpOnly`, 적절한 `SameSite` 속성을 사용한다.
- 상태 변경 요청은 Better Auth의 origin/CSRF 보호와 동일 출처 정책을 적용한다.
- 모든 응답은 `X-Request-Id`를 포함한다.
- 클라이언트가 보내는 `userId`, status, usage count는 무시한다.
- 날짜는 UTC ISO-8601, ID는 opaque string이다.
- 목록 cursor는 opaque하며 기본 20개, 최대 50개다.

## 오류 형식

```json
{
  "error": {
    "code": "CASE_NOT_FOUND",
    "message": "사건을 찾을 수 없어요.",
    "requestId": "01...",
    "retryable": false,
    "details": {}
  }
}
```

`details`는 필드 검증 오류처럼 공개 가능한 값만 포함한다. stack, SQL, 외부 응답,
프롬프트, 사건 원문을 반환하지 않는다.

주요 status: 400 validation, 401 unauthenticated, 403 consent/age, 404 not found 또는
소유권 없음, 409 invalid state/idempotency conflict, 429 rate/usage,
503 retryable dependency failure.

앱 오류의 requestId는 middleware가 생성/검증한 X-Request-Id와 같다. Better Auth 자체
응답은 라이브러리의 형식을 유지하며 앱 오류 envelope를 강제로 덮어쓰지 않는다.
알 수 없는 exception은 비민감 500으로 닫고 Error 객체/SQL을 serialize하지 않는다.

## 인증

`/api/auth/*`는 Better Auth handler에 위임한다. 지원 공급자는 Google, Naver, Kakao다.
redirect URL은 환경별 allowlist만 허용한다.
production의 `PUBLIC_BETA_ENABLED=false`에서는 health 외 API는 503 BETA_NOT_OPEN이다.
일반 로그인·동의·자신의 데이터 삭제는 미동의 사용자도 가능하다. 실제 제품을 연 뒤의
권한 구분은 DOMAIN-LIFECYCLE의 동의 규칙을 따른다.

## 사용자와 동의

### `GET /api/me/consent`

현재 요구 버전과 사용자의 동의 버전, `needsConsent`를 반환한다.

### `PUT /api/me/consent`

요청:

```json
{
  "termsVersion": "2026-10-04",
  "privacyVersion": "2026-10-04",
  "aiNoticeVersion": "2026-10-04",
  "over14Confirmed": true
}
```

서버의 현재 버전과 정확히 일치해야 한다.

### `DELETE /api/me`

최근 인증 확인과 본문 `{ "confirmation": "DELETE" }`를 요구한다. 202 Accepted 후
세션을 즉시 폐기하며, 삭제 workflow 상태를 외부에 장기 노출하지 않는다. 삭제 실패는
운영 경보의 P0다.

## 사건

### `POST /api/cases`

헤더 `Idempotency-Key`와 요청 `{ "narrative": "...", "turnstileToken": "..." }`를
요구한다. 20~5,000자, 동의, Turnstile, 짧은 rate limit, KST 일일 10회를 검증한다.
성공 시 201과 `{ "caseId", "analysisId", "inputRevision": 1, "status": "screening" }`를 반환한다.

동일 사용자·동일 키·동일 업무 body는 기존 응답을 반환한다. 업무 body가 다르면 409다.
Turnstile token/requestId는 hash에서 제외하고 replay는 토큰 검증보다 먼저 확인한다.
범위 밖 사건도201 admission 뒤 terminal out_of_scope 결과이며 HTTP422로 거부하지 않는다.

### `GET /api/cases?cursor=&limit=`

본인의 사건만 최신순으로 반환한다. 각 item은 `id`, `title`, `status`, `createdAt`,
`updatedAt`만 포함한다.

### `GET /api/cases/:caseId`

사건 상태, 최신 입력 revision, 질문 또는 검증 완료된 결과를 반환한다. 저장된 원문은
사용자 화면에 필요할 때만 복호화하며 로그/캐시에 넣지 않는다.

### `DELETE /api/cases/:caseId`

사건·분석·인용을 cascade 삭제하고 204를 반환한다. 존재하지 않거나 타인 소유인 경우
모두 404다. 같은 deletion Idempotency-Key만 저장된 204를 재생한다. 204는 primary 삭제
완료이며 Workflow 저장 상태/backup 제거는 deletion job의 후속 정리다.

## 분석

### `GET /api/cases/:caseId/analysis`

최신 분석의 공개 상태와 `updatedAt`, retry 가능 여부를 반환한다. `Retry-After`가 있으면
클라이언트는 이를 따르고, 아니면 1·2·4·8·15초 backoff하며 terminal/숨겨진 탭에서 멈춘다.
응답 `{caseId,analysisId,inputRevision,status,updatedAt,retryable,retryAttemptsRemaining,error}`다.
status는 analysis enum, error는 공통 error object 또는 null, retryAttemptsRemaining은0~2다.

### `POST /api/cases/:caseId/answers`

헤더 `Idempotency-Key`와 `{ "inputRevision": 1, "answers": [{ "questionId": "q1",
"status": "answered", "value": "답변" }] }`를 받는다. unknown/skipped는 value가 없다.
현재 질문마다 정확히 한 답변, 소유권·revision·대기 상태·24시간 만료를 검증한다.
성공 시 revision+1의 새 analysis를 만들고 기존 analysis는 superseded로 바꾼다.
응답은 202 `{caseId,analysisId,inputRevision,status:"queued"}`다. 원문 event는 보내지 않는다.

### `POST /api/cases/:caseId/retry`

헤더 `Idempotency-Key`와 `{inputRevision}`을 요구한다. retryable failed에서 최대2회,
동일 analysis/revision의 attempt를 증가시키고 새 instance를 만든다. 응답202
`{analysisId,inputRevision,status:"queued"}`. quota는 추가 차감하지 않는다. 입력 변경
기능은 P0에 없으며 추가 답변의 revision 증가는 신규 분석 quota를 차감하지 않는다.

## 공개 결과 형태

```json
{
  "schemaVersion": "1",
  "kind": "guidance",
  "asOfDate": "2026-10-05",
  "notices": ["AI 생성 일반 정보이며 법률 자문이 아닙니다."],
  "summary": { "userStatements": [], "organizedByAi": [], "unknowns": [] },
  "timeline": [{ "date": null, "event": "", "source": "user", "confidence": "stated" }],
  "issues": [{ "id": "", "title": "", "explanation": "", "uncertainty": "", "citationIds": [] }],
  "evidenceChecklist": [{ "id": "", "label": "", "why": "", "status": "unknown" }],
  "nextSteps": [{ "id": "", "label": "", "purpose": "", "caution": "", "citationIds": [] }],
  "citations": [{ "id": "", "sourceId": "", "lawName": "", "article": "", "effectiveDate": "", "verifiedAt": "", "url": "", "contentHash": "" }],
  "noticeVersion": "2026-10-04"
}
```

Zod는 unknown key를 거부한다. `citationIds`는 같은 결과에 있는 검증된 ID만 참조할 수
있고, 법률 주장을 가진 issue는 하나 이상의 citation 또는 명시적 `확인 불가`를
가져야 한다.

위 예시는 필드 구조를 나타내며 빈 문자열은 유효 fixture가 아니다. out_of_scope와
urgent_redirect branch 및 정확한 배열/문자열 한도는 DOMAIN-LIFECYCLE을 따른다.

## 비민감 피드백

`PUT /api/cases/:caseId/feedback`은 세션·소유권과 `{helpful:boolean}`만 검증하며 자유
텍스트를 받지 않는다. #30이 선택적 수집 동의/집계를 구현한다. P0는 체크리스트 상태의
DB 저장, 입력 수정, 게스트 분석 endpoint를 제공하지 않는다.
