# 데이터 모델

- Database: Cloudflare D1 (SQLite)
- ORM/migrations: Drizzle
- Identifiers: application-generated UUIDv7 strings
- Time: UTC ISO-8601 text; 일일 사용량 경계만 `Asia/Seoul`

## 인증 테이블

Better Auth의 현재 Drizzle adapter가 생성하는 `user`, `session`, `account`,
`verification` 테이블을 그대로 사용한다. 애플리케이션 코드는 이 테이블을 직접
변형하지 않고 인증 adapter를 거친다. `account`의 provider token 저장 정책은 실제
기능에 필요한 최소 scope로 제한하고 refresh token이 필요 없으면 저장하지 않는다.

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
| `id` | text PK | UUIDv7 |
| `user_id` | text FK | owner, cascade delete |
| `category` | text | `personal_loan`만 허용 |
| `jurisdiction` | text | `KR`만 허용 |
| `title` | text | 민감정보를 포함하지 않는 서버 생성 제목, 최대 80자 |
| `status` | text | 아래 상태 enum |
| `encrypted_input` | text | 암호화 envelope |
| `input_revision` | integer | 1부터 증가 |
| `created_at`, `updated_at` | text | UTC |

### `analyses`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `id` | text PK | UUIDv7 |
| `case_id` | text FK | cascade delete |
| `workflow_instance_id` | text UNIQUE | Workflow 멱등성 ID |
| `input_revision` | integer | 분석한 사건 revision |
| `status` | text | 아래 분석 enum |
| `encrypted_answers` | text nullable | 추가 답변 envelope |
| `encrypted_result` | text nullable | 최종 결과 envelope |
| `model_id` | text nullable | 예: `gpt-6.1-sol` |
| `prompt_version`, `schema_version`, `policy_version` | text nullable | 재현 메타데이터 |
| `failure_code` | text nullable | 허용 목록의 비민감 코드 |
| `started_at`, `completed_at` | text nullable | UTC |
| `created_at`, `updated_at` | text | UTC |

### `citations`

| 열 | 형식 | 규칙 |
| --- | --- | --- |
| `id` | text PK | UUIDv7 |
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

복합 PK는 `(user_id, usage_date_kst)`다. 사건 생성 트랜잭션 안에서 UPSERT 조건
`analysis_count < 10`으로 증가시키며 시스템 재시도는 증가시키지 않는다.

### `legal_source_cache`

공개 법령 원문의 일시적 캐시다. `source_id + effective_date + article`을 복합 unique로
두고 공식 메타데이터, 본문, `content_hash`, `fetched_at`, `expires_at`을 저장한다. 사건
원문과 연결하지 않으며 삭제 대상 개인정보가 아니다.

## 상태 값

- Case: `draft`, `screening`, `needs_clarification`, `queued`, `analyzing`, `completed`,
  `failed`, `out_of_scope`, `urgent_redirect`
- Analysis: `queued`, `screening`, `waiting_for_answers`, `retrieving`, `generating`,
  `validating`, `completed`, `failed`, `superseded`

DB check constraint와 애플리케이션 상태 전이 테스트를 함께 둔다.

## 인덱스와 제약

- `cases(user_id, created_at DESC)`
- `analyses(case_id, created_at DESC)`
- `analyses(workflow_instance_id)` unique
- `citations(analysis_id)`
- 모든 FK는 활성화하고 소유 데이터는 cascade delete한다.
- 완료 분석은 `encrypted_result`, 실패 분석은 `failure_code`를 요구하는 논리 제약을
  repository에서 검증한다.

## 암호화 envelope

형식은 `v1.<key-id>.<base64url-iv>.<base64url-ciphertext-and-tag>`다. AES-256-GCM에
96-bit 무작위 IV를 사용하며 AAD는 `<table>:<row-id>:<column>:<user-id>`다. 같은 값을
다시 저장해도 IV를 재사용하지 않는다. 복호화는 키 버전 allowlist를 거치며 실패는
원문을 로그에 남기지 않고 `CRYPTO_DECRYPT_FAILED`로 처리한다.

키 회전은 새 쓰기를 새 버전으로 전환한 뒤, 인증된 백그라운드 작업으로 읽기-복호화-
재암호화한다. 이전 키는 모든 행의 이동과 복구 검증이 끝나기 전 삭제하지 않는다.

## 마이그레이션 규칙

- 모든 schema 변경은 Drizzle SQL, 역호환 배포 순서, 데이터 검증 쿼리를 포함한다.
- 먼저 nullable/additive 변경을 배포하고 backfill 후 제약을 강화한다.
- production migration 전 D1 backup/bookmark를 기록하고 preview에서 동일 migration을
  검증한다.
- 정책과 다른 보존용 shadow table을 만들지 않는다.
