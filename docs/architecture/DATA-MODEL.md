# 데이터 모델

아래 기존 테이블·값은 v1의 구현/운영 계약이다. v2는 마지막 확장 표와
[v2 실행 계약](./V2-CONTRACTS.md), `src/server/db/v2-schema.ts`의 additive 계약을 따른다.
`0006_v2_domain_foundation`의 코드·로컬 검증과 실제 환경 적용·기능 시연은 별도 증거다.

- Database: Cloudflare D1 (SQLite)
- ORM/migrations: Drizzle
- Identifiers: `crypto.randomUUID()` UUIDv4 strings; 목록 순서는 시각+ID로 결정
- Time: 앱은 UTC ISO-8601 text; Better Auth date는 timestamp_ms integer; 일일 경계 `Asia/Seoul`
- 상태·원자성·삭제의 상세 계약: [DOMAIN-LIFECYCLE](./DOMAIN-LIFECYCLE.md)

## 인증 테이블

Better Auth의 현재 Drizzle adapter가 생성하는 `user`, `session`, `account`,
`verification` 테이블을 그대로 사용한다. 애플리케이션 코드는 이 테이블을 직접
변형하지 않고 인증 adapter를 거친다. provider access/refresh/ID token과 expiry는 계정
create/update hook에서 null로 제거한다. 필요한 최소 profile/email scope만 요청한다.
Auth 기본 스키마의 IP/User Agent는 session create/update hook에서 null로 제거한다.
session의 `oauth_authenticated_at` nullable timestamp_ms는 성공한 OAuth callback만 기록하며
sliding update나 클라이언트 입력으로 변경하지 않는다. 기존 세션에는 최근 인증을 소급하지 않는다.
7일 만료/1일 갱신, 10분 최근 OAuth gate 및 보안 데이터 정리는
[인증 수명과 offline 검증](../security/AUTH-LIFECYCLE.md)을 따른다. 사건 envelope 대상과 혼동하지 않는다.

## 애플리케이션 테이블

### `user_consents`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `user_id` | text PK/FK | `user.id`, cascade delete |
| `terms_version` | text | 동의한 약관 버전 |
| `privacy_version` | text | 동의한 개인정보 처리방침 버전 |
| `ai_notice_version` | text | 동의한 AI 고지 버전 |
| `over_14_confirmed` | integer boolean | 반드시 true |
| `consented_at` | text | UTC |

### `cases`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `id` | text PK | UUIDv4 |
| `user_id` | text FK | owner, cascade delete |
| `category` | text | `personal_loan`만 허용 |
| `jurisdiction` | text | `KR`만 허용 |
| `title` | text | 민감정보를 포함하지 않는 서버 생성 제목, 최대 80자 |
| `status` | text | 아래 상태 enum |
| `encrypted_input` | text | 암호화 envelope |
| `input_revision` | integer | 1부터 증가 |
| `current_analysis_id` | text nullable | 현재 revision의 정본 분석 ID, guarded repository로 검증 |
| `questions_asked` | integer | 누적 0~5, MVP 질문 묶음 1회 |
| `created_at`, `updated_at` | text | UTC |

### `analyses`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `id` | text PK | UUIDv4 |
| `case_id` | text FK | cascade delete |
| `workflow_instance_id` | text UNIQUE | Workflow 멱등성 ID |
| `input_revision` | integer | 분석한 사건 revision |
| `attempt` | integer | 1부터, 명시적 retry로 최대3 |
| `encrypted_context` | text nullable | 구조화·질문·phase checkpoint envelope |
| `clarification_expires_at` | text nullable | 질문 생성 후24시간 |
| `status` | text | 아래 분석 enum |
| `encrypted_answers` | text nullable | 추가 답변 envelope |
| `encrypted_result` | text nullable | 최종 결과 envelope |
| `model_id` | text nullable | 예: `openai/gpt-6-sol` |
| `prompt_version`, `schema_version`, `policy_version` | text nullable | 재현 메타데이터 |
| `failure_code` | text nullable | 허용 목록의 비민감 코드 |
| `started_at`, `completed_at` | text nullable | UTC |
| `created_at`, `updated_at` | text | UTC |

### `citations`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `id` | text PK | UUIDv4 |
| `analysis_id` | text FK | cascade delete |
| `source_type` | text | `statute` |
| `source_id` | text | 공식 API의 안정 식별자 |
| `law_name` | text | 공식 명칭 |
| `article` | text | 조·항·호 범위 |
| `effective_date` | text | 해당 텍스트 시행일 |
| `verified_at` | text | UTC |
| `source_url` | text | `law.go.kr`/`open.law.go.kr` HTTPS URL |
| `content_hash` | text | 검증 본문 SHA-256 |

### `daily_usage`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `user_id` | text FK | cascade delete |
| `usage_date_kst` | text | `YYYY-MM-DD` |
| `analysis_count` | integer | 0~10 |
| `updated_at` | text | UTC |

복합 PK는 `(user_id, usage_date_kst)`다. 사건 생성 D1 batch 안에서 조건부 UPSERT로
증가시키며 모든 종속 쓰기도 동일 admission 조건을 따른다. 조건부 UPDATE 0행은 자동
rollback이 아니므로 부분 사건 생성이 없음을 동시 10/11번째 요청으로 검증한다.

### `idempotency_records`, `dispatch_outbox`, `deletion_jobs`

- idempotency: 복합 unique `(user_id, method, route, key)`, canonical body hash,
  response_status와 비민감 response_json, created/expires_at(24시간). user FK cascade.
- outbox: UUID PK, analysis FK cascade, unique `(analysis_id, attempt)`, instance_id,
  revision, state pending/dispatched/failed, attempts, next_attempt_at, created_at. 원문 payload 없음.
- deletion job: UUID PK, target_type case/account, opaque target_id, 삭제 시각,
  workflow ID 목록, primary/cleanup state, attempts, expires_at. cascade FK를 두지 않아
  primary 삭제 후 정리 기록이 남는다. 원문·이메일·토큰·계정 프로필은 저장하지 않는다.

outbox reconciliation은 #11, 삭제/backup journal은 #17이 소유한다. pending 작업의
재전달은 비민감 scheduler로 실행하며 schema·GC·복구 검증은 #8/#17 계약을 따른다.

### `legal_source_cache`

공개 법령 원문의 일시적 캐시다. `source_id + effective_date + article + content_hash`를 복합 unique로
두고 공식 메타데이터, 본문, `content_hash`, `fetched_at`, `expires_at`을 저장한다. 사건
원문과 연결하지 않으며 삭제 대상 개인정보가 아니다.

## 상태 값

- Case (persisted): `screening`, `needs_clarification`, `queued`, `analyzing`, `completed`,
  `failed`, `out_of_scope`, `urgent_redirect`
- Analysis: `queued`, `screening`, `waiting_for_answers`, `retrieving`, `generating`,
  `validating`, `completed`, `failed`, `superseded`

DB check constraint와 애플리케이션 상태 전이 테스트를 함께 둔다.

## 인덱스와 제약

- `cases(user_id, created_at DESC)`
- `analyses(case_id, created_at DESC)`
- `analyses(workflow_instance_id)` unique
- active analysis의 `case_id` partial unique (queued/screening/waiting/retrieving/generating/validating)
- `citations(analysis_id)`
- 모든 FK는 활성화하고 소유 데이터는 cascade delete한다.
- 완료 분석은 `encrypted_result`, 실패 분석은 `failure_code`를 요구하는 논리 제약을
  DB CHECK와 repository에서 검증한다.

## 암호화 envelope

형식은 `v1.<key-id>.<base64url-iv>.<base64url-ciphertext-and-tag>`다. AES-256-GCM에
96-bit 무작위 IV를 사용하며 AAD는 `<table>:<row-id>:<column>:<user-id>`다. 같은 값을
다시 저장해도 IV를 재사용하지 않는다. 복호화는 키 버전 allowlist를 거치며 실패는
원문을 로그에 남기지 않고 `CRYPTO_DECRYPT_FAILED`로 처리한다.

키 회전은 새 쓰기를 새 버전으로 전환한 뒤, 인증된 백그라운드 작업으로 읽기-복호화-
재암호화한다. 이전 키는 모든 행의 이동과 복구 검증이 끝나기 전 삭제하지 않는다.

키 형식·허용 필드·크기 상한과 환경별 생성/등록/회전/복구 절차는
[사건 데이터 키 운영](../operations/CASE-DATA-KEYS.md)을 따른다. 실제 환경 등록·복구 증거는 #27에서 확인한다.

## 마이그레이션 규칙

- 모든 schema 변경은 Drizzle SQL, 역호환 배포 순서, 데이터 검증 쿼리를 포함한다.
- 먼저 nullable/additive 변경을 배포하고 backfill 후 제약을 강화한다.
- production migration 전 D1 backup/bookmark를 기록하고 preview에서 동일 migration을
  검증한다.
- 정책과 다른 보존용 shadow table을 만들지 않는다.
- Drizzle의 `drizzle/meta/*_snapshot.json`과 `_journal.json`도 함께 커밋한다.
  `bun run db:generate` 뒤 diff가 없어야 schema와 baseline이 일치한다.

#8의 additive migration과 저장 primitive 사용 경계는 [도메인 DB 운영](../operations/DOMAIN-DATABASE.md)을 따른다.

## v2 additive 계약과 구현

schema 소유 이슈 [#55](https://github.com/creno-va/baro/issues/55)는 strict 계약 [#54](https://github.com/creno-va/baro/issues/54)를
통합한 `0006_v2_domain_foundation` SQL·snapshot·journal을 소유한다. fresh 적용 시 기존15개에
`v2_` 접두사의67개 테이블이 추가되어 총82개가 된다. 아래 표는 개념별 그룹이며 실제 이름·
CHECK·FK·인덱스는 `src/server/db/v2-schema.ts`와 migration이 정본이다. 다른 이슈가 migration을
병렬 생성하지 않는다. 기존 case/analysis/result와 `schemaVersion:"1"`은 보존하고 읽기/삭제
회귀를 검사한다. 새 workspace는 v1 case의 명시적 전환 reference 또는 신규 v2 사건에 연결한다.

| 목표 테이블 그룹 | 정본 metadata | 암호화 대상·핵심 제약 |
| --- | --- | --- |
| `case_workspaces` | case/owner FK, contractVersion, state, revision, intakeRevision, confirmedSummaryRevision | company/individual context와 서술은 encrypted; owner+CAS, company 공동 소유 없음 |
| `intake_batches`, `intake_answers`, `case_summaries` | workspace/revision/batch index/question IDs/confirmedAt | 질문·답변·요약 encrypted, unknown/skipped에는 value 없음, 최신 summary만 확인 |
| `case_messages`, `case_actions`, `case_timeline` | owner/workspace FK, ordinal, revision, operation ID, status | text/확인 이유/날짜·인물·source 위치 encrypted, 입력 사실과 AI 추정 구분 |
| `case_files`, `file_parts`, `file_derivatives` | opaque file/blob key, owner/workspace FK, byte counts, format/status/revision | filename·내용·coverage/source positions encrypted, 부분 순서/총byte/hash manifest 검증 |
| `processing_jobs`, `job_outbox` | target ID, revision, kind, lease, attempt, failure enum | 평문 payload 금지, tombstone 검사, bounded retry·CAS, 늦은 결과 거부 |
| `case_reports`, `report_file_links` | report version, workspace snapshot, selected file/revision, ready status | edited/masked contents·PDF/ZIP encrypted, 고정 snapshot, 소유 file만 참조 |
| `lawyer_applications`, `verification_assets` | applicant FK, review revision/state, reviewer ID/time | 본인·자격·사무실 확인 서류 private/encrypted, 심사 권한과 사건 소유권 분리 |
| `lawyer_profiles`, `profile_revisions`, `portfolio_assets` | owner FK, approved revision pointer, state, approvedAt | draft/심사 reasons private, submitted 불변, approved content만 공개 projection |
| `moderation_decisions`, `public_reports` | target type/revision, decision enum, actor/time | 심사 기록/신고 내용 제한, 자기 승인 금지, public pointer와 승인 outbox 원자적 변경 |
| `usage_reservations`, `daily_usage_v2`, `storage_usage` | operation/user/KST day, caseCount/responseCount/mediaSeconds/reservedBytes | logical operation unique, pending upload 포함, quota 종속 쓰기 동일 predicate |
| `cost_attempts`, `monthly_budget` | opaque operation/attempt, cost category, quoteVersion, reserved/actual/ambiguous KRW | 모델·ASR·compute·storage 모두 포함, 사용자 내용·원본 URL 없음, 월 global reservation |
| extended `deletion_jobs` | opaque target/blob/job references, revocation state, cleanup progress/attempt | 삭제 후 FK cascade와 분리, 개인정보 shadow copy 없음, backup+R2 restore 재삭제 |

role binding은 검증된 account에만 부여하고 client role 값을 쓰지 않는다. role 철회·변호사
public pointer·공개 asset purge와 신고 처리는 감사 가능한 비민감 기록으로 남긴다. 공개
projection은 사건/인증자료 FK와 조회 join을 포함하지 않는다. moderated draft와 승인본을
같은 row의 덮어쓰기 값으로 표현하지 않는다.

v2 계정 storage 합계는 원본·파생물·report·ZIP·portfolio staging/공개본·진행 중 reservation을
반영한다. 실제 object 삭제 전 사용량을 반환하지 않으며 double cleanup·실패·orphan reconciliation을
검사한다. 사건 원본 개수 100과 원본 byte 합계 5GB는 별도 counter이며 pending 원본 예약을
포함한다. 파생물·report·ZIP은 계정 전체10GB와 처리 상한에 포함하고 사건 원본5GB에서는
제외한다. 가격·환율 quote와 user quota는 별도
ledger이며 provider crash ambiguity를 비용0으로 처리하지 않는다.

대형 blob의 key format/AEAD는 v1 text envelope를 변경하지 않는 별도 version으로 추가한다.
file DEK wrap, part IV/AAD, ordered manifest와 hash는 blob revision에 묶으며 원본 hash·filename을
로그/public metadata로 노출하지 않는다. DB backup 단독 복구가 R2 원본·public CDN·삭제 정리
완료를 증명하지 않는다. 삭제 journal 적용 후 전체 object/reference 대조와 회전키 복호화
검증을 수행한다. detail은 [v2 실행 계약](./V2-CONTRACTS.md)을 따른다.

### 저장·조회와 대용량 실행 경계

`src/server/db/v2.ts`의 `createV2Repository`는 환경별 preview/production 예산 allocation을
명시적으로 받아 typed repository를 연결한다. schema 적용이나 외부 호출은 수행하지 않는다.
HTTP/Workflow는 세션·동의·abuse gate를 적용한 뒤 이 저장 primitive를 사용한다.

- 모든 새 v2 INTEGER metadata는 비음수·정확한 JS safe integer 범위를 INSERT/UPDATE
  trigger로 제한한다. fractional media duration과 FX 등 명시적 REAL은 별도 계약을 따른다.
- 작은 직접 snapshot 저장은96KiB까지다. 큰 JSON은64KiB 이하의 암호화 part와 ordered
  receipt/hash를 durable staging에 저장한다. D1 batch는40 statements 이하, statement별100
  parameters 이하, SQL과 bound values 합계2MiB 이하로 제한한다.
- 전체 JSON 재구성 convenience API는4MiB까지이며 초과하면 `SNAPSHOT_STREAM_REQUIRED`를
  반환한다. 큰 자료는 paged metadata·검증된 part stream과 bounded step API로 처리한다.
  Workflow adapter는 step을 여러 invocation에 나누어 호출해야 하며100MiB를 한 batch로 저장하지 않는다.
- 자료 목록의 metadata page는 최대50개와2회 SQL로 제한한다. 전체 DTO를 복호화하는
  기존 `files.list`는 최대4개다. 요약은 사실300개/관계자30개를 유지하고 사용자 편집은
  최대100개 항목을 bounded step으로 반영하며 원래 배열 순서와 이전 snapshot을 보존한다.
- 자료의 관찰10,000개·파생물20,000개도 paged metadata와 part stream으로 읽는다.
  조회·복호화·stream yield 뒤에도 현재 owner/revision/pointer/tombstone을 검사한다.
- 기존 v1 전환은 사용자 opt-in이다. 원래 서술·nested answers·질문·ciphertext를 보존하고
  자동 AI 실행이나 신규 사건 quota 차감을 하지 않는다. source sealing과 최종 publication은
  별도 원자적 단계이며 SQL 실패 시 재개 가능한 sealed checkpoint를 유지한다. 기존 사건
  삭제는 아직 공개되지 않은 sealed checkpoint도 정리한다.

위 primitive의 SQLite/AES 검증은 실제 R2·Containers·Whisper 호출, HTTP 연결이나 배포된
전체 UI 시연을 대신하지 않는다. 환경 적용과 후속 기능 증거는 [검증 기록](../development/V2-VALIDATION.md)에 남긴다.

### 후속 runtime 근거와 admission (#87)

`0007_runtime_paid_execution`은 foundation82개 테이블을 보존하고9개를 추가한다. 정본은
`v2-paid-contracts.ts`, `v2-paid-runtime.ts`, `v2-paid-statements.ts`와 동일 번호 migration이다.
새 repository 소비는 공유 PR main 통합 뒤 진행한다. 실제 외부 성공은 별도 검증한다.

| 저장소 | 보존할 계약 |
| --- | --- |
| `v2_runtime_proofs` | immutable versioned pricing/funding/allocation/drain, 공식 reference·canonical UTC·trusted verification digest/evidence |
| `v2_runtime_plans`, `v2_paid_holds` | operation/invocation/attempt·target/revision·최대 SKU quantity와 가격/FX/수수료 상한, current lease/fence/dispatch token |
| `v2_runtime_usage` | allowlisted usage와 provider correlation, 원래 proof 기반 정산·불완전 late evidence, 무과금 추정 금지 |
| `v2_runtime_controls`, `v2_runtime_drains` | 환경 freeze/drain/version CAS·합계 한도·신뢰 가능한 전환 acknowledgement |
| `v2_maintenance_exposure`, `v2_maintenance_evidence`, `v2_runtime_claims` | 필수 유지·이전 월 미확정 의무, immutable 근거와 원자적 financial claim |

돈은 decimal string과 BigInt 유리수로 계산하고 KRW는 보수적으로 올림한다. pinned 모델은 입력
short/long 각각 ordinary/cache-read/cache-write6개와 출력2개의 단가를 저장한다. 예약 단가는
허용한 전체 matrix와 지역 배수의 최대값 이상이어야 한다. 전체 입력272,000tokens 초과 시 long,
실제 일반 입력은 전체에서 cache-read/write를 뺀 값이다. 요청의 default tier와 실제 응답 등급을
대조하며 누락·모순·미지원 등급은 ambiguous로 남긴다. 인증된 실제 청구 근거는 별도로 검증한다.

paid admission은 비용 준비를 독립 INSERT한 뒤 quota/job을 쓰는 방식이 아니라 동일 claim/batch다.
이미 dispatched인 시도의 not_sent 재생은 prepared/tokenless CAS로 거부한다. 삭제·lease 만료 뒤
late receipt도 원래 attempt에 기록하며 case 원문은 비용 저장소에 포함하지 않는다. runtime control
초기화 뒤 hold를 생략한 v2 admission/acquire도 차단한다. 실제 서비스의 price/funding/FX verifier가
없으면 실행을 허용하지 않는다. 합성 테스트 verifier를 production 근거로 사용하지 않는다.

공식 source discovery는 content hash를 아직 모르는 단계에서 공개 identity/version/section/
extractor로 최신 유효 cache를 조회한다. private query를 저장하지 않으며 최대2회 indexed query,
1MiB body hash·allowlist와 최종 최신 pointer 검증을 수행한다. 정확한 immutable source tuple 및
citation의 시각 비교는 canonical UTC로 보존한다. 상세 적용·복구 경계는 [DB 운영](../operations/DOMAIN-DATABASE.md)을 따른다.

### 작업 없는 저장 비용 실행 (#93)

`0008_storage_paid_execution`은 기존 0000~0007을 보존하고 `v2_storage_paid_executions`를
추가한다. 원본 chunk, 변호사 원본, 승인된 공개 copy의 실제 operation/revision·reservation/blob·
physical tuple·가격/funding/plan을 연결한다. AI job이나 lease를 대신 만들어 사용하지 않는다.
승인 공개 copy는 자료 정제 operation과 별개인 프로필 revision operation에 연결한다.

서버의 frozen `PreparedStoragePaidHold.actor`와 predicate/statements를 실제 pending intent와
같은 claim/batch에 조합한다. 정확한 pending envelope와 source가 없으면 claim의 verified CHECK가
저장량·비용·intent 전체를 rollback한다. 비용 anchor에는 원본/프로필 ciphertext를 복제하지 않고
opaque ID/revision/physical metadata와 SHA만 남긴다. 소비자는 이 공유 구현의 main 병합 뒤 연결한다.

dispatch는 현재 정책·file 자동 처리 동의·소유권·revision·만료·삭제·공개 자격/수동 승인과 funding을
재확인하는 일회 CAS다. 미확정 비용을 유지하고 실제 검증된 usage만 기존 정산 계약으로 반영한다.
계정 삭제·월 전환 뒤 receipt도 원래 attempt/month에 정산한다. 합성 SQL/AES 검증은 실제 R2 청구,
보관 비용 조달, 공개 UI·운영 검증의 완료 증거가 아니다.
