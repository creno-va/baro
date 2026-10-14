# 자료·리포트·삭제 구현 검증

> **2026-10-14 프리베타 비용 관측 전용 — 현행 지시:** `APPLICATION_COST_LIMITS_ENABLED=false`에서 비용 금액·가격/FX/funding 관측 누락·만료·월별 할당·비용 승인·수동 refresh·유지비·비용 예약 IO 횟수로 기능이나 배포를 막지 않는다. 사용자 재지시 전 재도입 금지. 비용 원장·관측 사실은 보존하며 관측 시각/금액을 조작하지 않는다. AI200/일·실제 기술용량/횟수·권한/보안/무결성·실제 공급자 오류는 유지한다. 아래 과거 비용 차단 지시·실패 기록보다 [현행 정책과 구현 상태](../operations/PREBETA-COST-POLICY.md)가 우선한다.

## 2026-10-13 업로드 저장 연결 보완 (#58/#59/#67)

**PR229 검토 후 병합 보류:** 아래 최초 구현의 D1 row receipt 한도는 실행 전
비용 상한의 증거가 아니었다. 공용 projection·carryover·원본 합계 조회와 트리거의
scan을 실행 전에 제한하는 공용 계약이 필요하며 총괄이 담당을 조율한다.
`runtime.ts`의 D1 최대 수량은 아직 승인된 상한으로 간주하지 않는다.

같은 PR의 미전송 정리 보완은 SQL 전에 opaque writer token을 보유하고, 성공이
확인된 start에만 R2 dispatch를 허용한다. start commit 뒤 row 초과·metadata 누락·
응답 유실 3건과 stop commit 뒤 응답 유실로 journal을 건너뛰는 1건을 수정 전
실패로 재현했다. normal query 슬롯과 6개의 cleanup 슬롯을 처음부터 분리하고,
exact paid/upload/ordinal/blob/owner/token을 검사한 stop 1문장 및 abandon journal
5문장을 각각 시도한다. cleanup 진입은 한 번뿐이며 정상 작업으로 돌아갈 수 없다.
stop/journal 응답 유실을 성공으로 바꾸지 않고 독립된 다음 정리 요청으로 확인한다.
기존 beginWrite 소비자는 유지한다. 변조·복제 permit, 다른 identity, 재시작을 거부하고
실제 R2 호출이 불명확한 writer는 running을 유지한다. cleanup SQL/trigger의 실행 전
row 비용까지 전체 quote에 포함하는 작업은 위 공용 비용 상한 보완과 함께 남아 있다.

일반 StorageCosts 포트에는 cleanup 후 `after` 전용 notification 단계도 한 번만
허용한다. 기존 usage 기록의 2개 PK 조회와 최대 8개 transition statement에 해당하는
10개 슬롯을 정상 작업에서 처음부터 분리한다. 이전처럼 닫힌 normal core에서
통지하면 실제 metered core·기존 원장·합성 인증 증거 검사 4건이 실패하고,
별도 단계 적용 뒤 5건 / 134 assertions가 통과했다. 증거가 있는 incomplete 통지는
reserved→ambiguous로 기록하며, 증거 부재·원장 쓰기 실패는 reserved를 보존한다.
cleanup 응답 유실과 무관하게 notification을 시도하고 원장 실패도 journal을 지우지
않는다. 현재 production `createFileStorageBudget`는 metering을 받지 않는 고정
구성이므로 `after`의 SQL은 0건이다. 미래 metering 구성·global freeze의 SQL/trigger
상한이나 실제 사용료 계측까지 이번 기능 회귀로 인증하지 않는다.

실제 `9fcf04f82c1fe5c9c10d1dae76ee4a998586604d`에서 합성 PDF를 한 번
제출했으나 UI는 실패했고, 원격 읽기 진단은 file `reserved` / upload `open`,
blob·part·job 0건이었다. 그 관찰만으로 PUT HTTP 상태를 추정하지 않는다.
같은 전역 signed API를 로컬 production 구성에서 실행하여 reserve 201 →
part PUT 503 / R2 호출 0을 별도로 재현했다. 파일 의존성의
`createStorageBudgetService`에 필수 bounds가 없어 모든 신규 PUT이 거부됐다.

- 기존 저장 원장에 원본 part 전용 bounds를 연결했다. 유효한 해당 환경의
  가격·재원·할당·물리 용량 projection이 있어야 한 번의 R2 PUT을 허용한다.
  R2 요청뿐 아니라 Worker 요청·CPU 및 D1 읽기·쓰기 수량을 함께 예약한다.
  이 연결은 새 proof나 provider 청구 영수증을 만들지 않는다.
- pending 원본·비용 hold·물리 binding을 같은 D1 batch에서 승인한다. 실제
  전송 전에 writer를 running으로 기록하고, 정확한 key/size 응답 또는 미전송
  증거로만 stopped로 바꾼다. 불명확한 전송은 running과 삭제 journal을 보존한다.
- part 요청의 SQL statement와 batch 각 항목을 실행 전에 계수한다. 실제 D1
  rows_read/rows_written metadata가 없거나 누적 한도를 넘으면 후속 SQL을 중단한다.
  이미 실행된 SQL을 취소하거나 row receipt를 청구 영수증으로 간주하지 않는다.
  비용 예약은 검증된 provider 정산이 없으면 그대로 남는다.
- `tests/files-storage-runtime.test.ts`는 실제 workerd D1과 모든 migration,
  전역 signed API·실제 AES·합성 R2 adapter를 사용한다. 합성 PDF reserve 201 →
  PUT 200, 원본 바이트 복호화 일치, physical held / writer stopped, 다섯 비용 SKU,
  중복 PUT 없는 재시도가 통과했다. preview proof만 있는 production 구성은
  같은 요청을 503으로 거부한다. 이는 원격 R2/OAuth/Container 성공 증거가 아니다.
- 용량 부족·projection 만료·freeze는 R2 호출 없이 차단되고, prepare 뒤 freeze는
  pending·binding·비용 hold를 함께 롤백한다. 늦은 PUT 도중 자료 삭제는 running
  writer의 cleanup을 차단한다. 응답 후 첫 DELETE가 실패해도 held 상태를 유지하고,
  재시도 DELETE와 absent HEAD 후에만 용량을 해제하며 삭제한 자료의 재업로드를 거부한다.
- 기존 자료·원본·리포트·세션 폐기·정리 회귀 12개 파일의 90 tests /
  1,182 assertions가 통과했다. paid storage 회귀 9 tests / 208 assertions는
  불명확한 PUT의 cleanup 차단과 정산 저장 실패 시 원본 미공개를 포함한다.

총괄이 #228 리포트 수정본을 별도로 배포하며 Safari를 소유한다. 업로드 수정본의
동일 SHA CI·배포 및 실제 저장 proof/projection 연결 뒤에 원격 인수를 재개한다.
이전의 OAuth 2계정 요청은 이후 사용자 지시에 따라 현재 Safari의 허가된 Kakao
계정 한 개로 진행하는 범위로 변경됐다. 다른 세션의 계정·사건을 사용하지 않는다.
계정 간 접근 경계와 #19 격리 복구/재삭제 훈련 등 확보하지 못한 외부 증거는
완료로 표시하지 않으며 #58/#59/#66/#67과 Goal은 미완료로 유지한다.

## 2026-10-11 실제 인수 재개

인수 담당은 `BARO 자료·리포트·삭제 인수`, checkout `de87`, 브랜치
`codex/58-material-acceptance`다. 기존 PR130/164 및 통합 PR167의 구현·아래 증거를
승계한다. 총괄이 지정한 preview는 `https://preview.baro.site`, SHA
`283af452b7093d8cac0d9aa2c41b28a22b58d5e9`이며
[수동 배포 run38124298959](https://github.com/creno-va/baro/actions/runs/38124298959)가 성공했다.
테스트 namespace는 `materials-de87-20261011`이다. 다른 세션 계정·사건은 사용하지 않는다.

- 17:25–17:26 KST 원격 읽기: `/api/health/live`의 release가 위 SHA와 일치했다.
  익명 요청으로 이 namespace의 자료 목록 및 HTML/PDF/ZIP 경로를 조회한 4건은
  모두 `401 UNAUTHENTICATED`, `private, no-store`, request ID 포함이었다.
  존재하는 계정·사건을 조회하지 않았으며 업로드·처리·삭제 성공 증거는 아니다.
- 기존 합성 fixture 11개, 644,318 bytes의 무결성 검사를 통과했다. document/image/
  audio/video와 손상 파일 대조군을 그대로 재사용한다. 이 검사는 OCR/Whisper 실행이 아니다.
- Container proxy에서 시작 도중 취소가 먼저 stop을 끝낸 뒤 startup이 늦게 완료하면
  원본 처리 POST를 보내고 인스턴스를 남기는 경합을 재현했다. 새 회귀가 수정 전 실패했다.
  startup 직후 abort를 재검사하고 늦게 시작한 인스턴스를 다시 stop하여 원본 dispatch를
  차단한다. 실패 응답은 기존 `PROCESSOR_UNAVAILABLE`로 제한한다.
- 수정 후 container proxy/transport/execution/retry 및 deletion reconcile/restore
  6개 파일의 **42 tests / 308 assertions**가 통과했다. `bun ci`, `validate:quick`,
  `validate:build`(production build·163-file bundle·Worker dry-run)도 통과했다.
  UI/schema/native processor 자체는 변경하지 않아 browser/db/native/full을 반복하지 않았다.
- 후속 #58 점검에서 원본 다운로드 도중 requesting session이 폐기/만료되거나 보존
  기한을 넘겨도 plaintext가 계속 나오는 결함을 합성 SQL·서명 세션·R2 byte adapter로
  재현했다(수정 전 3개 FAIL). HTTP 원본 service에 exact session ID를 전달하고 기존
  per-part SQL 접근 검사에 세션 소유자·유효기간·보존 기한을 결합했다. 다른 활성
  세션이 같은 owner에게 있어도 요청 세션을 대신하지 않는다. 다운로드 도중 폐기 시
  다음 part를 R2에서 읽기 전에 중단하고, R2 응답 중 폐기 시 해당 평문도 전달하지 않는다.
  마지막 비동기 헤더 복호화 뒤에 최종 접근 검사를 수행하여 첫 `reader.read()`부터
  평문 전달이 차단됨을 확인했다(EOF 실패만 확인하면 이미 보낸 평문을 놓친다).
  자료/리포트 관련 5개 파일의 **40 tests / 316 assertions**가 통과했다. 유효한 세션의
  기존 원본은 필수 재동의 전에도 다운로드된다는 반대 조건을 함께 확인했다.

다음 실제 증거는 아직 없다. 전용 폐기 가능한 OAuth 계정 2개(소유자·비소유자)가 필요하며
총괄에 요청했다. 해당 계정에서 업로드→R2/Container/Whisper→교정/재접속→최신
HTML/PDF/선택 ZIP→자료·사건·계정 삭제와 원격 negative HEAD/임시물 정리를 검증한다.
복구 후 재삭제는 #19 총괄이 격리 환경·최신 외부 journal·복구 관리자 조건을 확인한
**한 번의 drill**에만 합류한다.

### Native 임시물 수명 보완 (#59/#67)

총괄과 인증·AI 담당이 processing/asset runtime의 identity·binding·lifecycle 수정을
이 담당에게 인계했다. Workflow가 없을 때 과거 `file-processing-*` native 작업의
실제 stop 확인 없이 journal이 완료되는 로컬 SQL 재현을 확보했다.
[PR #208](https://github.com/creno-va/baro/pull/208)에 다음 보완을 모았다.

- 새 file/asset/probe job은 `native-v1-*` 이름을 사용한다. 기존 job/outbox가 보존하는
  attempt runtime ID가 Container 이름과 같아 삭제 후에도 도달할 수 있다. schema나
  migration을 추가하지 않는다. 실제 SQL 재시도 후 삭제에서 `-1`과 `-2` 모두
  inventory에 남고 두 attempt를 revoke한 다음 원본이 삭제됨을 검증했다.
  10번째 attempt ID도 54~55자로 기존 100자 opaque ID 계약을 통과한다.
- 같은 attempt의 문서 페이지·영상 unit은 순차 실행하고 unit마다 깨끗한 native
  process를 시작한다. 이전 DO가 재생성됐을 때 남은 process도 시작 전에 destroy한다.
  실제 SQL/AES 2페이지 처리→파생물→coverage publication에 동일 lifecycle/proxy를
  연결한 합성 회귀와 새 ID를 사용한 file/asset Workflow dispatch 회귀가 통과했다.
  스트리밍 Request를 복제하지 않고 proxy에 수명 신호를 별도로 결합하여 원본 스트림을
  유지하며 취소·삭제 신호를 함께 적용한다.
- 삭제 RPC는 비민감 boolean tombstone을 DO storage에 저장하고, 진행 중 요청을
  취소하며 늦게 완료하는 start까지 기다린 뒤 `destroy()`가 성공해야 반환한다.
  재생성된 DO도 tombstone을 읽어 start를 거부한다. journal은 revoke와 Workflow
  delete가 모두 성공한 뒤 receipt를 기록한다. persistence/destroy/Workflow 오류는
  pending으로 남고 같은 대상 재시도가 가능하다.
- 과거 임의 Container ID는 이름을 재구성할 수 없다. Workflow 부재뿐 아니라
  file/asset Workflow 삭제 성공만으로도 완료 처리하지 않는다. 이 대상과 그에 묶인
  R2 정리는 플랫폼 종료 증거가 마련될 때까지 pending이다. 기존 완료 journal을
  이번 변경으로 소급 검증하거나 과거 random native 물리 삭제의 성공으로 간주하지 않는다.
- SDK `@cloudflare/containers` 0.3.7의 destroy는 native destroy를 await하고 DO storage를
  지우지 않는다. [공식 destroy 계약](https://developers.cloudflare.com/containers/api/container-class/)
  역시 runtime이 파괴된 뒤 완료됨을 명시한다. 이는 로컬 구현·계약 확인이며 실제
  배포 인스턴스의 종료 성공 증거는 아니다.
- 기존 요청 deadline 265초, startup 15초/port 20초, container CPU 600초 및 memory/disk
  비용 상한은 유지한다. unit당 새 process라는 자원 구조도 유지한다. 추가된 DO storage
  읽기·삭제 tombstone 쓰기와 RPC의 실제 지연·청구는 원격 인수에서 확인해야 한다.

로컬 lifecycle/proxy, 삭제·복구, paid admission, asset runtime 및
transport/execution/retry/dispatch **10개 파일의 중복 없는 102개 검사**가 통과했다. 늦은 start·늦은 응답·저장 실패·
종료 실패·재실행·순차 unit을 포함한다. `validate:quick`은 초기 테스트 타입 오류 수정 및 후속 proxy 변경 뒤 최종 통과했다.
도구 계약 18 tests / 252 assertions도 통과했다. `validate:build`의
production build·bundle·Worker dry-run은 통과했다. native Python/image는 변경하지
않았고 실제 Container 실행은 원격 인수 대기다. 최신 exact-head 결과는 PR에 연결한다.

#58/#59/#66/#67과 Goal은 미완료다. 전용 계정의 실제 업로드/처리/리포트/삭제와
총괄의 한 번의 격리 복구 drill, 새 candidate의 Container 물리 종료 증거가 필요하다.

## 기존 구현·검증 기록

담당 이슈: #58, #59, #66, #67. 브랜치: `codex/58-files-reports-deletion`.
기준 main: `c6b96656ee6e4d7c968486b47a994b2807bdeadd` (PR #125 UI, #126/#128 및 #127/#129/#131 공유 경계 포함).
ADR-0014의 고객/변호사 MVP 및 실제 client UI/API adapter 구성을 유지한다.
schema/migration, 공유 router/auth, Cloudflare 배포 설정은 변경하지 않는다.

## 구현 범위

| 범위 | 재사용 및 보완 | 근거 |
| --- | --- | --- |
| #58 private 자료 | 기존 reserve/stream/AES/R2/finalize/manifest adapter를 유지. client 전체 파일 버퍼 대신 증분 SHA-256. 재시도는 기존 operation/job과 consent/revision/paid runtime proof를 검증하여 한 outbox만 생성 | `tests/file-processing-retry.test.ts`, 기존 files/provenance/paid-runtime tests |
| #58 public 자료 | 기존 asset sanitizer·private 저장·public 복사 경계를 보존. MVP 프로필 photo/portfolio 연결은 별도 소유 PR #126의 실제 adapter를 재사용. 삭제 mock도 새 assets map과 profile owner map 정리 | `tests/reports-account.test.ts`; PR #126의 self-assets SQL/API 검증 |
| #59 Containers/Whisper 경계 | Container는 OCR/영상/PCM만 수행. ffmpeg output-side seek와 실측 WAV sample count로 AAC priming 손실을 수정. 길이/coverage 불일치는 실패로 남김 | `services/file-processor/fixture-test.py`; 합성 M4A/WAV/FLAC 로컬 native 검증 |
| #66 report/export | 실제 SQL 정본·확정 summary·현재 source digest·공식 citation snapshot을 사용. immutable review revision, masking/exclusion/ownership, encrypted R2 PDF와 선택 원본 ZIP, lost-response idempotency | `tests/reports-{service,paid-storage,api}.test.ts` |
| #66 UI 접근 경계 | peer-tab 계정/역할 전환·접근 거부·늦은 응답에서 이전 편집/선택/확인/다운로드/modal을 제거. stale revision 복구, 원본 경고, 진행/실패 표시, 모바일·키보드 modal | `tests/browser/reports.e2e.ts`, 독립 integration 회귀 |
| #67 삭제 | 실제 `/me` 삭제 batch에 exact owner account-type metadata 정리. journal replay는 user 부재에도 metadata 정리. publication runtime inventory와 late-job fencing 유지 | `tests/account-metadata-cleanup.test.ts`, `scripts/deletion-journal.test.ts` |
| #67 물리 정리 | v2 durable journal/lease/receipt, job stop → private/staging/public delete → negative HEAD → reservation release. running/unknown writer, 부분 실패, stale lease, 예산/권한 실패는 pending 유지 | `tests/v2-deletion-reconcile.test.ts` |
| #67 설정 | load/focus/pagehide/pageshow 요청 수명과 재인증 generation으로 이전 화면의 늦은 접근/OAuth 실패가 새 marker를 지우지 못하도록 함. owner-tag 삭제 확인 header, 사용량/사건/계정 삭제 상태 및 확인 modal 정리. 다른 계정이나 reauthentication 실패 후 이전 usage/confirmation 제거. accepted 뒤에만 기존 비민감 session marker를 발행 | signed-session SQL 및 browser 회귀 |

## 다운로드 검증

`tests/browser/report-real-download.e2e.ts`는 실제 SQL/AES/Hono/signed session,
실제 제품 ReportReview/client API와 원본 byte adapter를 사용한다. 외부 R2 대신
명시적 합성 byte adapter와 test-only unmetered preview composition을 사용한다.
따라서 실제 HTTP 다운로드 증거이며 원격 Cloudflare 처리/정산 증거는 아니다.

- PDF의 `%PDF-`, embedded FontFile2/ToUnicode, 한글 표시 및 마스킹을 확인한다.
- Python zipfile로 사용자가 고른 원본 하나의 UTF-8 파일명과 원본 바이트를 비교한다.
- 다른 파일·제외 파일·중복 선택·foreign owner·삭제·source 변경은 허용하지 않는다.
- 375px 화면의 가로 overflow를 확인하고 합성 스크린샷만 생성한다.
- 별도 합성 긴 PDF는 13페이지, 400행 및 마지막 한글 표식의 추출을 확인하고
  Poppler로 첫/마지막 페이지를 렌더링해 육안 검사했다.
- PDF font는 기존 Pretendard OFL 원본에서 static weight 400을 재현 가능하게
  생성한다. `scripts/build-report-font.py`와 `public/fonts/README.md` 참고.
  일반 한글 음절을 포함하며 원본 font에 없는 glyph는 대체 표시한다.

원본 ZIP은 식별정보를 마스킹하지 않는다. 사용자의 명시적 선택만 포함하며
변호사 자동 전송을 추가하지 않는다. 900MB·100개는 절대 입력 상한이며,
실제 동기식 ZIP은 아래 SQL 작업량 한도를 충족한 선택만 허용한다.
256KiB AEAD chunk와 세 번의 stream pass로 ZIP 전체를 메모리에 올리지 않는다.
late deletion/owner/revision/hash 변화는 stream을 중단하고 완료로 표시하지 않는다.

## SQL 작업량과 청크 검사

리포트 복호화·정본 재구성을 매 청크 반복하지 않는다. immutable report envelope,
source identity(동일 revision의 ciphertext/coverage 변경 포함), 소유권·고객 역할·
현재 동의·삭제·lease·revision은 청크마다 한 SQL fence로 재검사한다.

`reportWorkPlan`은 PDF/ZIP 출력 청크, 선택 원본 수, 실제 SQL upload part 수와
source 행 수를 반영한다. 정상 처리 예상 query가 800을 넘거나 source가 250행을
넘으면 원본 R2 GET과 export PUT 전에 413으로 거부한다. 정상 작업에는 계산한
query 한도, 실패 정리에는 최대 900 query를 적용해 session/middleware 여유를 남긴다.
D1 batch의 각 statement도 dispatch 전에 계수한다. 원격 D1 rows_read/rows_written
metadata가 없으면 native 구성은 거부하며, 실제 누적 row receipt가 예약한 envelope를
넘으면 후속 SQL을 중단한다. 불명확한 PUT/정산은 journal과 inventory를 유지한다.

[Cloudflare D1 공식 한도](https://developers.cloudflare.com/d1/platform/limits/)의
Paid invocation당 1,000 query 한도를 기준으로 한다. SQLite 계수는 원격 D1 scan
비용이나 플랫폼 성공 증거가 아니다. 합성 SQL 두 원본 ZIP은 800 query 미만이며,
큰 계획 거부 뒤 작은 선택 재시도·query/batch 선행 차단·row receipt 중단·청크 사이
역할/동의/원본/리포트/삭제 변경을 `tests/reports-limits.test.ts`로 검증한다.

## 공유 연결: 4번 소유

1. API `/v2`에 `src/server/api/v2/reports.ts`의 `createReportsApi()` mount.
   실제 의존성은 `createReportDependencies(env, core, ownerId)`가 구성한다.
2. scheduled의 기존 intent/job 처리 뒤
   `src/server/modules/deletion/v2-reconcile.ts`의 `reconcileV2Deletion(env)` 호출.
3. report PATCH에만 131,072-byte streaming JSON bound 적용
   (30,000자 한글은 기존 global 65,536 bytes를 초과할 수 있음).
4. 실제 CPU/deadline·R2/D1 비용 및 최대 크기 ZIP 처리 검증.
   로컬 작은 합성 입력이 원격 대용량 처리 성공을 입증하지 않는다.
   동기식 SQL 작업량 한도를 넘는 요청은 거부하며 선택을 줄여 재시도한다.
   실행 plan은 CPU 300,000ms를 예약하므로 배포 설정/실측 한도가 맞아야 한다.
   실패·proof 부재는 명시적으로 거부하며 실제 성공으로 바꾸지 않는다.
5. 공유 `createV2DeletionRepository.account`의 직접 user DELETE 경로도 exact
   account-type cleanup을 적용하거나 담당 atomic deletion service를 재사용.
6. old arbitrary probe runtime ID는 Workflow not-found만으로 실제 stop을
   추정하지 않는다. 기존 coordinator stop receipt가 없으면 pending 유지.

## 남은 외부 gate

P0.3/#70/#71, production Environment/정책/공개 승인 gate는 유지한다.
실제 R2/Containers/Whisper·원격 delete/restore drill 및 실제 청구 정산은
승인된 자원/비용 범위에서 4번 배포 검증으로 인계한다.

restore drill은 legacy journal만으로 완료할 수 없다. post-backup v2 journal,
opaque blob/runtime targets, stop receipts와 capacity inventory도 보존·재적용하고
late writer의 stop 및 negative HEAD를 확인해야 한다. 누락/불명확한 runtime이나
부분 실패를 clean/deleted 성공으로 기록하지 않는다. 실제 외부 smoke가 남으므로
기능 PR은 `Refs`를 사용하며 담당 이슈를 닫지 않는다.

## 로컬 검증

### 2026-10-14 업로드 통합 후보 (#230 → #229)

#230의 bounded admission/trigger 보완을 먼저 main에 병합했다. 기존 `0010`은
변경하지 않았다. #229를 그 위에 rebase하면서 원본의 reservation 합계를
`live_blob_bytes`와 현재 blob PK 조회로 대체했다. 실제 D1의 expression depth
오류는 비용 조건을 모두 보존한 균형 AND와 materialized claim으로 수정했다.
writer 정지 성공 여부는 trigger의 `meta.changes` 대신 own-statement RETURNING으로
판단한다. fixture는 최초 proof를 projection 전에 만들고 파생 원장을 직접 복사하지 않는다.

- 관련 7개 파일: **143 tests / 2499 assertions**, 실패 0.
- 서명된 전역 API + 실제 workerd D1 + 합성 PDF/R2: 인증부터 PUT/writer 종료까지
  **76 statements / 460 rows read / 71 rows written**. 예약 5 SKU 및 멱등 재시도,
  환경이 다른 proof 거부, 암호문 복호화 일치를 검증했다. 작은 합성 파일의 측정이다.
- #230의 100/10,000개 합성 원장 비교는 admission read 13, binding read 30/write 13으로
  같았다. 원본 claim도 과거 blob 전체 합계에 의존하지 않는다.
- 실패 cleanup 6문장과 원장 통지 10문장은 정상 슬롯에서 미리 분리한다.
  고정 production 구성의 통지는 SQL 0건이며 미정산 비용은 예약으로 보존한다.
  미래 metering 포트를 추가할 때는 global freeze까지 별도 비용 검증이 필요하다.

합성 실측은 공급자 청구 정산이나 원격 최대 파일/Container 성공 증거가 아니다.
변호사 자산·공개 복사는 기존 필수 paid/physical admission을 유지하며 가격·용량
proof가 없는 원격 경로를 성공으로 표시하지 않는다. 최종 후보의 전체 회귀 및 같은
SHA의 preview/production 제한 인수는 #19/#57/#58/#71에 남는다.

최종 명령 결과와 exact-head CI는 기능 PR 및 담당 이슈 댓글에 연결한다.
같은 checkout의 browser/dev/build 검사는 순차 실행한다. 모든 입력은 합성이다.
검증 산출물은 ignored `.wrangler`/`test-results`에 두며 민감 원문·secret을 게시하지 않는다.

2026-10-07 로컬: frozen install, 전체 check **1253 tests / 133269 assertions**,
drift 없음 및 fresh/upgrade **6 tests / 29 assertions** 통과.
owned reports browser 6, 실제 SQL 다운로드 1, shared mock 통합 1,
독립 peer-account report 회귀 1이 통과했다.

- `bun ci`, `bun run check` (docs/work/boundaries/lint/type/unit/migration)
- `bun run build`, `bun run cf:dry-run`, production build 및 bundle 검사
- owned reports browser, 실제 SQL 다운로드 browser, shared mock report flow,
  독립 peer-account report 회귀
- native PCM fixture 및 CI의 Linux isolated media fixture
- `bun test ./tests/independent-review/account-metadata.repro.ts -t 'real account deletion'`
  (같은 파일의 옛 unmounted-route 기록 검사는 route 구현 인수 조건으로 사용하지 않음)

설정 재인증 race 회귀: 지연 접근 실패 및 지연 OAuth 실패를 화면 전환 뒤 전달하는
새 browser2개는 이전 코드에서 모두 실패하고, 수정 후 기존 보호 조건과 함께
3회 반복 **15 PASS**다. bfcache 복귀는 이전 확인 modal/DELETE 입력을 지우고 상태를 다시 검증하며 오래된 callback으로
삭제를 승인하지 않는다. 로컬 실제 HTTP/합성 OAuth adapter 증거이며 외부 OAuth
성공으로 표현하지 않는다.

CI의 cold load keyboard 회귀는 초기 disabled delete만 보고 재인증 버튼의
로딩 완료를 기다리지 않던 검사를 수정했다. 실제 auth 버튼 enabled와 OAuth
요청 도착을 확인한 뒤 keyboard Enter를 수행하며 newer callback/owner/DELETE
보호를 유지한다. timeout 확대나 오래된 callback 허용으로 통과시키지 않는다.
