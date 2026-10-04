# HTTP API 계약

- Base path: `/api`
- Transport: HTTPS JSON
- Server: Hono in the Astro Worker
- Canonical contract after implementation: shared Zod schemas and inferred Hono RPC types

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
소유권 없음, 409 invalid state/idempotency conflict, 422 out-of-scope, 429 rate/usage,
503 retryable dependency failure.

## 인증

`/api/auth/*`는 Better Auth handler에 위임한다. 지원 공급자는 Google, Naver, Kakao다.
redirect URL은 환경별 allowlist만 허용한다.

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
성공 시 201과 `{ "caseId", "analysisId", "status": "screening" }`를 반환한다.

동일 사용자·동일 키·동일 body는 기존 응답을 반환한다. body가 다르면 409다.

### `GET /api/cases?cursor=&limit=`

본인의 사건만 최신순으로 반환한다. 각 item은 `id`, `title`, `status`, `createdAt`,
`updatedAt`만 포함한다.

### `GET /api/cases/:caseId`

사건 상태, 최신 입력 revision, 질문 또는 검증 완료된 결과를 반환한다. 저장된 원문은
사용자 화면에 필요할 때만 복호화하며 로그/캐시에 넣지 않는다.

### `DELETE /api/cases/:caseId`

사건·분석·인용을 cascade 삭제하고 204를 반환한다. 존재하지 않거나 타인 소유인 경우
모두 404다. 같은 삭제의 재요청은 사용자 경험상 성공으로 처리할 수 있으나 대상 존재
여부를 드러내지 않는다.

## 분석

### `GET /api/cases/:caseId/analysis`

최신 분석의 공개 상태와 `updatedAt`, retry 가능 여부를 반환한다. `Retry-After`가 있으면
클라이언트는 이를 따르고, 아니면 2초부터 최대 15초까지 지수 backoff한다.

### `POST /api/cases/:caseId/answers`

헤더 `Idempotency-Key`와 `{ "analysisId", "answers": [{ "questionId", "value" }] }`를
받는다. value는 schema에 맞는 string/choice/`unknown`/`skipped`다. 서버가 현재 질문
ID, 분석 소유권, `waiting_for_answers` 상태를 검증한 뒤 암호화 저장하고 Workflow에
이벤트를 보낸다.

### `POST /api/cases/:caseId/retry`

retryable `failed` 상태에서만 새 Workflow instance를 만든다. 원래 사용자가 시작한
같은 사건·revision의 재시도는 일일 사용량을 다시 차감하지 않는다. 변경된 입력으로
새 분석을 시작하면 차감한다.

## 공개 결과 형태

```json
{
  "summary": { "userStatements": [], "organizedByAi": [], "unknowns": [] },
  "timeline": [{ "date": null, "event": "", "source": "user", "confidence": "stated" }],
  "issues": [{ "title": "", "explanation": "", "uncertainty": "", "citationIds": [] }],
  "evidenceChecklist": [{ "id": "", "label": "", "why": "", "status": "unknown" }],
  "nextSteps": [{ "label": "", "purpose": "", "caution": "" }],
  "citations": [{ "id": "", "lawName": "", "article": "", "effectiveDate": "", "url": "" }],
  "noticeVersion": "2026-10-04"
}
```

Zod는 unknown key를 거부한다. `citationIds`는 같은 결과에 있는 검증된 ID만 참조할 수
있고, 법률 주장을 가진 issue는 하나 이상의 citation 또는 명시적 `확인 불가`를
가져야 한다.
