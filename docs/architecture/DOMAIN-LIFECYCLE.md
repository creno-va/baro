# 사건·분석 실행 계약

- Contract: v1 보존, v2 사용량·비용 실행 정본 추가 (2026-10-06)

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

## v2 사용량과 비용

- Status: Implementation target; #57 독립 계약 준비이며 제품·DB·cloud cap 구현 완료 증거가 아니다.
- Decisions: [ADR-0013](../adr/0013-resource-admission-and-budget.md), [v2 실행 계약](./V2-CONTRACTS.md).
- Owners: #55 schema/repository, #57 usage/budget, #58/#59 자료 admission/처리, #64 응답 publish, #67 삭제.
- 운영 정본: [비용·환경 할당 절차](../operations/COST-CONTROLS.md), [실제 readiness](../operations/ENVIRONMENT-READINESS.md).

이하 v2 activation 뒤 사용량·비용에 적용한다. 위 v1 사건 상태·결과·읽기/답변/retry/삭제 계약은
보존하며 새 사건은 v2로 생성한다. legacy 신규 admission은 닫거나 동일 하루3개 counter를
사용한다. cutover 당일 기존 생성분도 같은 counter에 포함하고 역사적10회와 새3회를 더하지
않는다. legacy 모델 실행도 이 비용 정본과 논리 AI 응답 quota를 따른다. 전환 전 완료 결과를
자동 재분석하거나 동의 없이 새 모델 작업을 실행하지 않는다.

### 논리 작업과 quota 전이

서버가 만든 `operationId`는 한 사용자 동작과 고정 입력 revision의 정본이다. `phase`는 내부
추출/교정/검증 단계이며, `invocationId`는 해당 작업 안의 개별 모델·ASR·처리 호출이다.
`attempt`는 그 invocation의 실제 외부 시도 순번이다. 여러 프레임·chunk·교정 호출을 하나의
사용자 응답 횟수나 하나의 과금 시도로 합치지 않는다. replay 때 새 invocation ID를 임의로
만들지 않고 durable 계획과 checkpoint를 재사용한다. shared attempt 상한은 허용 가능한
schema 범위이며 실행 retry는 서비스별 더 작은 검증된 상한을 적용한다.

| quota | initial reservation | consumed 시점 | released / retry |
| --- | --- | --- | --- |
| 신규 사건 KST 하루3개 | 생성 admission의 operation/day에1개 | 사건·operation·idempotency 생성 commit과 원자적으로 소비 | 생성 실패는 전체 rollback. 생성 뒤 삭제/분석 실패로 일 allowance를 반환하지 않음 |
| 사용자 AI 응답 KST 하루30회 | 사용자에게 보일 응답 operation/day에1개 | 검증된 질문 묶음·요약·채팅·AI 자료 해석 publish commit과 원자적으로 소비 | 미게시 terminal 실패/취소는 reserved를 멱등 release. 같은 operation retry는 원래 day에서 재예약 |
| 음성/영상 KST 하루3600초 | server probe로 확인한 실제 원본 duration | 최초 실제 media 처리 start의 durable commit에서 소비 | start 전 취소/실패만 release. start 이후 retry/실패는 consumed 재차감·반환 없음 |

한 질문 묶음의 여러 질문, 응답 생성 전 내부 minimization/교정/정책 검증은 추가 응답이 아니다.
새 사용자 메시지·새 자료 해석·사용자에게 새로 게시할 질문 묶음/요약은 각각 새 operation이다.
텍스트 추출·이미 만든 PDF/ZIP 읽기·다운로드·삭제는 AI 응답 quota를 소비하지 않는다. 새 유료
export 조립은 사용자 AI quota와 별개로 비용 예약을 요구한다. 비용이 있는 probe도 무료 작업으로
숨기지 않으며 duration 미확인은0초가 아니라 검증 대기다.

media 시간은 fractional seconds를 보존하거나 정확한 정수 millisecond 정본에서 환산한다.
0초는 거부하고0.5초 같은 유효 자료를 정수 seconds CHECK로 거절/절삭하지 않는다. 반복 chunk
overlap과 시스템 retry의 추가 처리 시간은 사용자 원본 duration과 별도로 실제 비용에 기록한다.

quota `reserved → consumed/released`는 reservation와 해당 day counter를 한 batch에서
이동하고0행 CAS의 종속 쓰기를 막는다. 동일 publish/release/start replay는 다시 차감하지 않는다.
released 작업의 retry는 같은 operation ID와 원래 day에서 한 슬롯을 원자적으로 다시 확보한다.
그 day의 다른 작업 때문에 남은 allowance가 없으면 재시도를 보류하며 새 day로 옮겨 우회하지
않는다. 이미 consumed인 operation retry는 사용자 quota를 다시 예약하지 않는다. 실제 외부
비용은 어느 경우에도 새 attempt마다 예약한다. 미게시 실패를 환불해도 비용·abuse/retry 상한은
남는다. 삭제된 target·오래된 revision·취소/종료 lease는 quota 재예약이나 publish를 승인하지 않는다.

### 원자적 admission과 replay

인증·현재 동의·소유권·alive target·입력 revision·bounded resource 계획을 검증하고,
서버 시각에서 KST day/month를 정한다. 사용자 counter·저장 예약·필요한 비용 hold·operation/
job/outbox/idempotency는 같은 D1 안에서 동일 admission claim에 종속시킨다. snapshot schema
통과는 실제 승인이 아니다. `UPDATE 0행`은 자동 rollback이 아니므로 다른 종속 INSERT/UPDATE가
성공할 수 없게 한다. unique key/CAS와 전체 batch rollback으로 경합의 승자를 결정한다.
서로 다른 환경 DB나 provider 호출은 이 transaction에 포함되지 않는다.

대형 snapshot/파일을 통째로 메모리에 읽거나 수천 개의 observation을 한 D1 batch에 넣어
이 원자성을 구현하지 않는다. [D1 제한](https://developers.cloudflare.com/d1/platform/limits/)은
invocation당 Free50/Paid1000 queries, row/string/BLOB2MB, query bound parameters100,
SQL query 및 전체 batch duration30초이며 [Workers isolate 메모리](https://developers.cloudflare.com/workers/platform/limits/)는
128MB다. D1의 구체적 한도를 일반 Worker subrequest 한도와 혼동하지 않고 적용한다.
이는 현재 계정의 Paid 활성화 근거가 아니다.

상한 안에서도 실제 bytes/query 수·암호화 overhead·시간·메모리를 제한한 staging chunk로
처리한다. stage 시작 admission은 quota/출력 공간/비용을 예약하고, 저장된 chunk마다 고정
operation/revision·순서·checksum·크기·lease를 연결한다. 작은 원자적 publication batch에서
완전한 manifest와 alive target/current revision/CAS를 검증한 뒤 visible pointer·응답 소비를
commit한다. 미완성 stage는 정본 응답으로 노출하지 않는다. shared 최대 허용량을 구현 편의로
조용히 절삭하지 않으며, 대형 입력은 bounded handoff 또는 명시적 대기/오류로 처리한다.
crash/replay는 검증된 chunk를 재사용하고 failed/superseded/deleted stage는 멱등 정리한다.
모든 실제 재처리/저장 비용을 기록하고 객체 삭제 receipt 전 저장량을 반환하지 않는다.

idempotency scope는 인증 계정·method/route·key이며 hash는 canonical 업무 입력과 고정
revision을 포함하고 Turnstile token/request ID를 제외한다. 미만료 동일 key/hash는 저장된
operation을 반환하고 다른 hash는 conflict다. 만료 key의 재사용은 새 요청이다. expiry-aware
claim과 같은 batch의 만료 행 제거/교체로 영구 unique 충돌을 막되 과거 operation·비용·삭제
정본을 삭제하지 않는다. expired key 재사용은 기존 논리 작업 retry로 위장하지 않는다.

UTC timestamps는 비교/저장 전에 canonical ISO milliseconds로 정규화한다. 같은 초의
`...00Z`와 `...00.001Z`를 문자열 형태 차이 때문에 역순으로 판정하지 않는다. quote는 서버의
신뢰할 수 있는 가격/환율 정본으로 생성하며 client 제공 금액·providerPricingVersion을 승인
근거로 쓰지 않는다. 실행 직전 quote/funding 유효성·target/lease·budget을 다시 확인한다.
만료 견적은 대기 사유를 남기고 재견적한다. 기존 hold의 교체/증액도 원자적이며 이전 hold를
먼저 지워 새 비용을 승인하는 틈을 만들지 않는다.

### 실제 비용과 불명확한 실행

외부 호출 전에 operation/invocation/attempt·환경·KST 월·quote 버전·최대 비용을 durable
기록한다. phase 계획의 hold를 attempt로 전환할 때 같은 금액을 중복 예약하거나 누락하지
않는다. retry는 durable ordinal을 증가시키며 실제 provider retry가 숨겨져 있으면 그 횟수까지
상한에 포함한다. 최대 입력/출력·프레임/chunk·실행 시간 근거가 없는 paid 작업은 보류한다.

provider 응답의 허용된 request 상관 ID·token/duration 등 usage는 출력 schema/정책 검증에
성공했는지와 별개로 먼저 durable 정산한다. 유효하지 않은 JSON·거절·길이 종료도 과금될 수
있다. usage 미확인/timeout/외부 성공 후 checkpoint 전 crash는0원이 아니라 `ambiguous`다.
observer/로그 best-effort 전달을 ledger 정본으로 사용하지 않는다. 사건 원문·파일명·prompt/
response·인증 URL·token·stack을 비용 기록에 넣지 않는다.

`reserved → settled/ambiguous/released`, `ambiguous → settled` 정산은 receipt/CAS와 월
집계를 같은 batch에서 한 번만 이동한다. ambiguous 전이는 예약액을 reserved 합계에서
ambiguous 합계로 옮겨 한 번만 계산한다. TTL 만료나 호출 실패만으로 ambiguous를 자동
release하지 않는다. 과금 없음이 나중에 명확히 확인되면 그 근거의 receipt로 실제0원 settled를
기록한다. 미전송 등 확인된 무과금 reserved만 release하며 새로운 호출은 별도 비용을 예약한다.
late receipt는 기존 attempt를 정산하고 추가 모델 호출을 만들지 않는다. abort를 보장하지
않는 binding timeout 뒤 미확정 호출과 즉시 겹치는 retry를 하지 않는다.

실제 청구가 예약/월 한도를 초과해도 정산액을 잘라내거나 삭제하지 않는다. 관측 초과와
uncertainty는 `remaining/available = max(0, limit-used-reserved)` 또는 비용 committed 합계로
표시하고 새 paid admission을 닫는다. 환경 합계·필수 보관/읽기/삭제 비용은 운영 절차의
versioned allocation 정본으로 제한한다. 정확한 환율·단가·funding 근거가 없으면 fail-closed다.

### KST 경계와 삭제 이후 정산

KST 다음 자정은 usage day의15:00 UTC다. 자정 전 예약의 완료/retry는 원래 day를 정산하고
새 요청만 새 day를 사용한다. 월 전환은 과거 settled/ambiguous/hold를 지우지 않는다. 새 달
maintenance·보관 비용·진행 중 exposure를 예약하고 공급자의 UTC 일/구독 갱신 기간과
대조한다. carry-over exposure reference와 실제 청구를 구분해 누락/중복 합산을 막는다.

사건 원본100개/5GB와 계정 전체10GB는 별도 scope다. pending 원본은 두 scope에 예약하고
파생물/PDF/ZIP/프로필 자산은 계정 scope에 예약한다. finalize는 reserved에서 stored로 이동해
이중 합산하지 않는다. 실제 원본/part/파생물/공개 복사본 정리가 확인되기 전에는 stored 사용량을
반환하지 않는다. 제품 logical bytes와 암호화된 physical storage/일별 peak 과금도 구분한다.
private blob과 실제 public copy는 각각 저장 예약을 가지며 공개 pointer 철회만으로 public
객체가 지워졌다고 판단하지 않는다.

계정/사건 삭제는 tombstone·job/download 폐기부터 기록한다. 새 외부 attempt와 늦은 publish는
막되 이미 발생한 비용 정산은 계속 허용한다. 비용·receipt·월 ledger는 user/workspace FK cascade
밖에서 opaque principal을 사용해 보존하고 계정 연결은 제거한다. 삭제 journal은 정리할 opaque
blob/job reference를 먼저 확보해 quota 예약·객체 목록을 cascade로 잃지 않게 한다. 아직 보관된
객체 비용과 미확정 시도는 삭제됐다는 이유로0원이 되지 않는다. 복구는 journal/비용 정본을
먼저 대조하고 재삭제·미확정 예약 reconciliation 후 traffic을 연다.

동시 N+1 admission·중복/만료 key·0행 CAS·중간 SQL 실패·0.5초media·KST 자정/월/cutover·
미게시 실패/retry·provider 거절/invalid usage·timeout/late receipt·삭제/정산 race를 합성으로
검증한다. 실제 가격/계정 meter/청구 대조는 #71의 별도 증거이며 문서·offline 통과로 대체하지
않는다. 이 계약은 공개 정책/사업자 사실/법률 검토를 승인하지 않는다.
