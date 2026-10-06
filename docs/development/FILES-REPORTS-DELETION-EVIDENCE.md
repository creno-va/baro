# 자료·리포트·삭제 구현 검증

담당 이슈: #58, #59, #66, #67. 브랜치: `codex/58-files-reports-deletion`.
기준 main: `a5130db48d673d27ce1b928c255285e2cb680ca0` (PR #125 UI와 PR #127/#129 공유 경계 포함).
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
| #67 설정 | owner-tag 삭제 확인 header, 사용량/사건/계정 삭제 상태 및 확인 modal 정리. 다른 계정이나 reauthentication 실패 후 이전 usage/confirmation 제거. accepted 뒤에만 기존 비민감 session marker를 발행 | signed-session SQL 및 browser 회귀 |

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

최종 명령 결과와 exact-head CI는 기능 PR 및 담당 이슈 댓글에 연결한다.
같은 checkout의 browser/dev/build 검사는 순차 실행한다. 모든 입력은 합성이다.
검증 산출물은 ignored `.wrangler`/`test-results`에 두며 민감 원문·secret을 게시하지 않는다.

2026-10-07 로컬: frozen install, 전체 check **1230 tests / 132844 assertions**,
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
