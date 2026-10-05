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
