# 사건·분석 실행 계약

- Contract: v1, 2026-10-05

이 문서는 v1의 누적5문항/단일 분석 실행 계약을 보존한다. v2의 연속 사건 작업 공간,
반복 질문·채팅·자료·심사·한도는 [v2 실행 계약](./V2-CONTRACTS.md)을 따른다. 기존 완료
결과의 읽기·삭제를 유지하고 명시적 전환 없이 v1 사건을 자동 재분석하지 않는다.
- Decision: [ADR-0005](../adr/0005-durable-execution-and-release-gates.md)
- Owners: #28 shared contract, #8 schema, #11 admission, #13 execution, #17 deletion

#28의 Zod shared 계약과 합성 fixture는 구현되었다. #8은 저장 primitive를 구현하며 admission·Workflow·삭제 운영 흐름은 후속 #11/#13/#17의 목표다. 이후 작업은 같은 타입을 import한다.

## 값과 한도

ID는 `crypto.randomUUID()`의 UUIDv4다. 목록 정렬은 `(created_at DESC, id DESC)`이며 ID 시간 정렬을 가정하지 않는다. 앱 시각은 UTC ISO 문자열, 날짜는 `YYYY-MM-DD`, Better Auth date는 adapter의 millisecond integer다. 문자열 길이는 trim 후 Unicode code point 수다. 서술 20~5,000자, 한 답변 0~1,000자, 요청 body 최대 64KiB다. unsupported field는 strict Zod에서 거부한다.

정책 동의는 인증보다 상위의 gate가 아니다. health·OAuth·동의 조회/저장·로그아웃·계정 삭제는 미동의 사용자도 접근할 수 있다. 사건 생성/분석/답변/retry는 현재 필수 동의가 필요하다. 과거 사건 조회/삭제는 세션·소유권만 요구해 정책 변경이 자신의 데이터 접근·삭제를 막지 않는다.

세션 기본 목표는 7일, 갱신 간격 1일이다. 계정 삭제의 최근 인증은 마지막 OAuth 인증 10분 이내로, sliding session update와 구분한다. #10은 실제 재인증 timestamp를 검증하는 계약을 제공하고 #17은 이를 사용한다.

## 사건 생성 admission

1. 인증·현재 동의·strict body·단기 abuse limit을 검증한다. raw body/토큰을 로그에 남기지 않는다.
2. idempotency key는 16~128자 `[A-Za-z0-9_-]`, scope는 `(user_id, method, route, key)`다. hash는 trim된 narrative 등 업무 필드의 canonical JSON SHA-256이며 **Turnstile 토큰·requestId는 제외**한다. 유효한 기존 key/hash면 저장 응답을 돌려주며 Turnstile/quota를 다시 소비하지 않는다. 다른 hash면 409다. 동시 요청은 unique constraint로 승자를 결정한다.
3. 새로운 요청만 Turnstile을 검증한다. `action=case_create`, hostname은 환경별 정확한 host다. 토큰이 없거나 검증 불가능하면 admission을 하지 않는다. 이후 new case/revision=1, analysis/attempt=1, quota 증가, idempotency 응답, dispatch outbox를 D1 batch 하나로 기록한다. quota predicate의 모든 종속 INSERT/UPDATE를 같은 admission 조건으로 묶는다. quota 10에 도달해 UPDATE가 0행이면 부분 INSERT가 없어야 한다.
4. 기본 case 상태 `screening`, analysis 상태 `queued`, 응답 201 `{caseId, analysisId, inputRevision:1, status:"screening"}`이다. 초기 제목은 고정 `금전 대여 사건`이며 원문에서 이름/금액을 제목으로 추출하지 않는다.
5. batch 후 동일 ID를 Workflow에 dispatch한다. 실패해도 사건을 재생성하지 않고 outbox를 유지한다. primary DB가 정본이며 배경 reconciliation이 재전달한다. #11은 동일 commit 전 crash, commit 후 crash, dispatch 후 crash를 각각 검증한다.

quota는 KST 신규 사건 admission마다 1회, screening 실패·범위 밖·긴급도 포함한다. 추가 답변·동일 revision 시스템/사용자 retry는 차감하지 않는다. retry 제한은 아래 규칙으로 비용 남용을 막는다. idempotency 응답은 최소 24시간 유지하고 만료 key 재사용은 새 요청이 된다.

단기 abuse limit은 생성 IP당20/60초와 계정당5/60초, answers/retry는 계정당 합계10/60초다. Cloudflare Rate Limiting binding의 근사 제한이며 정확한 일일 quota를 대신하지 않는다. IP는 binding key 계산에서만 사용하고 DB/log에 저장하지 않는다. `Retry-After:60`과 429를 반환하며 인증 사용자에게만 account key를 만든다. valid idempotency replay도 abuse limit은 적용하되 Turnstile/일일 quota는 다시 소비하지 않는다.

#11은 Worker scheduled handler의 1분 cron으로 pending outbox를 재전달한다. bounded batch 최대100개, backoff 1/2/4/8분 이후15분으로 제한한다. 24h 안에 dispatch하지 못하면 analysis를 retryable `DISPATCH_FAILED`로 전환하고 terminal outbox를7일 뒤 정리한다. 동일 instance가 이미 있으면 조회해 성공으로 처리하며 사용자가 retry하면 새 attempt/outbox를 만든다. #17은 같은 scheduler에 삭제 job reconciliation을 추가한다. 두 단계 모두 lease/CAS와 활성 소유 데이터 확인이 필요하다.

## 상태 전이

`draft`는 브라우저의 미제출 상태이며 D1에 저장하지 않는다. `deleted`는 UI 설명이고 물리 삭제 뒤 case row가 아니다.

| 현재 case | 허용 다음 case | analysis 상태 |
| --- | --- | --- |
| screening | needs_clarification, queued, out_of_scope, urgent_redirect, failed | screening → waiting_for_answers / queued / completed / failed |
| needs_clarification | queued, failed | waiting_for_answers → superseded 또는 failed |
| queued | analyzing, failed | queued → retrieving |
| analyzing | completed, failed | retrieving → generating → validating → completed/failed |
| failed | queued (retryable이며 사용자 재시도) | failed → queued, attempt 증가 |
| completed/out_of_scope/urgent_redirect | 삭제만 | terminal |

범위 밖·긴급 결과는 `completed` analysis의 strict discriminated result (`kind:out_of_scope|urgent_redirect`)이며 법령 retrieval·일반 guidance를 실행하지 않는다. 일반 완료는 `kind:guidance`다. `failure_code`는 허용 enum이며 stack/외부 body가 아니다.

active analysis는 한 case에 하나다. `cases.current_analysis_id`와 revision 조건이 정본이다. active 상태에 대한 partial unique index도 둔다. 이전 revision의 analysis는 `superseded`가 되어도 사용자에게 과거 결과를 정본으로 반환하지 않는다.

## 질문·답변

최대 질문 5개는 **한 사건 전체 누적**이다. MVP는 한 번의 질문 묶음만 허용한다. 답변 후 추가 질문 루프를 실행하지 않고 부족한 정보는 `unknowns`로 결과에 남긴다. 질문 대기는 질문 생성 시각부터 24시간이다. 만료하면 `CLARIFICATION_EXPIRED`, retryable=false로 실패하고 새 사건을 안내한다.

질문은 `{id, prompt, answerType:"text"|"choice", options:string[]}`이며 choice의 options는 2~6개, 질문 prompt 1~300자다. 서버 생성 ID는 묶음 안에서 unique다. 답변 요청은 `{inputRevision, answers:[{questionId, status:"answered"|"unknown"|"skipped", value?:string}]}`다. 모든 질문에 정확히 한 항목이 있어야 하며 unknown/skipped에는 value를 허용하지 않는다. answered text는 1~1,000자, choice는 options allowlist다.

답변 admission은 소유권·대기 상태·revision·기한·idempotency를 검증한다. 단일 batch에서 기존 analysis를 superseded로 바꾸고 답변을 암호화해 저장, case.input_revision을 1 올리고 current analysis를 새 ID로 바꾼 뒤 queued/outbox를 만든다. 새 입력 envelope는 원 서술과 승인된 답변을 함께 가진다. 중복 전송은 같은 응답이고 늦은 답변은 409다. event에는 원문 대신 새 analysis ID와 revision만 보낸다. waitForEvent의 신호가 유실되어도 D1/outbox 정본에서 복구한다.

## 모델·단계 retry

각 phase의 결과는 암호화 checkpoint와 version/hash로 저장한다. step cache는 opaque reference만 반환하며 Workflow 함수/instance 반환값에도 평문을 넣지 않는다. 입력 로드·외부 호출·쓰기 직전에 살아 있는 case/current analysis/revision을 확인한다. 쓰기는 동일 조건의 `UPDATE ... WHERE ...` 또는 guarded INSERT이며 row가 없으면 중단한다.

외부 timeout: 법률/Turnstile 10초, 모델 60초. transient network/429/5xx는 최초 포함 최대 3회, 1초·2초 backoff + jitter (Retry-After는 최대 30초). schema 교정은 phase당 최대 1회이며 **교정 포함 총 모델 호출도 phase당3회**를 넘지 않는다. 호출 전 durable attempt counter를 기록해 Workflow replay와 adapter retry가 예산을 각각 중복 적용하지 않게 한다. policy/citation critical failure는 교정 없이 종료한다. 질문 대기 외 실행은 10분 안에 실패로 수렴한다.

명시적 사용자 retry는 실패가 retryable이고 같은 revision일 때 최대 2회다. analysis ID/revision을 유지하고 `attempt`를 증가시켜 새 instance ID `analysisId-attempt`를 만든다. 이전 instance는 terminal 상태여야 한다. 반환은 202 `{analysisId,inputRevision,status:"queued"}`다. 동시 retry는 CAS와 idempotency로 같은 attempt를 반환한다. completed/superseded 또는 non-retryable은 409다.

모델 외부 호출과 checkpoint commit 사이의 crash는 중복 과금을 만들 수 있다. provider가 보장하지 않은 exactly-once를 주장하지 않는다. attempt budget, Gateway spend limit, checkpoint 재사용, ambiguous failure 관측으로 비용을 제한한다.

## 삭제·복구

사건 DELETE는 세션/소유권을 확인한다. primary batch에서 opaque `deletion_jobs`를 기록하고 cascade delete한다. 204는 primary 삭제 완료를 의미하며 Workflow 저장 상태·backup 잔존까지 즉시 없어졌다는 뜻이 아니다. 타인/없는 ID는 둘 다 404다. 같은 deletion idempotency key 재전송만 저장된 204를 돌려준다.

삭제 job은 target ID, 삭제 시각, workflow instance IDs, 처리 단계/attempt만 보존하고 원문·이메일·토큰을 담지 않는다. reconciliation은 실행 중/완료 Workflow 상태를 제거하고 실패를 비민감 alert로 재시도한다. 삭제 뒤의 step는 guarded write와 FK 때문에 새로운 데이터/결과를 만들 수 없다.

계정 DELETE는 최근 OAuth 인증과 `{confirmation:"DELETE"}`를 검증한다. 삭제 job·세션 폐기·소유 데이터 cascade를 한 batch로 기록한 뒤 202를 반환한다. settings UI는 재인증 완료 후 다시 명시적 확인을 요구한다. 인증 계정/동의/IP/User Agent도 삭제 범위에 포함한다.

platform backup 복구 시 deletion journal을 먼저 적용한 뒤 traffic을 연다. journal 보존 목표는 backup 복구 범위+5일(현재 목표 35일)이며 실제 Cloudflare plan/법률 정책 #20 검증이 있어야 공개한다. 삭제 완료 worker state 제거와 journal GC는 별도다. 원문 shadow copy를 만들지 않는다.

## shared 결과 v1

결과는 strict discriminated union이며 모든 branch에 `schemaVersion:"1"`, `kind`, `asOfDate`, `notices:string[]`를 둔다. guidance는 다음 필드가 필수다.

ID는 서버 생성 opaque ID 또는 검증된 source ID다. notices는 최대5개 각1~500자, title/label은1~100자, event는1~300자, explanation/uncertainty는1~2,000자, why/purpose/caution은1~1,000자다. timeline date는 유효한 YYYY-MM-DD 또는 null, citation 연결 배열은 최대20개의 중복 없는 ID다. 빈 불확실성은 생략하지 않고 알려지지 않은 점을 설명한다. #28은 모든 문자열·배열에 유한한 한도를 적용한다.

| 필드 | 타입·한도 |
| --- | --- |
| summary | `{userStatements:string[],organizedByAi:string[],unknowns:string[]}` 각 최대20 항목, 항목1~300자 |
| timeline | 최대20 `{date:string|null,event:string,source:"user"|"ai_organization",confidence:"stated"|"inferred"|"unknown"}` |
| issues | 최대10 `{id,title,explanation,uncertainty,citationIds:string[]}` |
| evidenceChecklist | 최대20 `{id,label,why,status:"provided"|"missing"|"unknown"}` |
| nextSteps | 최대10 `{id,label,purpose,caution,citationIds:string[]}` |
| citations | 최대20 `{id,sourceId,lawName,article,effectiveDate,verifiedAt,url,contentHash}` (DATA-MODEL 대응) |
| noticeVersion | 현재 AI 고지 버전 |

범위 밖·긴급 branch는 `reasonCode`, `message`와 서버 allowlist의 `helpLinks:[{label,url}]`만 추가한다. 모델이 링크를 만들어 반환하지 않는다. plain HTML은 허용하지 않는다. citation 연결된 주장도 별도 semantic/policy 검사 대상이다. evidence 체크는 브라우저의 휘발성 상태이며 P0에서 DB 저장하지 않는다.

## 목록·조회

목록 query는 limit=1~50(기본20), cursor는 서버가 base64url로 encode한 마지막 `(createdAt,id)` 값이다. strict parse하고 모든 쿼리에 session.user.id를 넣는다. cursor는 권한 수단이 아니다. 결과 `{items:[{id,title,status,createdAt,updatedAt}],nextCursor:string|null}`. 상세는 `{caseId,title,status,inputRevision,analysisId,questions:[]|Question[],result:Result|null,error:Error|null}`이며 current analysis만 반환한다.

polling은 1·2·4·8·15초 후 최대15초, 탭이 숨겨지면 멈춘다. terminal 상태에서는 중단한다. `Retry-After`가 있으면 적용한다. 답변/retry/생성의 성공 이후 상세 화면은 서버 정본을 다시 읽는다.
