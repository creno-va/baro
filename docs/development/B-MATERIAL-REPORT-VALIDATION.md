# B: 자료 교정·리포트·삭제 계약과 검증

2026-10-09, #58 / #59 / #66 / #67. 기존 PR130의 저장소와 migration을 재사용한다.
A는 고객 Workspace/자료 client/types/auth/router/CI, C는 계획과 작업 그래프를 소유한다.

## A가 연결할 자료 API

기본 경로는 `/api/v2/cases/:caseId/files/:fileId`다. 인증된 고객/같은 사건 소유자만 접근한다.
모든 응답은 `private, no-store`다. 새 교정은 현재 필수 동의가 필요하다.

| 요청 | 입력 | 응답/행동 |
| --- | --- | --- |
| GET `/review?afterOrdinal=-1` | 다음 페이지는 응답의 `nextAfterOrdinal` | `file` metadata, `workspaceRevision`, 원래 `coverage`, `observations`, `nextAfterOrdinal`, `pendingReview`, `recovery` |
| PATCH `/observations` | `If-Match: workspaceRevision`, `Idempotency-Key`, 아래 JSON | 200 `ready` 또는 202 `saving`; 같은 key/body로 응답 유실 재시도 |
| POST `/observations/:reviewId/continue` | body/header 불필요, 같은 reviewId | 저장된 원래 revision에 대한 CAS. 200 `ready` 또는 202 `saving` |
| DELETE `/observations/:reviewId` | body 불필요 | 미공개 교정 폐기. 현재 게시된 자료는 유지. 재동의 전에도 허용 |

```json
{
  "expectedRevision": 3,
  "edits": [
    { "observationId": "observation-id", "text": "사용자가 교정한 문장", "included": true }
  ]
}
```

`expectedRevision`은 **file revision**, `If-Match`는 **workspace revision**이다.
각 observation은 `{ordinal,value,original}`이다. `value`와 `original`은 기존
`V2FileObservation`이며 페이지/문단/표 또는 음성·영상의 시간 위치를 그대로 반환한다.
`original`은 처음 게시된 추출·관찰, `value.userEdited`는 사용자 교정이다. 교정은
`certainty: uncertain`으로 저장하며 원문이나 처리 coverage의 성공 여부를 바꾸지 않는다.
`included:false`는 리포트에 관찰문을 포함하지 않겠다는 선택이다.

저장/재개 응답과 `pendingReview`는
`{reviewId,fileId,revision,workspaceRevision,status,completed,total}`이다.
GET의 pending status는 `saving` 또는 `conflict`다. 서버는 한번에 coverage fragment 하나와
관찰/파생물 각 최대 4개만 복사한다. 저장 중에는 이전 게시본을 읽는다. 30분 만료나 다른
사건 수정으로 원래 revision이 바뀌면 409 `STALE_REVISION`이다. 미공개 교정을 폐기하고
최신 자료를 다시 읽어 시작한다. 브라우저가 닫혀도 stage는 SQL에 남으므로 GET 후 재개한다.
완료 직후 같은 PATCH/continue 재시도는 같은 coverage pointer를 확인한다.

`recovery`는 `{code,message,actions}` 또는 null이다. 형식/만료는 파일 교체, 예산은 대기,
저장 공간은 정리, 복호화 실패는 교체/지원 문의, 누락은 원본 검토/재시도를 구분한다.
coverage는 raw 계약 그대로 반환하므로 미처리 페이지/구간을 성공으로 표시하지 않는다.

## 현재 사실과 리포트

A와 합의한 현재 사실/인물/요약의 정본은
`createV2WorkspaceRepository.readIntake().summary`와 `metadata().summary.revision`이다.
B는 현재 summary를 읽고, facts/parties ciphertext와 revision, 메시지, 자료 revision과 coverage,
타임라인, 행동, 공식 출처 상태를 source digest에 포함한다. report/export 저장도 workspace
revision을 올리므로 전체 숫자만으로 stale을 판단하지 않는다.

리포트 응답은 기존 DTO에 `basis: {workspaceRevision,summaryRevision,generatedAt}`와
`pdfAvailable`을 더한다. 기존 생성 snapshot과 교정본은 수정하지 않고 새 report revision을
저장한다. 자료 교정은 새 리포트의 관찰문·페이지/시간에 반영하며 이전 file revision을 인용한
사실/타임라인/행동은 최신 자료의 확인된 사실로 옮기지 않는다.

자료 제외 선택이 달라지면 서버는 선택된 출처로 본문을 다시 구성한다. 제외 자료의 문장이
이전 자유 편집 본문에 남지 않게 하며 이전 수동 편집은 기존 immutable report에 보존한다.
사용자는 재구성된 새 내용을 다시 검토한다. 원본 ZIP은 선택 파일만 포함하고 원본 byte를
마스킹하지 않는다. PDF의 자동 가림과 원본의 개인정보 확인은 별개다.

재동의 전 기존 자료/교정/리포트 조회, 원본과 이미 저장된 PDF 다운로드, 허용된 삭제를 유지한다.
새 처리·교정·report/PDF 빌드·ZIP 생성은 현재 동의가 필요하다. 저장 PDF는 source가 stale이어도
기존 생성 기준의 동일 byte를 읽으며 owner/role/report/blob/deletion을 매 stream 경계에서 확인한다.
아직 생성되지 않은 PDF와 새 ZIP은 최신 source digest와 동의 검사 후 생성한다.

## 검증 경계

`tests/files-review.test.ts`: 실제 SQLite/AES 기반 4개씩 페이지/저장, 9개 관찰 재접속,
응답 유실, 원문/교정 분리, 페이지 보존, 제외, signed-session HTTP, 교차 소유권/사건,
재동의 전 조회·원본·삭제, 교정 도중 동의 철회 CAS, 다른 사건 수정 충돌, file 삭제 cascade,
보관 account deletion journal의 복구 DB 재적용 및 반복 재적용을 확인한다.

`tests/reports-service.test.ts` / `tests/reports-api.test.ts`: 선택 원본 UTF-8 이름/byte,
PDF masking/자료 제외, immutable report, stale 저장 PDF 동일 byte, 새 동의 요구,
삭제 후 stream 차단을 검사한다. 기존 paid storage/resource/fence/deletion tests도 재사용한다.

최종 검사/브라우저/PDF 시각 검증 결과는 PR의 exact-head 검증 기록을 정본으로 삼는다.
모든 입력은 합성이다. 이 테스트의 R2 byte adapter와 SQL journal replay는 원격 Cloudflare
R2/Containers/Whisper/OAuth 성공이나 실제 backup 복구 drill 증거가 아니다.

## 아직 종료할 수 없는 조건

- 실제 R2 업로드/다운로드/삭제 및 원격 삭제 뒤 negative HEAD, 실패 후 재시도 증거.
- 실제 Containers/Whisper 결과·coverage·provider receipt·비용과 취소/늦은 응답 차단.
- 원격 backup 복구 시 별도 보관 v2 journal/inventory/runtime stop receipt 재적용 후 트래픽 재개.
- 실제 플랫폼 CPU/메모리/D1/R2 한도와 비용을 포함한 PDF/선택 ZIP 다운로드.
- P0.3 / #70 / #71의 정책·법률·production Environment·최초 공개 gate.

구현 PR은 Refs를 사용하고 이 조건들을 닫지 않는다. 새 migration/비용 선행 이슈는 없다.
