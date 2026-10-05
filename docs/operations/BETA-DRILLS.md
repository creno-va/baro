# P0.3 격리 복구·rollback·경보 절차

상태: #19의 독립 계약/runbook 준비. #27 미완료로 제품 관측성·full-product smoke·trusted receipt resolver 통합은 시작하지 않았다. 실제 platform drill 성공 run URL은 없다.

## 실행 전 자원 확인

기존 production 및 일반 preview D1을 복구 대상으로 쓰지 않는다. 담당자가 지정한 합성 전용 D1/Worker/Workflow, 기존 비용 한도, 삭제 journal의 DB 밖 보관 위치, 키 복구 관리자, 기준 Worker version ID, 테스트 경보 수신처·발송 권한을 먼저 확인한다. 복구 중 ingress와 cron/dispatch를 모두 중단한다. journal에는 원문 shadow copy 없이 opaque 삭제 식별자만 보관한다.

## D1 복구와 삭제 재적용

1. 정확한 candidate SHA를 격리 Worker에 배포한다. build/dry-run 성공 후 additive migration을 적용한다. fresh/upgrade fixture와 FK 검증을 먼저 통과시킨다.
2. 합성 소유자 둘의 암호화 사건·세션을 만들고 baseline bookmark를 기록한다. 하나를 삭제하여 모든 세션 revoke 및 journal 기록을 검증한다. 기존 [journal export/prepare/replay 명령](./DELETION-RESTORE.md)으로 최신 opaque journal을 DB 밖의 접근 제한 저장소에 보관한다.
3. Wrangler 4.147의 읽기 전용 `bunx wrangler d1 time-travel info <ISOLATED_DATABASE>`로 bookmark를 확인한다. 허용된 격리 DB만 `bunx wrangler d1 time-travel restore <ISOLATED_DATABASE> --bookmark <BASELINE_BOOKMARK>`로 복구한다. restore는 in-place이며 `--remote` 옵션을 붙이지 않는다. 출력은 비공개 보관하고 SQL/세션/원문은 artifact에 남기지 않는다.
4. **서비스 재개 전에** 최신 외부 journal을 검증·준비하고 `replayDeletionJournal`을 적용한다. target user/case/analysis/세션이 0이고 cleanup job이 다시 pending인지를 확인한다. 다른 소유자 데이터·FK·복호화·migration 상태는 유지되어야 한다. 공유 scheduler를 bounded 실행해 active/completed Workflow 삭제, late dispatch/checkpoint race, retry budget과 실패 보존을 확인한다.
5. DB 밖 journal이 누락되었거나 replay/키 복구/cleanup이 실패하면 트래픽을 재개하지 않는다. 최소 식별자·상태·candidate SHA·bookmark의 해시·검증 결과만 run artifact에 남긴다.

D1 Time Travel은 paid 30일/free 7일이며 실제 account plan 확인이 필요하다. journal 목표35일은 플랫폼 backup 35일 보장이 아니다. 복구는 fork/clone이 아닌 DB 덮어쓰기이므로 격리 자원 검증이 필수다.

## Worker rollback

격리 Worker의 이전 안정 version ID와 해당 release SHA를 확인한다. `bunx wrangler rollback <ISOLATED_VERSION_ID> --name <ISOLATED_WORKER> --message beta-drill --yes`를 실행한다. health/ready release가 이전 SHA로 바뀌고 additive schema와 양립하는지 검증한다. Worker rollback은 DB migration을 되돌리지 않는다. 복구 시 journal 재적용 규칙을 유지한다. 실패·복원 결과를 같은 candidate의 drill receipt로 연결한다.

## 경보 계약과 발송 drill

`scripts/alert-contract.ts`는 test=true, isolated-test, release SHA, 시각, 고정 event/errorCode, synthetic request ID, 고정 runbook URL만 허용한다. body/prompt/token/cookie/SQL/stack/이메일/IP/인증 URL 또는 production payload는 거부한다. transport는 연결하지 않았다.

지정 테스트 수신처와 발송 권한을 확인한 뒤 격리 환경에서 삭제 cleanup 실패·암호화 실패·citation 거부·Workflow timeout을 유발한다. 허용 payload만 한 번 전송하고 수신·ack·복구·중복 억제를 검증한다. 권한 확인 전 외부 발송을 하지 않는다.

## Candidate 증거 계약

`scripts/release-candidate.ts`의 독립 계약은 full SHA, 10개 고유 gate, mode/environment, run ID와 artifact hash를 요구한다. trusted resolver가 run 완료/success/SHA/hash/gate/critical-zero를 검증해야 하며 이전 SHA·수동 boolean·중복 gate·deterministic 결과로 live-model 대체·critical 한 건을 거부한다. 테스트의 fabricated receipt는 contract 검증용이다.

현재 `scripts/check-release.ts`의 legacy boolean 검사에는 이 계약이 아직 연결되지 않았다. #27 완료 후 #19에서 trusted GitHub/platform/policy receipt resolver와 실제 deployment gate를 통합해야 한다. 과거 `offlineEvidence`나 수동 true로 신규 candidate 공개를 허용하면 안 된다. 공개 정책 승인은 별도 human receipt와 문서/동의 버전 일치를 요구한다. 모든 external check는 false, reviewedAt은 null이며 production 공개는 닫혀 있다.

검증 명령: `bun test tests/release-candidate.test.ts tests/alert-contract.test.ts`, `bun run check`, `bun run build`, `bun run cf:dry-run`. 실제 외부 실행 뒤 candidate SHA, CI/preview/full-product smoke/live eval/drill의 immutable run URL과 artifact hash를 함께 기록한다.

공식 근거: [D1 복구](https://developers.cloudflare.com/d1/reference/time-travel/), [Wrangler rollback](https://developers.cloudflare.com/workers/wrangler/commands/#rollback), [Workflow Worker API](https://developers.cloudflare.com/workflows/build/workers-api/).

## v2 격리 drill 목표 (#71)

#53의 아래 계획은 실제 실행 성공 증거가 아니다. P0.3 #19/#27의 dependency와 기존 증거를
보존하고 v2 R2·Container·role·budget 범위를 추가한다. 자원 생성/실제 비용은 월100만 원
승인 범위에서 가능하지만 production/일반 preview DB 덮어쓰기는 이 drill에 포함하지 않는다.

먼저 allowlist 자원 등록부로 계정·D1 ID/이름·private/public R2·Worker/Workflow/DO/Container
이름·image digest·키 version·관리자를 확인한다. `baro-drill-*` 이름만 보고 격리를 추정하지 않는다.
실제 preview/production resource ID와 겹치면 중단한다. 독립 isolated journal manifest 계약은
현재 알려진 보호 DB ID의 대소문자 우회도 거부하지만 신규 보호 자원도 등록부에 반영해야 한다.
이 계약이 기존 CLI를 v2 restore 도구로 자동 전환하지 않는다.

| Drill | 안전한 수행 | 실제 완료 증거 |
| --- | --- | --- |
| 원격 삭제 | 두 합성 owner·원본/파생/PDF/ZIP·진행 job과 approved profile/public cache 생성 후 한 owner 삭제 | 남은 owner 보존, target 객체/세션/job/capability 접근 없음, cleanup 완료 |
| Late race | upload part·AI/Container 완료·export·심사 승인 응답을 삭제와 경쟁시킴 | primary/R2/public pointer 부활 없음, orphan 정리 |
| Restore | baseline bookmark 후 삭제, 최신 journal을 DB 밖 보관, ingress/cron/dispatch 중단 후 격리 restore | journal replay 전 재개 금지, FK0/대상0·정상 owner decrypt·R2 orphan/누락 처리 |
| Worker/Image rollback | 이전 검증 Worker version 및 Container digest로 복귀 | SHA/image/schema/key/manifest 양립, 진행 job 중복 실행·실제 비용 없음 |
| 알림 | cleanup/crypto/source/timeout/budget/role 실패를 제한적으로 발생 | strict metadata만 수신, ack·dedup·복구·미수신 실패 판정 |
| 비용 | 병렬 reservation·retry·unknown charge·월 경계·직전 상한을 테스트 | userquota 중복 차감 없음, actual비용 누락 없음, 초과 admission 닫힘 |

삭제 drill의 Container는 종료 여부와 temporary disk/재사용 instance 흔적을 확인한다. R2의
original/part/derived/export·public copy와 CDN cache를 검사한다. D1 restore 결과만으로 R2
삭제/복구도 성공했다고 쓰지 않는다. key recovery 관리자는 키 값 없이 version과 접근/복호화
결과만 기록하고 다른 환경 키를 복사하지 않는다.

Runtime alert 수신처·담당자·발송 권한·ack timeout을 실제 지정해야 한다. 테스트 계약은 event와
errorCode 조합 및 UUIDv4를 검사하고 unknown payload/production event를 거부한다. 외부
email/Slack 메시지는 명시적 발송 권한이 있을 때만 보낸다. 내부 테스트 receiver와 실제 on-call
수신을 구분하며 미수신/미ack는 실패다. 발송·ack·복구를 같은 drill receipt에 연결한다.

run evidence는 repo/workflow/event·candidate SHA·환경·image digest·artifact hash·완료/success·
각 check·critical-zero를 trusted resolver로 검증한다. human policy review는 검토자/범위/문서
hash/버전·공개 승인 근거를 별도로 연결한다. 수동 체크표/가짜 receipt/다른 SHA/과거 offline
50 fixture를 새 candidate의 live 결과로 쓰지 않는다. 실패·부분 완료·비용 unknown을 보존하고
기존 handle 상태를 재조회하며 timeout만으로 job을 새로 시작하지 않는다.

모든 drill 종료 후 합성 자료/임시 capability·test secret을 정리하고 자원 잔존·idle 비용을 확인한다.
재현에 필요한 image digest/config version과 비민감 결과만 남긴다. 공개 전환과 일반 사용자
실데이터 restore는 별도 승인된 운영 절차이며 이 문서의 시험 권한을 확대 해석하지 않는다.
