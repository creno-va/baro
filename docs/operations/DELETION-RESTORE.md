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
