# v2 HTTP API 목표 계약

- Status: Target contract; no endpoints are claimed implemented here
- Shared authority: [v2 실행 계약](./V2-CONTRACTS.md), [데이터 모델](./DATA-MODEL.md)
- Base: `/api/v2`; strict versioned schemas in `src/contracts/` after the contract issue merges

기존 `/api`의 v1 계약·OAuth handler·동의·삭제를 유지한다. API namespace는 화면 URL과 별개다.
private 응답은 `Cache-Control: private, no-store`를 적용한다. 공통 오류·request ID·origin·
idempotency와 타인/없는 사건의 동일 404는 [HTTP API](./HTTP-API.md)를 따른다. 현재 production
gate를 먼저 통과해야 하며 이 문서가 gate를 변경하지 않는다. 공개 목록의 비로그인 허용은
공개 전환이 완료된 뒤 적용한다. 서버는 역할과 권한을 확인하며 화면 숨김만으로 보호하지 않는다.

v2 activation 이후 신규 생성은 `/api/v2/cases`로 통합하고 legacy `POST /api/cases` 신규
admission은 version capability로 닫거나 같은 하루3개 counter에 묶는다. 이전10회 계약은
역사적v1 evidence이며 10+3 신규 allowance가 아니다. legacy active answers/retry를 유지하되
모델 비용/가시 응답 quota는 v2의 공통 ledger를 거쳐 bypass를 막는다. cutover 당일
이미 admitted된 신규 사건까지 KST count에 반영한다.

## 요청·동시성 공통 규칙

JSON body 상한은 64KiB다. 사건 서술은 20~5,000 Unicode code points, 답변은 1~1,000,
채팅 text는 1~10,000이며 unknown/skipped는 값이 없다. 질문은 서버 ID/형식/선택지에 연결한다.
출력 목록은 cursor 기본20/최대50, bounded 배열과 enum을 strict Zod로 검증한다. 대형 파일은
별도 part endpoint를 사용한다. 제한은 실제 서버 검증과 오류 UI가 있어야 계약 완료다.

변경 요청은 `Idempotency-Key`와 적용 대상 `expectedRevision`을 요구한다. 같은 업무 body의
재전송은 기존 결과, 다른 body는409다. 오래된 revision은409이며 최신 상태를 재조회해 사용자가
자신의 수정과 병합한다. 변경 중 UI를 무조건 덮어쓰지 않는다. job 생성은 reservation·outbox·
idempotency를 동일 guarded batch로 승인한다. 202에는 `{operationId,jobId,status,retryAfter}`만
있고 실제 완료 상태는 read endpoint에서 확인한다. async polling은 Retry-After/backoff를 따르고
숨긴 탭에서 중지하며 재접속에서 다시 정본을 조회한다.

## 공개 변호사 탐색

| Method/path | 입력·응답 | Gate |
| --- | --- | --- |
| `GET /lawyers` | 선택 지역·분야·cursor → approved revision의 card, 객관적 필터, 회전 설명, nextCursor | 비로그인. raw 사건 입력·맞춤 순위 파라미터 거부 |
| `GET /lawyers/:lawyerId` | 승인된 사진·소개·사무실·연락·portfolio·확인 표시 | 승인/비공개 상태 검사, draft/rejection 문구 없음 |
| `GET /lawyers/:lawyerId/portfolio/:assetId` | 승인 revision이 참조하는 안전한 public derivative | 버킷 object 이름으로 revision 검증 우회 금지 |
| `POST /lawyers/:lawyerId/reports` | bounded 신고 종류, 공개 revision reference | 로그인·abuse 제한. 사건 첨부/자유 사건 서술 없음 |

길찾기와 연락은 profile 응답의 검증된 주소·외부 링크에서 client가 선택한다. navigation 요청에
사건 ID·원문을 보내지 않는다. 연락 클릭을 실제 상담/계약 체결로 기록하지 않는다. 삭제/철회
된 프로필은 공개 pointer와 CDN을 제거하고 상세 API가 숨김 상태를 반환한다.

## 사건과 질문·채팅

| Method/path | 업무 계약 | Gate |
| --- | --- | --- |
| `POST /cases` | `{narrative,partyContext:"individual"|"company",jurisdiction:"KR",turnstileToken}` → intake workspace | 현재 동의·14세·일일3개·Turnstile |
| `GET /cases` | 자신의 v1/v2 목록, contractVersion, generic title, 상태·갱신일 | session·owner; 민감 원문을 card에서 추출하지 않음 |
| `GET /cases/:caseId/workspace` | revision, intake 상태, 확정 요약과 최신 작업 상태, quota 상태 | owner; v1은 명시적 legacy 응답 |
| `POST /cases/:caseId/upgrade` | v1 snapshot을 보존한 명시적 v2 시작 | owner·현재 동의. 자동 재분석/old result 교체 없음 |
| `GET /cases/:caseId/intake` | 저장된 질문 묶음·답변·진행 상태 | owner |
| `PUT /cases/:caseId/intake/answers` | partial 답변 저장, `{expectedRevision,answers}` | strict question IDs·answer types·CAS, 저장만으로 AI quota 없음 |
| `POST /cases/:caseId/intake/advance` | 현재 묶음 완료 확인 → 새 질문 또는 확인용 요약 job | 모든 질문 answered/unknown/skipped, AI operation admission |
| `PUT /cases/:caseId/summary` | `{expectedRevision,overview?,factEdits?:[{factId,text}],unknowns?}`의 typed patch | owner·revision·현재 fact ID. attribution/reference/확인 flag는 서버 정본이며 사용자 편집을 공식 자료 verified로 승격하지 않음 |
| `POST /cases/:caseId/summary/confirm` | `{expectedRevision,summaryRevision}` → active workspace | 최신 요약 확인, 늦은 job 결과를 확인한 것으로 취급하지 않음 |
| `GET /cases/:caseId/messages` | 안정 cursor의 user/검증된 assistant 메시지와 job 상태 | owner, raw unvalidated provider stream 없음 |
| `POST /cases/:caseId/messages` | `{expectedRevision,text,selectedFileIds}` → 저장 message+AI job | active·동의·선택자료 owner·AI quota·budget |
| `GET /cases/:caseId/timeline` | 원문 위치/진술 reference·불확실성·상충 표시 | owner |
| `PUT /cases/:caseId/timeline/:entryId` | 사용자 사실 수정·날짜 모름·source 구분 | owner·CAS, 원자료를 덮어쓰지 않음 |
| `GET /cases/:caseId/actions` | 안전한 행동·확인 목록, completed 상태 | owner |
| `PUT /cases/:caseId/actions/:actionId` | `{expectedRevision,status:"todo"|"done"|"skipped"}` | owner, 법률 판단/상대방 연락 자동 실행 없음 |
| `PUT /cases/:caseId/state` | archive/재개 | owner·CAS, archive는 삭제 아님 |
| `DELETE /cases/:caseId` | tombstone+primary 삭제, 후속 cleanup journal | owner, late job/download 폐기 |

## 파일·job·보고서

| Method/path | 업무 계약 | Gate |
| --- | --- | --- |
| `GET /cases/:caseId/files` | private metadata·처리 coverage·추출 revision | owner |
| `POST /cases/:caseId/files` | `{name,byteLength,mediaType,autoProcessConsentVersion}` → fileId/uploadSession/chunkBytes | owner·동의·count/storage 예약; client MIME/시간은 신뢰하지 않음 |
| `PUT /cases/:caseId/files/:fileId/parts/:partNumber` | bounded binary part, part hash/idempotency → accepted | session/origin/upload expiry·소유권·총 reserved bytes, chunk 암호화 후 R2 |
| `POST /cases/:caseId/files/:fileId/complete` | ordered manifest/총크기/hash 검증 → uploaded+처리 outbox | 실제 magic·size·PDF page·media duration 검사; 자동 처리 admission |
| `POST /cases/:caseId/files/:fileId/retry` | 같은 실패 operation 재시도 | alive reference·bounded attempt·실제 비용 예약, user quota 중복 없음 |
| `GET /cases/:caseId/files/:fileId/content` | 원본/허용된 derivative 선택·다운로드 | 매 요청 owner/tombstone 확인, no-store·attachment·안전 filename |
| `PUT /cases/:caseId/files/:fileId/observations` | 추출 내용 수정·제외·사용자 확인 | source position+revision을 보존, 원본 byte 수정 없음 |
| `DELETE /cases/:caseId/files/:fileId` | 접근 폐기·job 취소·모든 파생물/보고서 참조 정리 | owner·삭제 race 검증 |
| `GET /jobs/:jobId` | phase/progress bucket/coverage/failure enum/retry 가능 여부 | job의 사건/프로필 owner, internal key·signed URL·원문 없음 |
| `POST /cases/:caseId/reports` | `{expectedRevision,selectedFileIds,editedFields,maskingChoices,includeOriginals,reviewConfirmed:true}` → 고정 snapshot job. 원본 포함 시 `selectedOriginalFileIds` 부분집합과 `originalsUnmaskedAcknowledged:true` 필수 | owner·selected files 검증·storage/budget·자료 사전 검토. PDF 근거와 ZIP 선택 분리 |
| `GET /cases/:caseId/reports` | 버전·생성 시각·snapshot revision·obsolete 표시 | owner |
| `GET /cases/:caseId/reports/:reportId` | 사용자 검토용 본문·선택자료·마스킹/제외 내역 | owner |
| `GET /cases/:caseId/reports/:reportId/download?kind=pdf|originals` | 완료된 PDF 또는 선택 원본 ZIP | owner·tombstone·완료 상태 재확인, blob stream·no-store |
| `DELETE /cases/:caseId/reports/:reportId` | PDF/ZIP/편집 snapshot 정리 | owner |
| `GET /me/usage` | KST resetAt·잔여건수/분/bytes·대기 사유 | own account, 내부 provider/월 ledger 원문 없음 |

report 다운로드 URL을 public 공유 URL로 만들지 않는다. 명시적 공유 링크/변호사 자동 전송은
범위에 없다. signed URL이 필요해도 short-lived single-object 권한으로 제한하고 tombstone
직후 취소 가능성·캐시를 검증해야 한다. 초기 목표는 매 요청 owner를 확인하는 Worker 경유다.

## 변호사와 심사

| Method/path | 업무 계약 | Gate |
| --- | --- | --- |
| `GET/POST /me/lawyer/application` | 본인·자격·사무실 정보, 신청/확인 상태 | 자신의 계정; 개인 프로필만 |
| `PUT /me/lawyer/application` | `{expectedRevision,content}`의 typed partial draft 저장; 불완전한 office/빈 asset 목록 허용 | 자신의 계정·CAS. 제출은 완전한 신청과 ready private 자산을 따로 검증 |
| `POST/GET/DELETE /me/lawyer/verification-assets` | 인증 전용 private 파일·제출/철회 | applicant 또는 해당 심사 담당자만; 사건 파일 namespace 금지 |
| `GET/PUT /me/lawyer/profile` | draft·승인본·revision 조회/편집 | owner·CAS. approved revision을 직접 UPDATE하지 않음 |
| `POST/DELETE /me/lawyer/portfolio-assets` | text/image/PDF staging 처리/선택 제거 | owner, 공개 요청이 아닌 비공개 업로드 |
| `POST /me/lawyer/profile/submit` | 고정 revision의 심사 요청 | 본인/자격 확인 상태, safe staged assets, CAS |
| `POST /me/lawyer/profile/withdraw` | submitted 취소 또는 공개 철회 종류 구분 | owner·CAS, 승인 race와 public purge |
| `GET /moderation/applications` | 자격 확인 대기·허용된 인증자료 | 서버 moderator role |
| `POST /moderation/applications/:id/decision` | approved/rejected, bounded reason·확인 checklist | moderator·최근 OAuth·자기 승인 금지·revision |
| `GET /moderation/profile-revisions` | 공개 승인본과 제출본 차이·safe preview | moderator, private 사건 link 없음 |
| `POST /moderation/profile-revisions/:id/decision` | approved/rejected, 사실 확인·광고 기준 검토 | moderator·최근 OAuth·CAS, 승인 transaction만 public pointer/게시 outbox 변경 |
| `GET/PUT /moderation/reports` | 신고 접수·처리 상태 | moderator, 허용된 공개 대상만 |
| `GET /moderation/operations` | 비민감 queue·quota/budget 상태 | moderator; case plaintext/source download API 없음 |

private 인증 파일과 portfolio upload도 count/size/위험 파일 제한·계정 storage 예약을 적용한다.
역할 부여/철회는 운영 기록이 필요하며 첫 심사자 provisioning은 검증된 계정 ID에만 수행한다.
테스트 역할 seed는 preview 전용이고 production bundle에 포함하지 않는다.

## 오류·완료 판정

공통 code에는 `STALE_REVISION`, `UPLOAD_LIMIT`, `FILE_REJECTED`, `FILE_PROCESSING_FAILED`,
`USER_QUOTA_EXCEEDED`, `BUDGET_UNAVAILABLE`, `ROLE_REQUIRED`, `REVIEW_REQUIRED`처럼 고정
allowlist를 추가한다. parser·converter stack·provider 응답·실제 credential은 details에 담지
않는다. retry 가능/대기 resetAt/사용자 조치만 공개한다. 동일 이슈에서 strict schema·SQL권한·
실제 UI 오류 복구를 검증한다. 문서 endpoint table이나 mocked E2E만으로 실제 구현 완료를
주장하지 않으며 [시연 증거](../quality/V2-UI-EVIDENCE.md)를 충족한다.
