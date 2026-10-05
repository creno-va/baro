# 도메인 DB 적용과 검증

## Schema와 적용 순서

`0003_domain_foundation.sql`은 기존 `0000`~`0002` 및 인증 행을 변경하지 않는 additive migration이다.
기존 6개 테이블에 cases, analyses, citations, daily_usage, legal_source_cache,
idempotency_records, dispatch_outbox, deletion_jobs를 더해 총 14개 테이블을 만든다.
Drizzle schema, snapshot과 journal을 함께 유지하며 이전 migration을 재작성하지 않는다.

1. `bun ci`, `bun run check`, `bun run build`, `bun run cf:dry-run`을 실행한다.
2. `bun run db:generate`가 새 파일을 만들지 않는지 확인한다. fresh 및 auth 데이터가 있는
   upgrade는 실제 SQLite로, 로컬 binding은 workerd D1 migration으로 검증한다.
3. preview D1에 `bun run db:migrate:preview`를 적용하고 아래 비민감 쿼리를 확인한다.
4. 동일 SHA의 Worker를 배포하고 health의 schema version과 배포 SHA를 기록한다.

main CD는 migration 후 Worker를 배포한다. production에는 기존 Environment 승인과 복구 계획이
필요하다. 이 문서는 production 공개 전환이나 외부 승인 완료 증거가 아니다.
이전 Worker는 추가 테이블을 사용하지 않아 migration 후에도 동작한다. Worker rollback 시
추가 테이블을 DROP하지 않는다. 데이터 손실을 피하기 위해 DB 수정은 후속 forward migration으로 한다.

## Preview 검증 쿼리

다음 쿼리는 행 내용, 사건 원문, 토큰 또는 SQL 오류 stack을 출력하지 않는다.
preview에서 `bunx wrangler d1 execute DB --env preview --remote --command "..."`로 실행한다.

```sql
SELECT key, value FROM app_metadata WHERE key = 'schema_version';
SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
('user','session','account','verification','user_consents','app_metadata',
 'cases','analyses','citations','daily_usage','legal_source_cache',
 'idempotency_records','dispatch_outbox','deletion_jobs') ORDER BY name;
PRAGMA foreign_key_check;
SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN
('cases','analyses','citations','daily_usage','idempotency_records','dispatch_outbox','deletion_jobs')
ORDER BY name;
```

예상 schema는 `0004_case_feedback`, 테이블 수는 15, foreign key 위반은 0이다.
`0004`는 선택적 도움 여부 boolean/analysis reference/timestamp만 저장하는 additive
테이블이며 기존 인증·사건·암호문을 변경하지 않는다. 사건/분석 삭제 시 FK cascade된다.
제품 분석 event 또는 자유 텍스트를 저장하지 않는다. upgrade 데이터 보존과 fresh/drift를
CI에서 검증하며 자동 preview migration 뒤 health/ready의 schema를 다시 확인한다.
업그레이드 회귀 검증은 인증 5개 테이블의 모든 기존 행과 별도 metadata sentinel의 보존을 비교한다.

## Repository 사용 계약

`src/server/db/repository.ts`는 내부 저장 primitive다. 호출 전에 route가 세션·현재 동의·abuse
정책을 확인해야 한다. 사건 읽기, 목록, analysis, citation, cursor는 모두 owner를 포함한다.
입력·checkpoint·답변·결과는 Web Crypto envelope와 행·열·owner AAD로 암호화한다.
오류에는 원본 SQL, 암호화 원인 또는 사용자 원문을 넣지 않는다.

초기 저장 batch의 모든 종속 쓰기는 같은 owner 존재와 KST 일일 quota `< 10` 조건을 반복한다.
quota 증가는 마지막에 실행하며 `changes()`에 의존하지 않는다. quota 0-row와 중복 충돌은
각각 전체 no-op 또는 rollback이다. #11은 이 primitive 앞에 실제 admission을 구현한다.

analysis 쓰기는 owner·current analysis·revision·attempt·예상 status CAS로 보호한다.
질문은 최초 revision에서 한 번, 최대 5개, 정확히 24시간 deadline으로 원자적으로 전환한다.
`advanceRevision`은 저장 CAS만 제공한다. #13의 답변 admission은 idempotency 응답을 같은
batch에 포함해야 하며 별도 후속 쓰기로 조합해서는 안 된다. stale writer와 삭제 뒤 writer는 no-op이다.

사건 삭제는 opaque target/workflow ID journal과 cascade를 한 batch에 기록한다.
#12의 HTTP idempotency, #17의 계정 삭제·복구 후 journal 재적용, #19의 운영 drill은 별도다.
35일 journal 보존 목표와 정리는 #17/#20의 정책 및 운영 구현을 따른다.
공개 법령 cache는 계정 삭제와 독립적이며 body hash를 확인하고 TTL을 최대 24시간으로 제한한다.
#14가 실제 공식 응답·시행일·출처 검증을 구현한다.
