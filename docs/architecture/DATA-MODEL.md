# 데이터 모델

아래 기존 테이블·값은 v1의 구현/운영 계약이다. v2 목표는 마지막 확장 표와
[v2 실행 계약](./V2-CONTRACTS.md)에 정의하며 migration이 이미 존재한다고 해석하지 않는다.

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

## v2 additive 정본 목표

schema 소유 이슈 [#55](https://github.com/creno-va/baro/issues/55)가 strict 계약 [#54](https://github.com/creno-va/baro/issues/54)를
통합한 뒤 migration 번호·CHECK·FK·인덱스를 하나의 PR로 확정한다. 다른 이슈가 migration을
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

v2 storage 합계는 원본·파생물·report·ZIP·portfolio staging/공개본·진행 중 reservation을
반영한다. 실제 object 삭제 전 사용량을 반환하지 않으며 double cleanup·실패·orphan reconciliation을
검사한다. 원본 개수 100과 저장 byte 합계를 구분한다. 가격·환율 quote와 user quota는 별도
ledger이며 provider crash ambiguity를 비용0으로 처리하지 않는다.

대형 blob의 key format/AEAD는 v1 text envelope를 변경하지 않는 별도 version으로 추가한다.
file DEK wrap, part IV/AAD, ordered manifest와 hash는 blob revision에 묶으며 원본 hash·filename을
로그/public metadata로 노출하지 않는다. DB backup 단독 복구가 R2 원본·public CDN·삭제 정리
완료를 증명하지 않는다. 삭제 journal 적용 후 전체 object/reference 대조와 회전키 복호화
검증을 수행한다. detail은 [v2 실행 계약](./V2-CONTRACTS.md)을 따른다.
