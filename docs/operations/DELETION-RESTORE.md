# 삭제 journal과 복구 재적용

구현 #17, 실제 격리된 preview/test drill #19, 실제 plan/환경·키 #27, 보존 승인 #20.
목표 35일은 플랫폼 backup/Workflow 보존이나 법률 승인의 증거가 아니다.

## 온라인 삭제

DELETE /api/me는 Origin, signed SQL session, 실제 callback 인증 10분과 strict
`{confirmation:"DELETE"}`를 확인한다. batch 안에서도 세션 만료·폐기·인증 시각을 다시
확인하며 journal과 user cascade를 함께 commit한다. 필수 동의나 암호화 키가 없더라도
자신의 계정을 삭제할 수 있다. 202는 primary 삭제/모든 세션 폐기다. settings는 이 탭에서
시작한 동일 계정의 새로운 callback 후 DELETE 입력을 다시 요구한다. URL/새로고침으로
자동 제출하지 않는다. 선택 account_deleted 이벤트는 opt-in allowlist와 탭 저장소만 사용한다.

journal은 target ID/삭제 시각/모든 analysis retry ID/상태만 보존한다. 원문·인증 token·
이메일·암호문 shadow copy를 저장하지 않는다. 기존 case journal도 동일 cleanup을 쓴다.
scheduled reconciliation은 10 jobs × 10 instance 호출/cycle, 60초 CAS lease와 durable
cursor로 제한한다. chunk당 연속 실패/중단은 최대 8회, 1/2/4/8/15분 backoff다. 실패는
`deletion_cleanup_failed`/jobId/attempts만 기록하고 자동 재시도를 멈춘다. 담당자는 원인과
binding 접근을 해결한 후 해당 job만 pending/attempts=0으로 재개한다. 완료/만료 journal만
GC하며 미완료 journal을 목표 기간 경과만으로 지우지 않는다. 완료 후에도 journal 기간
안에서는 하루 간격으로 재검사하며 기간 종료 뒤 마지막 성공 sweep을 거쳐 GC한다.
따라서 지연된 platform 생성/응답을 한 번의 완료 표시로 영구 누락하지 않는다.

Workers binding의 instance.delete()를 호출해 active/completed 저장 상태를 제거한다.
문서화된 API와 SDK의 정확한 `instance.not_found`만 이미 없는 상태로 처리한다. 다른
오류는 보존/경보한다. 첫 sweep 후 16분에 재검사하고, dispatch의 외부 create 뒤 primary
가드 실패는 journal을 다시 pending으로 만든 뒤 즉시 instance.delete()한다. crash/원격 RPC
지연·플랫폼 오류 의미는 실제 #27/#19 drill에서 검증해야 한다. SQL guarded writes/FK는
늦은 응답·답변/retry/checkpoint/citation의 primary 부활을 차단한다.

- [Cloudflare Workflow instance delete](https://developers.cloudflare.com/workflows/build/workers-api/#delete)
- [Cloudflare 공식 SDK missing sentinel](https://github.com/cloudflare/workers-sdk/blob/main/packages/workflows-shared/src/binding.ts)

## Restore 전·후 절차

1. traffic과 cron/dispatch를 닫고 담당자, 환경, immutable SHA, bookmark와 키 ID를 기록한다.
   production 복구/rollback은 별도 승인 작업이며 이 도구가 수행하지 않는다.
2. **복구 대상 backup과 별도**로 최신 삭제 journal을 보관한다. restore 전 live journal을
   추출하고 checksum·대상 환경·기간 범위를 확인한다. 해당 backup 속 오래된 journal만
   사용하면 backup 이후 삭제를 누락하므로 서비스 재개를 금지한다.
3. 다음 읽기 전용 명령은 preview의 opaque journal만 ignored 파일에 저장한다. 파일은
   접근 통제된 운영 저장소로 이동해 backup과 별도로 보존한다. CI/GitHub artifact로 보내지 않는다.

```bash
bun scripts/deletion-journal.ts export-preview .wrangler/latest-deletion-journal.json
bun scripts/deletion-journal.ts prepare .wrangler/latest-deletion-journal.json .wrangler/replay.sql
```

4. #19/#27이 ready가 된 뒤 격리된 합성 test 자원에서 bookmark restore를 수행한다.
   준비된 replay 파일을 그 자원에서 적용하고 FK 위반=0, 모든 journal target의 primary
   row=0, 해당 owner session=0, 다른 합성 owner 보존을 검사한다. 이때 원문/SQL/키를 로그에
   남기지 않는다. 제품 `replayDeletionJournal`은 각 job의 journal 재등록과 삭제를 batch로
   처리한다. CLI prepare는 재적용 SQL을 생성하기만 하며 remote 적용/traffic 재개를 하지 않는다.
5. Workflow binding을 복구 환경에 맞추고 cleanup 완료 또는 실패 원인 해결을 확인한다.
   반복 replay에도 primary 데이터가 생기지 않아야 한다. 복호화/AAD/key 접근 확인 후에만
   traffic 재개를 승인한다. 상태를 boolean으로 수동 통과시키지 않는다.
6. evidence에는 합성 drill ID, 환경/SHA/bookmark, journal checksum/건수, pass/fail와
   run URL만 남긴다. 실제 plan 보존·법률 승인이 없는 동안 정책은 Draft를 유지한다.

## Offline 재현

```bash
bun test tests/account-deletion.test.ts tests/analysis-execution.test.ts tests/cases-api.test.ts
```

SQLite-backed D1 batch, 서명 세션, provider-exchange 대역을 통한 실제 callback route,
late create/응답, rollback, restore 뒤 별도 journal replay, failure budget을 검증한다.
이는 실제 OAuth/provider/platform 저장 상태 제거 또는 실제 bookmark restore 증거가 아니다.

## v2 사건·자료·프로필 삭제 목표 (#67/#71)

v1의 SQL/session/Workflow journal을 보존하고 additive하게 R2 객체/part·Container job·download
capability·리포트 version·public copy/cache까지 삭제 범위를 늘린다. 사건과 자료는 사용자가
삭제할 때까지 보관하되 삭제 후 primary 접근을 즉시 막고 원격 cleanup 완료를 추적한다.
202 접수/즉시 접근 차단과 모든 원격 객체·backup 범위의 처리 완료는 다른 상태다.

1. 현재 owner/role·Origin·최근 OAuth와 명시적 확인을 검증한다. 계정 삭제는 모든 세션을
   revoke한다. 자료 삭제는 해당 파일 revision과 파생물/리포트 의존 관계를 잠근다.
2. 동일 transaction에 opaque tombstone·job/객체 inventory와 현재 row 접근 철회를 기록한다.
   AI/chat/upload/processing/export/public revision의 기존 lease·capability를 무효화한다.
3. job abort→모든 original/part/derivative/PDF/ZIP·비공개 자격 자료→공개 copy·pointer/CDN purge
   순서와 재시도 cursor를 durable하게 관리한다. 어느 단계든 실패하면 tombstone을 유지한다.
   public page 철회는 원격 파일 cleanup이 끝날 때까지 기다리지 않고 즉시 수행한다.
4. 완료 뒤 늦게 도착한 업로드 part/Container result/AI 응답/리포트 생성/심사 승인이 삭제된
   owner/file/revision을 부활시키지 못하도록 commit 전에 tombstone을 다시 확인한다.
5. quota의 logical 예약을 해제해도 미삭제 R2·미종료 Container의 실제 비용을 지우지 않는다.
   content snapshot 없이 job/byte/상태·비용만 보존하고 단계를 완료 확인한 뒤 journal 정책을 적용한다.

계정 삭제는 개인 소유 사건·회사 사건(단일 작성자 계정)·messages/summary/actions/timeline·
파일/결과/리포트·변호사 초안/공개 자산·credential 자료·심사 입력도 정리한다. 필요한 법정
별도 보존은 항목/근거/기간을 human 검토로 확정하기 전 임의 설정하지 않는다. 삭제 journal에는
신분증/사건·키·원문 shadow copy를 넣지 않으며 opaque identifier도 가명정보로 취급한다.
이미 사용자가 다운로드하거나 변호사에게 외부 전달한 copy를 BARO가 원격 삭제할 수 있다고 약속하지 않는다.

## v2 D1/R2/Container 복구

D1 bookmark는 R2 원본·공개 자산·Container temporary disk나 암호화 키를 함께 복구하지 않는다.
DB와 별도로 접근 통제된 최신 삭제 journal/객체 inventory/키 복구 사본이 필요하다. R2 backup
정책과 사본 개수·보존·지역은 실제 설정/비용/정책 승인에 따라 확정하고, 아직 존재하지 않는
versioning이나 자동 snapshot을 복구 보장으로 쓰지 않는다. ephemeral 평문은 복구 대상으로 보존하지 않는다.

복구는 production/일반 preview 대신 [격리 drill 자원](./BETA-DRILLS.md)에서 먼저 검증한다.
DB restore 전 traffic/cron/dispatch/AI/file processing/public serving을 모두 닫는다. v2 최신
opaque journal을 검증하고 **재개 전에** 복구 DB에서 다시 적용해 primary·session·R2/public
pointer·job 상태를 제거한다. backup 이후에 생성되어 DB가 모르는 원격 객체는 inventory를
대조해 orphan으로 정리한다. backup이 R2에 존재하지 않는 파일을 가리키면 unavailable로
표시하고 가짜 정상/자동 과금 재분석으로 채우지 않는다.

키는 환경과 version을 유지한 복구 사본만 사용한다. v1 envelope와 v2 chunk manifest의
owner/file/revision/part AAD, key unwrap·decrypt, 부적절한 owner/순서/truncation 거부를 확인한다.
다른 합성 owner의 원본/리포트가 보존되고 target의 private/public 객체·capability·session·
Workflow/Container job이 모두 없어야 한다. public cache까지 삭제 상태를 확인한 뒤 재개한다.
journal 또는 키/객체 inventory가 누락되거나 cleanup/복호화/권한 검증이 실패하면 traffic을 닫은 채 유지한다.

기존 `deletion-journal.ts` CLI는 v1 preview export/SQL 준비 도구이며 v2 restore 실행기가 아니다.
독립 isolated manifest 계약은 환경/합성 전용 resource·candidate SHA·export window·SHA256·
중복/보존 구간을 검증한다. checksum은 integrity만 증명하며 실제 자원 격리·export provenance·
최신 삭제 포함 여부는 trusted configuration/실제 platform evidence로 추가 검증한다.

완료 증거에는 같은 SHA·환경·합성 fixture ID·단계별 pass/fail·개수·manifest checksum·run URL을
남긴다. opaque journal 원본/SQL·신분 자료·file hash/원문·key·signed URL을 GitHub artifact에 넣지 않는다.
