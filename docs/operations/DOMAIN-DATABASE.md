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

예상 schema는 `0005_deletion_cleanup`, 테이블 수는 15, foreign key 위반은 0이다.
0005는 기존 opaque deletion journal에 cleanup cursor와 다음 시도/lease 시각만 추가한다.
기존 primary/auth/domain 데이터와 Workflow ID 목록을 변경하지 않는다.
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

## v2 additive 적용 계약 (#55)

위 schema/one-batch 질문/day10 quota는 기존 v1 계약이다. v2는 #54의 strict 계약 다음 #55가
단일 소유자로 workspace/intake/summary revisions/messages/actions/timeline/files/jobs/lawyers/
revisions/moderation/reports/quota/cost와 삭제 inventory를 additive하게 통합한다. 기존 migration
0000~0005와 기존 사건 암호문·읽기 동작을 보존하고 기존 사건을 자동 재분석/마이그레이션하지 않는다.
v1과 v2 contract version/조회 경로를 명시해 새 UI에서 오래된 사건을 정상 재열람할 수 있게 한다.

`0006_v2_domain_foundation.sql`과 같은 번호의 snapshot/journal이 기존0000~0005 뒤에
적용된다. fresh는 애플리케이션 선언 테이블82개와 foreign key 위반0, metadata의 schema version
`0006_v2_domain_foundation`을 요구한다. 위15개/0005 검증은 이전 v1 baseline이며
0006 적용 뒤의 health 기대값으로 재사용하지 않는다. 원격 적용·배포 결과는 별도로 기록한다.

schema 생성 번호·테이블/column 이름은 실제 #55 PR이 정본이다. 목표 table 이름을 SQL에
넣고 원격 적용하거나 각 작업자가 별도 번호를 만들지 않는다. 다른 모듈은 공통 repository/
schema PR 병합 이후 사용한다. 모든 새 write는 owner/role/current revision/idempotency/
expected status/tombstone을 같은 transaction에서 검증한다.

intake의 새 question batch·summary confirm·chat·file finalize·moderation decision은 CAS로
진행한다. pending profile revision은 approved public revision을 덮어쓰지 않는다. 비용·사용자
quota reservation/outbox·row 생성은 원자적으로 처리하고 실제 external attempt와 분리해
crash/retry 때 중복 차감·중복 호출을 막는다. 운영자 역할은 trusted 지정으로만 부여한다.

적용 전 fresh/upgrade는 v1 auth/consent/cases/analysis/feedback/journal row와 모든 FK/암호문을
비교한다. migration 후 같은 SHA의 health schema/version, 실제 workspace upload/chat/export/
moderation/reload를 검증한다. 로그에는 aggregate schema/FK/count만 남기고 원문·SQL dump를
artifact에 올리지 않는다. quota는 [비용 계약](./COST-CONTROLS.md)의 KST3/30/60min/10GB와
atomic reservation을 적용하며 기존 v1의 `<10` 검사 통과를 v2 quota 성공으로 취급하지 않는다.

R2 bytes와 DB inventory, job lease·object revision·public pointer를 함께 reconcile한다. R2
commit 실패 때 DB ready를 남기지 않고 staging/outbox로 복구하며 source of truth는 실제
검증된 manifest다. orphan cleanup은 tombstone·pending reservation을 대조해 정상 객체를
이름/age만으로 지우지 않는다. 모든 schema forward-fix/rollback은 [배포](./DEPLOYMENT-OPERATIONS.md),
restore는 [DB 밖 최신 journal 재적용](./DELETION-RESTORE.md)을 따른다.

### 후속 서비스의 bounded repository 사용

`createV2Repository(DB, cipher, { environment })`의 환경을 실제 배포 환경과 일치시킨다.
route/Workflow가 인증·동의와 dispatch를 맡고 저장소는 owner/CAS/idempotency/lease/
tombstone·transaction을 맡는다. repository 자체는 외부 API나 R2를 호출하지 않는다.

직접 snapshot helper는96KiB, full-read convenience는4MiB까지다. 초과 입력은
`SNAPSHOT_STREAM_REQUIRED`로 분기하여64KiB parts·ordered receipts·metadata paging을
사용한다. 각 batch는40 SQL statements/statement별100 parameters/SQL+values2MiB 이하다.
요약·coverage·사용자 편집·리포트·legacy 전환은 durable staging을 bounded step으로 처리하고
다음 invocation에서 저장된 cursor로 재개한다. 원본100MiB 이상을 한 D1 batch에 넣지 않는다.

큰 사건/자료 목록은 metadata API를 사용한다. 자료 metadata 최대50개 page는2회 SQL이며
전체 DTO `files.list`는4개까지다. 큰 snapshot stream은 part 순서·bytes·digest를 검증하고
삭제·pointer 변경을 다시 검사한다. 미완료 part나 변경된 source를 최종 published로 전환하지 않는다.
legacy 전환의 sealing과 publication은 별도 transaction이므로 실패 뒤 sealed checkpoint를
재사용할 수 있다. 원래 v1 사건 삭제는 staging/sealed 전환 모두 정리한다.

수동 safe-integer triggers는 새 v2 INTEGER column 모두에 적용한다. Drizzle 생성 snapshot과
수동 CHECK/trigger SQL이 함께 유지되어야 하며 db:generate의 drift 없음만으로 SQL 제약
검증을 대신하지 않는다. 실제 fractional/negative/unsafe INSERT·UPDATE 실패와 최대 safe
integer 보존은 SQLite 테스트로 확인한다. migration 뒤 rollback은 additive 테이블을 보존한다.
D1 내부 관리 테이블은 애플리케이션82개 집계에서 제외한다. 새 릴리스 smoke는 candidate의
최신 journal tag를 정확히 확인한다. 이전 Worker rollback은 DB를 이전 tag로 되돌리지 않고,
남아 있는0006 marker와 이전 Worker의 read/write·삭제 호환성을 별도 drill로 확인한다.

## 후속 유료 실행·공식 cache 확장 (#87)

`0007_runtime_paid_execution`은0000~0006을 변경하지 않는 append-only 확장이다. runtime proof,
plan, hold, usage, control, drain, maintenance와 claim 저장소9개를 추가해 애플리케이션 선언
테이블은91개가 된다. 위82개/0006은 이전 foundation baseline이다. 새 candidate의 정확한
schema marker는0007이며 실제 원격 적용·같은 SHA 배포 결과는 별도 증거가 필요하다.

가격·funding·allocation은 trusted server verifier가 정본 digest와 evidence를 확인한 뒤 immutable
proof로 저장한다. proof가 없거나 만료되면 paid hold를 만들지 않는다. `prepareHold`의 준비 객체는
동일 guarded admission transaction 안에서 operation/quota/job/outbox와 비용을 함께 기록한다.
현재 lease/revision·동의·tombstone과 proof 유효성을 acquire 및 최종 `beforeDispatch`에서 확인한다.
runtime control을 초기화한 뒤에는 hold를 생략한 기존 v2 admission/acquire를 허용하지 않는다.
HTTP/Workflow 소비자는 #87 공유 PR main 병합 뒤 연결하며 실제 factory가 없는 paid 실행은 닫는다.

Gateway receipt의 input/output·cache-read/write·실제 tier를 정본 가격 matrix와 대조한다. cache
누락·불일치·timeout은 ambiguous hold로 남는다. 늦은 불완전 usage도 동일 attempt의 immutable
evidence로 보존하되 금액을 반환하지 않는다. 계정 삭제나 원래 proof의 만료 후에도 확정된 늦은
청구는 원래 가격 근거로 정산한다. not_sent 후보는 prepared/reserved와 dispatch token 부재를
같은 CAS에서 확인해야만 비용을 반환하며, 다른 Worker의 dispatched attempt를 취소하지 못한다.

환경 간 allocation은 freeze→감소/drain→신뢰 가능한 양쪽 acknowledgement→증가/resume 순서다.
전역100만원은 환경 cap과 shared 의무의 합계이며 두 D1의 batch를 전역 atomic으로 표현하지 않는다.
이전 월 미정산 hold와 maintenance exposure를 새 월 여유로 지우지 않는다. 필수 유지 비용,
청구 대조·읽기·삭제는 새 paid admission과 구분한다. 실제 funding·환율·청구·전환 증거는 #57/#71이다.

최초 발견 공식 cache는 공개 identity/type/version/section/extractor만으로 최신 유효 tuple을 찾는다.
private 검색질의는 저장하지 않는다. 최대2회 indexed query와1MiB body hash 검증으로 bounded하게
조회하며, 검증 중 새 tuple이 추가되면 이전 결과를 반환하지 않는다. fetched/verified/expiry는
canonical UTC milliseconds로 저장·비교한다. exact tuple와 immutable 본문·allowlist 검증은 유지한다.

fresh와 populated0006→0007의 모든 기존82개 테이블 행·FK·암호문/AAD·snapshot·읽기/삭제를
검증한다. DB rollback으로 새 테이블·비용 proof·hold를 DROP하지 않으며 restore 뒤에도 최신
삭제 journal과 allocation·비용 상태를 재적용한다. 로컬 SQL/AES 성공은 실제 restore drill이 아니다.


## SQL 파일 migration과 R2 maintenance 연결 (#108)

preview의0009가 원격 query 경로에서 `incomplete input`으로 중단되어 배포 schema가0008에
남았다. `db:migrate:preview`와 `db:migrate:production`은 기존 SQL을 수정하지 않고 원문과
`d1_migrations` 기록을 같은 [D1 SQL 파일 import](https://developers.cloudflare.com/d1/best-practices/import-export-data/)로 적용한다.
파일 import의 atomic rollback을 사용하며 trigger 본문을 세미콜론으로 분할하지 않는다.
적용 기록은 알려진 migration의 연속 prefix여야 한다. 실패 시 배포를 중단하고 기록을 확인한
뒤 재실행한다. ledger를 임의로 채우거나 기존 migration을 편집하지 않는다. 로컬 fresh import·
실패 rollback·재실행 검사는 CI에 포함되며 원격 성공은 같은 SHA의 preview smoke로 확인한다.

private 원본 파일과 변호사 원본 GET, private/publiccopy cleanup의 DELETE·HEAD는 실제 IO
직전에 현재 월 storage projection과 capacity binding의 일회 permit을 소비한다. 한도 소진·
proof 만료·동의/소유 변경 시 IO를 중단한다. cleanup은 현재 journal token·fencing·lease를
확인하고 running writer를 보존한다. 불확실한 IO의 카운터는 반환하지 않으며 DELETE 이후
HEAD까지 허용·확인된 경우에만 cleanup receipt를 기록한다. 업로드 완료는 처리기가 읽는
한 번의 stream에서 모든 part·전체 hash를 검증하고, 끝까지 검증되지 않으면 완료하지 않는다.
