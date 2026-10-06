# Preview AI 사전 검사 감사

- 감사일: 2026-10-07 KST
- 범위: preview AI 관련 API의 실제 서버 조합, 예산·저장·미디어 의존성, 기존 검사 범위
- 상태: 소스 감사와 아래 명시한 offline 테스트 완료. 이 문서는 preview 전체 AI 성공이나 배포 완료 증거가 아니다.

사용자는 preview에서 예산 오류 뒤 의존성 오류가 반복되는 문제에 대해 전체 사전 검사를
요청했다. 바인딩이 존재하거나 격리 모델 호출 하나가 성공하더라도 실제 API의 admission,
암호화 저장소, 비용 예약, Workflow 조합, 모델 호출, 결과 저장이 모두 작동한다는 뜻은 아니다.
이 문서는 확인된 조합 누락을 기록하며 기존 예산·인증·외부 공개 조건을 완화하지 않는다.

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

완료 조건은 native D1 재시도 회귀를 AI 변경 검사에 포함하고, 수정한 동일 candidate가
preview에 배포됐는지 검증하는 것이다. 기존 실패 job을 지우거나 예산 predicate를 제거하여
오류를 감추지 않는다.

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
미정산으로 남긴다. 누적 노출이 자금 한도에 도달하거나 proof 교체 전 drain이 필요할 때
다음 작업이 막힐 수 있다. 월 예산 cap을 끄더라도 이 정산·자금 검증 문제는 해소되지 않는다.

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

## 사전검사 완료 판정

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
최소 단일 호출 예약금을 계산한다. 단순히 남은 자금이 0보다 큰지만으로 통과하지 않는다.

CI는 dependency/lockfile/Workers 설정 및 AI 경로 변경에서도 실제 product admission,
실행·정산, native workerd 재시도 회귀를 반드시 실행한다. Miniflare는 기존 Wrangler가
사용하는 동일 버전을 직접 개발 의존성으로 고정했다. 실제 provider 대신 합성 transport를
쓰지만 SQL·암호화·budget·상태 전이는 제품 코드를 실행한다.

| 경로 | 배포 전 확인 | 실제 성공 증거 |
| --- | --- | --- |
| v2 질문·요약·채팅 | 환경값·키·바인딩, D1 active control/가격/자금/상한 유효기간, 실제 API와 Workflow 의존성 조합 | 같은 candidate의 합성 입력으로 admission→모델→audit→암호화 저장→조회 |
| 기존 사건 분석 | ledger와 invocation ID 제공, 기존 단계별 예산 계약 | 기존 API→AnalysisWorkflow→암호화 결과·조회 |
| 원본 파일·자산 | private R2, storage bounds, 가격·보존·물리 용량 증거 | 원본 저장→재개·완료→삭제 |
| Container·파생물 | processor·Workflow 바인딩, 전체 SKU, 파생물 R2 bounds | 합성 파일 추출→파생물 저장→coverage 공개 |
| ASR | 승인된 Whisper ID, 실제 WAV 길이 bound, ASR 가격·정산 | 합성 음성→transcript·timestamp·coverage 저장 |
| Vision | 모델 이미지 capability와 wire, token bounds, 가격·정산 | 합성 이미지·frame→schema·coverage 저장 |

사전검사는 실패한 의존성 이름과 원인을 구분해야 한다. 설정 누락·proof 만료·SKU 누락·
runtime 조합 누락을 하나의 성공 상태로 덮지 않는다. offline 통과, 설정 관찰, 실제 provider
호출 성공을 각각 기록하고 candidate SHA와 검사 시각을 연결한다. 외부 증거가 없는 항목은
미검증 또는 차단으로 남긴다. 이 문서의 완료 조건은 새로운 provider·예산 확대·공개 승인이나
production 배포 승인을 만들어내지 않는다.
