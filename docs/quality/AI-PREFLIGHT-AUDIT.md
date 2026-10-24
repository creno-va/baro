# Preview AI 사전 검사 감사

> **2026-10-14 프리베타 비용 관측 전용 — 현행 지시:** `APPLICATION_COST_LIMITS_ENABLED=false`에서 비용 금액·가격/FX/funding 관측 누락·만료·월별 할당·비용 승인·수동 refresh·유지비·비용 예약 IO 횟수로 기능이나 배포를 막지 않는다. 사용자 재지시 전 재도입 금지. 비용 원장·관측 사실은 보존하며 관측 시각/금액을 조작하지 않는다. AI200/일·실제 기술용량/횟수·권한/보안/무결성·실제 공급자 오류는 유지한다. 아래 과거 비용 차단 지시·실패 기록보다 [현행 정책과 구현 상태](../operations/PREBETA-COST-POLICY.md)가 우선한다.

- 감사일: 2026-10-07 KST
- 범위: preview AI 관련 API의 실제 서버 조합, 예산·저장·미디어 의존성, 기존 검사 범위
- 상태: 소스 감사와 아래 명시한 offline 테스트 완료. 이 문서는 preview 전체 AI 성공이나 배포 완료 증거가 아니다.

사용자는 preview에서 예산 오류 뒤 의존성 오류가 반복되는 문제에 대해 전체 사전 검사를
요청했다. 바인딩이 존재하거나 격리 모델 호출 하나가 성공하더라도 실제 API의 admission,
암호화 저장소, 비용 예약, Workflow 조합, 모델 호출, 결과 저장이 모두 작동한다는 뜻은 아니다.
이 문서는 당시 확인된 조합 누락을 기록한다. 인증·외부 공개 조건은 유지하며, 과거 예산
차단 계약은 문서 첫머리의 2026-10-14 비용 정책으로 대체한다.

## 증거 범위

| 검사 | 확인한 사실 | 확인하지 않은 사실 |
| --- | --- | --- |
| 제품 소스와 호출 지점 감사 | 실제 API/Workflow가 제공하는 의존성과 필수 조건의 불일치 | 수정 candidate의 원격 리소스 정상 작동 여부 |
| 관련 테스트 3개 파일 | ledger·vision capability·storage bounds 누락을 거부하는 제품 동작 | 외부 모델, 원격 D1/R2/Container/Whisper 호출 성공 |
| 텍스트 AI 재시도 | native workerd D1 + 인증된 Hono 요청에서 SQL 표현식 깊이 제한 오류를 재현. 해당 수정 후 재시도 202→완료 검사 통과 | 실제 preview 배포 반영 및 외부 provider 성공. 나머지 전체 검증 결과는 별도 확인 필요 |
| 환경·D1 사전검사 | 읽기 전용 검사 구현 및 합성 DB 회귀. Worker 내부 설정, 실제 예약금, proof 만료·현재 KST 월·SKU·schema 검사 | 새 검사의 원격 실행과 실제 provider 성공은 별도 확인 |
| 기존 원격 metadata 검사 | [실행 37538844504](https://github.com/creno-va/baro/actions/runs/37538844504): preview SHA `868fd09133f1006e2c526a539ea3f253b6f58f3f`, 필수 secret 및 처리 binding 존재 확인 | Gateway metadata는 HTTP 403으로 미검증. 기존 검사 성공을 전체 AI 정상으로 해석하지 않음 |

이 감사에서 원격 리소스를 변경하거나 새 유료 호출을 수행하지 않았다. 관련 명령 결과는
아래에 기록했으며 별도 결과 artifact를 생성하지 않았다. 따라서 존재하지 않는 CI·배포·
live smoke 결과 링크를 증거로 사용하지 않는다.

## 2026-10-14 채팅 실패·재시도 후속

기준 main `0c6211074d2d451f9cde54671b0d80cb1a402fa2`에서 #64의 실패 기록과
#71의 10월13일 관측을 다시 대조했다. 채팅 strict schema의 기본값 필드 누락과
workspace 읽기 경합은 PR220에 병합됐다. 아래 과거 D1 표현식 깊이 결함도 이미
수정돼 있다. 현재 native workerd D1에서 실제 제품 API·비용 예약·암호화 경로로
질문/채팅 HTTP400 실패→재시도202→완료를 검사했으며, 이전 ambiguous 비용과
charged NULL을 보존한다. 모델 응답은 합성 transport이며 실제 provider 성공이 아니다.

추가로 재현·수정한 경로는 다음과 같다.

- 포인터를 누르는 동안 focus 계정 확인이 시작되면 조건부 workspace 렌더링이
  재시도 버튼을 제거해 click이 전달되지 않았다. 비공개 내용은 숨기고 inert로
  유지하며 일반 재시도 버튼은 고정된 DOM 위치에 둔다. 최신 계정·동의를 확인한
  뒤에만 요청한다. 다른 계정·동의 필요·세션 조회 실패에서는 요청하지 않는다.
- 재시도503 안내가 이후 focus 조회 성공으로 지워졌다. 실패한 mutation의 안내는
  다음 명시적 시도까지 보존한다. 성공한 조회를 재시도 성공으로 표시하지 않는다.
- [Cloudflare AI binding 구현](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts)의
  기본 InferenceUpstreamError에는 HTTP status가 없다. 기존 `error.status` 검사로는
  실제 응답 상태가 사라진다. 지원되는 `returnRawResponse`로 요청별 Response를
  받아 status와 허용된 분류만 전달한다. 공유 binding의 lastRequest 값이나 메시지의
  내부 숫자 코드를 HTTP 상태로 추정하지 않는다. body는 상한을 두고 메모리에서만
  읽으며 원문·사건·SQL·토큰을 로그에 남기지 않는다. 기존 개별 예약·최대3회 제한과
  미확정 과금 보존을 유지한다. 알려진 D1 depth/compound SELECT/function 한도도
  database_limit로 분류한다.

회귀: `tests/browser/workspace.e2e.ts`, `tests/ai-runtime-workerd.test.ts`,
`tests/llm-gateway-transport.test.ts`, `tests/llm-gateway-attempts.test.ts`,
`tests/dependency-diagnostics.test.ts`. 포인터 재현은 수정 전 실패·수정 후 통과했다.
실제 Safari의 과거 이벤트 순서는 확정되지 않았다. 원래 provider 로그의
`unknown/httpStatus:null`에서 유실된 HTTP 상태를 소급 복원하거나, 스키마 결함이
그 실제 호출의 원인이었다고 단정하지 않는다. 같은 배포 SHA에서 제한된 실제
재시도·조회와 비용 대조는 #64/#57/#71의 외부 인수로 계속 추적한다.

## 확인된 실패 조건

### 0. 질문 생성 실패 후 재시도의 D1 SQL 표현식 깊이 초과

사용자가 본 `다음 내용을 준비하지 못했어요` 화면은 저장된 질문 생성 job의 실패 상태다.
이 상태의 재시도는 `POST /api/v2/cases/:id/workspace-jobs/:jobId/retry`를 호출한다.
[workspace API](../../src/server/api/v2/workspaces.ts)는 분류되지 않은 DB 예외를
`503 DEPENDENCY_UNAVAILABLE`로 변환하므로 화면에 표시되는 코드만으로 실제 의존성을
구별할 수 없었다.

공동 조사에서 [jobs repository](../../src/server/db/v2-jobs.ts)의 `retry`가 사용한
복합 SQL을 **native workerd D1 + 인증된 Hono 요청**으로 실행하여 같은 503을 재현했다.
실제 실패 원인은 `Expression tree is too large (maximum depth 100)`이었다. 비용·자금
predicate를 correlated job `EXISTS` 안에 중첩한 조합이 workerd D1의 표현식 깊이 제한을
넘었고, 같은 재시도는 Bun SQLite 기반 테스트에서 통과했다.

수정은 독립적인 비용·자금 predicate를 job `EXISTS` 바깥의 형제 `AND`로
옮긴다. 비용 검증 조건과 bind 값, 원자적 transaction을 유지하면서 SQL 중첩을 줄인다.
수정 후 native 회귀에서 질문 생성 실패→HTTP 재시도 202→job 완료를 확인했다.
[회귀 테스트 소스](../../tests/ai-runtime-workerd.test.ts)는 실제 D1 구현을 사용하고,
모델 및 원격 Workflow transport는 합성 대역을 사용한다. 이는 실제 provider·원격 preview
성공 증거가 아니며 수정 candidate의 전체 검사·배포 결과는 별도로 확인해야 한다.

파일 재시도도 [동일 `jobs.retry` 호출](../../src/server/modules/file-processing/retry.ts)을
사용한다. 별도의 `retryAsset`은 비용 predicate가 이미 외부 `WHERE`에 있어 같은 중첩
형태는 아니지만, 이번 native 테스트가 모든 미디어 경로의 SQL 제한을 검증한 것은 아니다.

당시 완료 조건은 native D1 재시도 회귀를 AI 변경 검사에 포함하고, 수정한 동일 candidate가
preview에 배포됐는지 검증하는 것이었다. 기존 실패 job을 지우거나
실패 증거를 성공으로 바꾸지 않는다. 이후 승인된 금액 차단 해제는 이 SQL 결함의 과거
수정 결과와 구분하며, 금액 predicate를 되살리는 근거로 이 감사 기록을 사용하지 않는다.

### 0.1. 작업 잠금의 시작·만료 시각 경합

[workspace 실행](../../src/server/modules/workspace/execution.ts)은 잠금 획득과 갱신에서
시작 시각과 만료 시각 계산용 clock을 따로 읽었다. 두 호출 사이에 1ms가 지나면 잠금 길이가
300001ms가 되어 repository의 최대 300000ms 검증에 거부된다. 이 경우 획득은 `stopped`,
갱신은 `MODEL_UNAVAILABLE`로 끝날 수 있다.

각 잠금 작업에서 한 번 읽은 시각을 시작과 만료 계산에 함께 사용하도록 수정했다.
[실행 회귀](../../tests/ai-runtime-execution.test.ts)는 clock을 읽을 때마다 1ms 증가시켜
수정 전 실패를 결정적으로 재현하고, 수정 후 획득과 갱신을 모두 통과함을 확인한다.
시간 허용 범위를 넓히거나 테스트를 재시도하여 실패를 감추지 않는다.

### 1. 기존 사건 분석 Workflow의 비용 ledger 누락

관련 소스:

- [AnalysisWorkflow](../../src/workflows/analysis.ts)의 `run`은 `createLlmGateway(this.env)`를 호출한다.
- [모델 gateway](../../src/server/modules/llm-gateway/service.ts)의 `call`은 `APP_ENV`가 `preview` 또는 `production`이고 `attemptLedger`가 없으면 `MODEL_UNAVAILABLE`을 던진다.
- [기존 분석 실행](../../src/server/modules/case-structure/execution.ts)은 이 gateway로 `minimize`부터 모델 단계를 실행한다.

영향은 `POST /api/cases`, `POST /api/cases/:caseId/answers`,
`POST /api/cases/:caseId/retry`가 시작하거나 재개하는 기존 분석이다. HTTP admission이
성공할 수 있어도 후속 Workflow의 첫 모델 호출은 이 조합에서 실패한다. 기존 사건 읽기·
삭제가 같은 이유로 실패한다고 판단하지 않는다.

완료 조건은 기존 분석의 실제 operation/attempt를 비용 ledger 및 invocation ID에 연결하고,
preview 환경값을 사용하는 전체 admission→Workflow→결과 저장 검사를 통과하는 것이다.
환경값을 제거하거나 ledger 요구를 끄는 수정은 완료 조건이 아니다. 기존 데이터와 읽기·
삭제 계약을 보존해야 한다.

### 2. 원본 파일·변호사 자산 업로드의 storage bounds 누락

관련 소스:

- [실제 API 조합](../../src/server/api/index.ts)은 파일 및 변호사 자산에 `createStorageBudgetService({ core, ownerId, environment })`를 제공한다.
- [storage 비용 서비스](../../src/server/modules/budget/storage-ledger.ts)의 `prepare`는 `options.bounds`가 없으면 즉시 `null`을 반환한다.
- [파일 서비스](../../src/server/modules/files/service.ts)의 `putPart`와 [변호사 자산 서비스](../../src/server/modules/lawyers/assets.ts)의 `upload`는 admission이 없으면 `PROCESSING_UNAVAILABLE`로 중단한다.

직접 영향 endpoint는 `PUT /api/v2/cases/:caseId/files/:fileId/parts/:partNumber`와
`PUT /api/v2/me/lawyer/assets/:assetId/content`다. DB 예산·가격·바인딩이 모두 있어도
현재 조합의 bounds 누락만으로 업로드가 차단된다. 원본 업로드 실패는 이후 파일 complete,
자동 처리, ASR·vision 실행에도 영향을 준다.

완료 조건은 실제 보존 기간·물리 용량·삭제 예비량과 요청 비용을 검증한 storage bounds를
서버에서 제공하고, 실제 조합으로 암호화 원본의 저장·재개·완료·삭제를 검사하는 것이다.
`testOnlyUnmeteredStorage`를 제품 runtime에 켜거나 임의의 가격·보존 증거를 생성해서는 안 된다.

### 3. 파일 처리 파생물의 R2 저장 bounds 누락

관련 소스:

- [FileProcessingWorkflow](../../src/workflows/file-processing.ts)은 policy 인자 없이 `createFileProcessingRuntime`을 호출한다.
- [기본 처리 bounds](../../src/server/modules/budget/processing-runtime.ts)의 `boundedProcessingResources`는 container 실행, R2 GET, 최대 30초 ASR만 제공한다. `service: "storage"`, `action: "r2_put"`은 `null`을 반환한다.
- [파일 처리 실행](../../src/server/modules/file-processing/execution.ts)은 암호화 파생물 저장 전에 위 `storage/r2_put` 비용 permit을 요구하며, permit이 없으면 `BUDGET_UNAVAILABLE`로 중단한다.

영향은 `POST /api/v2/cases/:caseId/files/:fileId/complete` 또는 `retry` 이후
FileProcessingWorkflow의 파생물 저장이다. 원본 업로드만 수정해도 전체 파일 처리가
완성되지는 않는다. 문서·이미지·음성·영상 중 해당 저장 단계를 지나는 경로가 영향을 받는다.

완료 조건은 파생물의 실제 암호화 크기, 보존·용량 예약 및 R2 쓰기 비용을 검증한 bounds를
연결하고 원본부터 파생물·coverage 저장까지 실제 runtime 조합으로 검사하는 것이다.

### 4. Vision capability와 비용 상한 연결 누락

관련 소스:

- [FileProcessingWorkflow](../../src/workflows/file-processing.ts)의 기본 policy에는 `visionCapability`가 없다.
- [미디어 gateway](../../src/server/modules/llm-gateway/transcription.ts)의 `observe`는 유효한 model·`chat_image_url`·만료 시각의 capability가 없으면 모델 호출 전에 `MODEL_UNAVAILABLE`을 던진다.
- [기본 처리 bounds](../../src/server/modules/budget/processing-runtime.ts)는 vision 작업에도 `null`을 반환한다.

영향은 파일 complete/retry 이후 이미지 관찰과 영상 frame 해석이다. capability만
제공해도 vision 비용 bounds가 없으므로 충분하지 않다. 원본/파생물 저장 실패가 먼저 발생하면
사용자가 이 실패까지 도달하지 못할 수 있다.

완료 조건은 합의한 모델·계정의 실제 이미지 입력 지원 증거와 유효기간을 확인하고,
해당 이미지 wire에 대한 검증된 입력·출력 비용 상한을 연결하는 것이다. 이후 합성 이미지와
영상 frame으로 모델 schema 및 coverage 저장을 검증한다. 모델 이름이나 파일 byte 수만으로
vision 지원·token 상한을 추정하여 통과시키지 않는다.

### 5. 미디어·저장 비용의 정산 연결과 가격 범위 부족

관련 소스:

- [처리 비용 서비스](../../src/server/modules/budget/processing-ledger.ts)의 `after`는 `metering`이 없거나 검증된 receipt를 얻지 못하면 정산하지 않고 예약을 유지한다.
- [파일 runtime](../../src/server/modules/budget/processing-runtime.ts)과 [자산 runtime](../../src/server/modules/budget/asset-runtime.ts)의 기본 조합에는 metering이 없다. 이번 소스 감사에서 제품 호출 지점의 metering 제공을 확인하지 못했다.
- [현재 AI 예산 provisioning](../../scripts/provision-ai-budget.ts)의 `pricing`은 `model_input_tokens`, `model_output_tokens` 두 SKU만 생성한다.
- [처리 proof 선택](../../src/server/runtime/processing-proofs.ts)은 기본적으로 `container_cpu_seconds`를 포함한 pricing을 요구한다. [paid runtime](../../src/server/db/v2-paid-runtime.ts)은 계획의 모든 SKU에 해당하는 metered 가격을 요구한다.

텍스트 전용 pricing만 설치된 환경은 container CPU·memory·disk, R2 요청, ASR 가격을
충족하지 못한다. 파일 complete/retry, 변호사 자산 처리 등이 영향을 받으며, storage 경로는
별도 보존 가격·용량 증거도 필요하다. 현재 원격 DB에 별도의 미디어 pricing이 설치됐는지는
이번 감사에서 확인하지 않았다.

metering 부재는 항상 첫 호출을 막는 조건은 아니지만, 성공한 외부 처리 후에도 비용 예약을
미정산으로 남긴다. 당시에는 누적 노출의 자금 한도와 proof 교체 전 drain이 다음 작업을
막을 수 있었다. 2026-10-14 이후에는 월 예산·누적 재원·요청 금액을 차단 조건으로 사용하지
않으며, 미정산 기록과 정확한 실제 정산을 연결할 의무는 그대로 남는다.

완료 조건은 실제 사용하는 전체 SKU의 공식 가격·과금 quantum·지역·FX·유효기간과
자금 증거를 확인하고, 검증 가능한 실제 사용량 receipt를 동일 attempt에 정산하도록
연결하는 것이다. 성공, timeout, 늦은 응답, 삭제 후 receipt까지 확인하며 로컬 완료나
추정 실행 시간을 실제 청구 증거로 바꾸지 않는다.

## 기존 검사가 놓치는 범위

[health API](../../src/server/api/health.ts)의 `/api/health/ready`는 D1 schema metadata를
읽는다. 모델 ledger, storage bounds, vision capability 또는 provider 성공을 검사하지 않는다.

[환경 readiness](../../scripts/environment-readiness.ts)는 설정·바인딩 존재를 관찰한다.
함수로 주입되는 bounds·metering·capability의 실제 조합을 검증하는 검사와 구분해야 한다.

[격리 AI readiness Worker](../../scripts/ai-readiness-worker.ts)는 별도 Worker에서 합성
`screening`을 호출한다. 제품 DB·OAuth·workspace admission을 사용하지 않으므로 이 결과를
전체 API 성공으로 승격할 수 없다.

파일 처리 fixture는 [명시적 unmetered storage 대역](../../tests/helpers/file-processing-fixture.ts)을
사용하고, [미디어 gateway 테스트](../../tests/media-gateway.test.ts)는 vision capability를
주입한다. 이 검사는 해당 부품의 동작을 검증하지만 제품 기본 조합의 누락까지 검출하지 않는다.

## 실행한 offline 검증

```bash
bun test tests/llm-gateway-attempts.test.ts tests/media-gateway.test.ts tests/storage-budget-service.test.ts
```

2026-10-07 KST 로컬 실행 결과: **46 passed, 0 failed, 492 assertions**.
Bun 1.3.14를 사용했다. 특히 preview/production ledger 누락, vision capability 누락,
storage bounds 누락을 거부하는 테스트가 통과했다. 이는 위 제품 조합에서 실패하는 이유를
뒷받침하며 live 성공 증거가 아니다.

## 2026-10-15 사전검사 범위 재대조

현재 고객 자료 factory는 `costs`, 기술 bounds, `configuredMediaPolicy`의 vision capability를
연결한다. 따라서 과거 `media_storage_vision_metering_wired=false` 고정 진단은 현재 구현의
검사 결과가 아니다. 사전검사는 이 항목을 `not_inspected`로 기록하고
`media_runtime_requires_separate_acceptance` 경고와 media/provider 미검증 항목을 남긴다.
필수 R2/Container/Workflow binding의 누락은 여전히 실제 설정 blocker다.

기존 `AnalysisWorkflow`는 여전히 `createLlmGateway(this.env)`에 attempt ledger를 전달하지
않고 gateway는 preview/production에서 이를 거부한다. 이는 비용 관측 누락이 아닌 현재
기술 조합 누락이므로 `legacy_analysis_attempt_ledger_wired` blocker를 유지한다.
이 항목을 제거하거나 legacy 재분석을 성공으로 표시하지 않는다.

2026-10-25 #506 후속 구현에서는 실제 Workflow가 전용 legacy 실행 원장과 invocation ID를
연결하고, 기존 AI200 counter를 공유하도록 수정했다. 실제 조립·replay·권한/source·
timeout/late·삭제·관측 IO 실패의 오프라인 회귀를 수행한다. `all` 검사는 새0017의 필수
원장3개 테이블을 SELECT로 확인하며, 이전 상수 false 진단을 그대로 현재 결과로 사용하지
않는다. `legacy-analysis-runtime`은 여전히 unverified이고 별도 실제 인수가 필요하다.
이 로컬 구현 설명은 과거 실패나 배포된3b005f3의 미연결 상태를 성공으로 바꾸지 않는다.

`all`은 전체 실제 인수 검사가 아니다. metadata와 D1 SELECT만으로 원격 파일 처리·media
capability·실제 사용량/정산·provider 성공을 확인할 수 없다. 별도 동일 SHA의 실제 자료·
산출물·다운로드와 원장 관측 receipt가 필요하다. `text` 배포 smoke의 기존 binding·키·
schema·모델 context/output·정확한 SHA/환경 attestation 검사는 그대로 유지한다.
false 모드에서는 모든 scope의 비용 누락·만료·SKU·월별 할당은 경고이며 기술 오류와 구분한다.
아래 10월7일 기록은 당시 상태로 보존하며 현재 판정에는 이 후속 범위를 적용한다.

## 2026-10-07 사전검사 완료 판정 기록

`bun scripts/ai-preflight.ts preview <40자리 배포 SHA> all`은 전체 검사이며 `text`는
v2 질문·요약·채팅 설정 검사다. production은 첫 인자를 `production`으로 바꾼다.
Cloudflare Environment의 `CLOUDFLARE_API_TOKEN`을 사용하며 결과는
`.wrangler/readiness/ai-preview.json` 또는 `ai-production.json`에 저장한다.
모델 호출·예산 갱신·고객 데이터 수정 없이 설정 GET과 D1 SELECT만 실행한다.

배포 smoke는 `text` 결과가 차단되면 실패한다. 별도 `AI runtime preflight` workflow는
preview 배포 후 `all` 검사를 실행하고 수동 실행도 지원한다. 현재 확인된 legacy/media의
실제 연결 누락은 `all`의 명시적 blocker다. 가격 row나 binding만 채워서 이 상태를
해결된 것으로 표시하지 않는다. `configuration_ready`는 외부 provider 성공을 뜻하지 않는다.

`/api/health/ai-configuration`은 해당 Worker 내부의 숨겨진 모델 설정을 검증한다.
응답에는 SHA·환경·준비 상태·공개 모델 용량에서 유도한 단계별 토큰 예약량만 포함한다.
비밀키·설정 원문·evidence hash·자금 정보·고객 데이터는 반환하지 않으며 DB나 모델을
호출하지 않는다. 사전검사는 이 응답의 SHA/환경을 대조하고 D1 가격으로 실제 필요한
각 단계 중 가장 큰 단일 호출 예약금을 계산한다. 단순히 남은 자금이 0보다 큰지만으로 통과하지 않는다.

CI는 dependency/lockfile/Workers 설정 및 AI 경로 변경에서도 실제 product admission,
실행·정산, native workerd 재시도 회귀를 반드시 실행한다. Miniflare는 기존 Wrangler가
사용하는 동일 버전을 직접 개발 의존성으로 고정했다. 실제 provider 대신 합성 transport를
쓰지만 SQL·암호화·budget·상태 전이는 제품 코드를 실행한다.

| 경로 | 배포 전 확인 | 실제 성공 증거 |
| --- | --- | --- |
| v2 질문·요약·채팅 | 환경값·키·바인딩, D1 active control/가격/재원 관측·유효기간, 금액 차단 해제와 실제 API/Workflow 의존성 조합 | 같은 candidate의 합성 입력으로 admission→모델→audit→암호화 저장→조회 |
| 기존 사건 분석 | ledger와 invocation ID 제공, 단계별 비용 기록·금액 차단 해제 | 기존 API→AnalysisWorkflow→암호화 결과·조회 |
| 원본 파일·자산 | private R2, storage bounds, 가격·보존·물리 용량 증거 | 원본 저장→재개·완료→삭제 |
| Container·파생물 | processor·Workflow 바인딩, 전체 SKU, 파생물 R2 bounds | 합성 파일 추출→파생물 저장→coverage 공개 |
| ASR | 승인된 Whisper ID, 실제 WAV 길이 bound, ASR 가격·정산 | 합성 음성→transcript·timestamp·coverage 저장 |
| Vision | 모델 이미지 capability와 wire, token bounds, 가격·정산 | 합성 이미지·frame→schema·coverage 저장 |

사전검사는 실패한 의존성 이름과 원인을 구분해야 한다. 설정 누락·proof 만료·SKU 누락·
runtime 조합 누락을 하나의 성공 상태로 덮지 않는다. offline 통과, 설정 관찰, 실제 provider
호출 성공을 각각 기록하고 candidate SHA와 검사 시각을 연결한다. 외부 증거가 없는 항목은
미검증 또는 차단으로 남긴다. 단, 비용 금액만으로 차단하지 않는다. 이 문서의 완료 조건은
새 공급자·외부 결제/자동충전 변경·공개 승인이나 production 배포 승인을 만들어내지 않는다.
