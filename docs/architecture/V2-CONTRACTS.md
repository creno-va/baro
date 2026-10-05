# v2 사건 작업 공간·자료·중개 실행 계약

- Status: Accepted target specification; implementation and live evidence pending
- Reviewed: 2026-10-06
- Tracking: [#53](https://github.com/creno-va/baro/issues/53)
- Product authority: [PRD](../PRD.md), [MVP](../product/MVP-SPEC.md)
- Decisions: [ADR-0006](../adr/0006-continuous-case-workspace-and-navigation.md), [ADR-0007](../adr/0007-lawyer-directory-verification-and-moderation.md), [ADR-0008](../adr/0008-private-files-and-report-handoff.md), [ADR-0013](../adr/0013-resource-admission-and-budget.md)

이 문서는 새 제품의 구현 정본 목표다. 현재 `schemaVersion:"1"` 사건·단일 질문 묶음·일일
10회 분석 계약은 [v1 실행 계약](./DOMAIN-LIFECYCLE.md)으로 보존한다. 아래 경로·테이블·
binding은 이 문서 작성만으로 배포되거나 공유 Zod에 추가되지 않는다. 구현 이슈에서 계약,
fixture, migration, UI, 실제 외부 증거를 함께 완료한다. 승인된 설계와 공개 법률 승인은 별개다.

## 지원 범위와 역할

대한민국 법률이 적용되는 만 14세 이상 개인·기업 사건의 모든 법률 분야를 지원 대상으로
한다. 기업 사건도 작성 계정 하나가 소유하며 팀 초대·공유 권한은 만들지 않는다. 모든 분야의
법률 결론을 자동 보장한다는 뜻은 아니다. 모르는 분야와 근거 공백은 질문·불확실성으로 남긴다.
긴급 신호는 공식 도움 경로를 우선 안내하고 안전하지 않은 행동 생성을 중단한다.

| 역할 | 읽기·변경 권한 | 금지 경계 |
| --- | --- | --- |
| 비로그인 | 공개 승인된 변호사 목록·프로필·포트폴리오·정책 | 사건·비공개 프로필 수정본·인증 서류 |
| 사용자 | 자신의 사건·자료·보고서·계정·동의 | 다른 작성자의 사건, 변호사 인증 서류 |
| 변호사 | 자신의 신청·인증 서류·프로필 revision·심사 상태 | 사용자가 다운로드한 사건의 자동 열람, 자기 승인 |
| 심사자 | 변호사 자격·사무실 확인, 공개 revision 심사, 신고·비민감 운영 상태 | 타인의 사건·채팅·사건 파일·보고서 복호화 |
| 처리 서비스 | 살아 있는 job의 제한된 원본/파생물 reference | 임의 사건 검색, 영구 키·전체 bucket 권한, 직접 모델·법률 호출 |

역할은 서버가 발급·검증한다. 변호사 가입은 즉시 verified 역할을 부여하지 않으며 심사자 역할은
일반 가입·클라이언트 입력으로 얻을 수 없다. 한 계정의 여러 역할도 사건 소유권 조건을 생략하지
않는다. 자신이 작성한 사건을 읽는 일반 사용자 권한과 심사 권한을 분리한다.

## 버전과 상태

`schemaVersion:"2"`의 사건은 `workspaceRevision`, `intakeRevision`, `confirmedSummaryRevision`,
`currentJobId`를 구분한다. job 결과가 오래돼도 이전 확정 보고서를 삭제하지 않으며 최신 입력과의
차이를 표시한다. 새 입력은 CAS로 revision을 증가시키고 각 job은 고정 snapshot을 처리한다.
v1 사건은 그대로 읽고 삭제할 수 있으며 자동 재분석·기존 결과 덮어쓰기는 하지 않는다.
v2 전환은 명시적 사용자 동작으로 기존 결과를 legacy snapshot으로 연결하는 additive 방식이다.

v2 activation 이후 새 사건은 v2로만 생성한다. legacy `POST /api/cases` 신규 admission은
version capability gate로 닫거나 동일 하루3개 counter를 사용해야 하며 v1의 역사적10회와
v2의3회를 합쳐 새 allowance를 만들지 않는다. 전환 당일 이미 생성한 사건도 같은 KST
counter에 반영한다. 기존 v1 읽기/답변/retry/삭제는 유지하며 legacy 모델 attempt도 같은
월 global budget ledger와 논리 AI 응답 quota에 묶어 비용 우회 경로를 만들지 않는다.

| 정본 | 상태 | 전이 규칙 |
| --- | --- | --- |
| workspace | `intake`, `active`, `archived` | 요약 확인 후 active, archive/재개는 소유자 동작. 삭제는 tombstone+물리 정리 |
| intake | `collecting`, `generating_questions`, `reviewing_summary`, `confirmed` | 답변·수정 때 revision 증가. unknown/skipped는 확정 사실로 바뀌지 않음 |
| job | `queued`, `running`, `validating`, `completed`, `failed`, `cancelled`, `superseded` | 완료는 job 단위이며 workspace/채팅을 종료하지 않음 |
| file | `reserved`, `uploading`, `uploaded`, `queued`, `processing`, `ready`, `failed`, `deleting` | upload 완료·실제 크기/형식 검증 후 자동 처리. 부분 업로드는 자료로 노출하지 않음 |
| report | `queued`, `building`, `ready`, `failed`, `obsolete` | snapshot·선택 자료·편집 내역을 고정. 새 사실은 기존 PDF를 바꾸지 않음 |
| profile revision | `draft`, `submitted`, `approved`, `rejected`, `withdrawn` | submitted는 고정. 승인 transaction만 public pointer 변경 |

같은 workspace에 상태 변경을 하는 AI job은 하나의 lease/CAS를 사용한다. 자료 추출은 별도
job으로 병렬 실행할 수 있지만 자료 revision을 확인한 뒤 반영한다. outbox에는 opaque ID·
revision·job kind만 저장한다. params/events/step 반환에 평문 사건·파일·보고서를 넣지 않는다.
네트워크 전달과 외부 과금의 exactly-once는 주장하지 않는다.

## 적응형 질문과 지속적인 채팅

초기 질문은 큰 틀에서 시작하고 답변에 따라 다음 묶음을 만든다. 기본은 3묶음, 묶음당 최대
5문항이며 5~10분 입력을 목표로 한다. 이는 v1의 누적 5문항 제한과 별도 계약이다. 반복되는
질문을 억제하고, 모름·건너뛰기·임시 저장·다른 기기 재접속을 지원한다. 한 묶음은 서버 생성
question ID와 답변 형식·선택지를 고정하며 답변은 `answered|unknown|skipped`로 저장한다.
중단은 draft를 실패/만료시키지 않는다. job lease 만료와 사용자 draft 보존을 구분한다.

기본 묶음 후 AI는 사용자 진술·자료 관찰·추정·불명확·상충 사실을 분리한 요약을 제시한다.
사용자가 수정하고 해당 `intakeRevision`을 확인해야 navigation이 시작된다. 추가 정보는 이후
채팅에서 수집할 수 있다. 요약 확인은 내용의 법적 진실성·진정성을 보증하는 서명이 아니다.

최초 서술은 `intake_narrative`와 해당 intake revision으로 참조하며 후속 답변·사용자 메시지와
구분한다. unknown/skipped 답변을 사실의 확정 근거로 사용하지 않는다. 요약 수정은 text/ID
patch로 받고 출처·확실성·userEdited 정본을 서버가 갱신한다. 사용자가 수정한 자료 사실이나
타임라인을 검증된 관찰로 승격하지 않는다. 전체 snapshot의 큰 배열은 암호화된 bounded
부분이나 paged 응답으로 보존하며 단일 64KiB JSON 쓰기에 맞추려고 내용을 생략하지 않는다.

채팅 message는 user/assistant, operation ID, revision, 안전 상태와 근거 reference를 가진다.
검증 전 모델 token을 곧바로 확정 법률 답변처럼 노출하지 않고 진행 상태를 표시한 뒤 검증된
응답을 저장·노출한다. 사실 변경은 타임라인·행동·보고서에 미치는 차이를 표시하며 확인 없이
추정 사실을 확정하지 않는다. 유리한 사실과 불리한 사실을 모두 보존한다.

행동은 증거 보존, 사실 확인, 자료 정리, 공식 안내 확인처럼 검토된 범주만 허용한다.
새 법적 결론·협상/소송 전략·기한 산정·결과 예측은 생성하지 않는다. 제3자에게 자동 연락하거나
자료를 제출하지 않는다. 변호사 연락 후에도 사실 정리와 보고서 갱신을 계속 제공한다.

## 저장·사용량·비용 admission

차감/반환·논리 작업·실제 시도·삭제 후 정산은 [사용량·비용 실행 정본](./DOMAIN-LIFECYCLE.md#v2-사용량과-비용),
quote/funding·환경별 할당과 안전한 전환은 [비용 운영 계약](../operations/COST-CONTROLS.md)을 따른다.

제품 MB/GB는 십진 byte(MB=1,000,000, GB=1,000,000,000)다. 플랫폼 MiB와 혼동하지 않는다.

| 범위 | 상한 | 검증 |
| --- | --- | --- |
| 사건 | 업로드 원본 100개, 원본 합계 5GB | 동시 pending 원본 업로드 예약 포함. 파생물·보고서는 사건 원본 5GB를 차감하지 않음 |
| 계정 | 저장 10GB | 모든 사건 원본·파생물·보고서·미완료 예약 합계 |
| 문서·이미지 | 원본당 100MB, PDF 500페이지 | MIME/magic 실제 형식·페이지 검증. 압축/디코딩 폭증 별도 제한 |
| 음성·영상 | 원본당 1GB, 재생 60분 | 서버 probe로 실제 시간 검증. 없는 duration을 0으로 간주하지 않음 |
| KST 하루 | 신규 사건 3개, AI 응답 30회, media 60분 | 사용자별 원자적 reservation, KST 자정 초기화, 병렬 경계 검사 |
| KST 월 기술 예산 | 총 1,000,000원 | 모델·ASR·Containers·저장·요청·기존 고정비, 예약과 불명확 과금 포함 |

사건의 원본 5GB와 계정의 전체 저장 10GB는 별도 counter다. 파생물·PDF·ZIP은 계정
10GB와 job별 처리/disk/출력 예약에 포함한다. 원본이 사건 상한 안에 있다는 이유로 무제한
파생물 생성을 허용하지 않으며, 파생물 때문에 사건 원본 allowance를 임의로 줄이지 않는다.

AI 응답 1회는 한 논리 operation의 사용자에게 표시되는 질문 묶음·요약·채팅 응답·AI 자료
해석을 뜻한다. 내부 교정·retry는 같은 operation으로 user quota를 다시 차감하지 않는다.
PDF의 동일 snapshot 재다운로드와 단순 텍스트 추출은 AI 응답이 아니다. media는 음성·영상의
실제 원본 재생시간을 첫 처리 admission에 예약하며 같은 operation의 retry는 중복 차감하지
않는다. 이미 분석한 자료를 새 revision으로 다시 해석하는 별도 사용자 요청은 새 operation이다.

모든 외부 시도는 별도 attempt ledger에 실제/추정 비용을 기록한다.
한 논리 operation 안의 여러 모델 단계·frame 호출은 각각 `invocationId`를 갖고 retry ordinal은
그 invocation 안에서만 증가한다. 사용자 응답 한도와 별개로 모든 실제 외부 시도의 비용을
보존한다. 금액은 안전한 정수 KRW로 기록하고 실제 초과 청구도 삭제하지 않는다.

외부 성공 이후 crash로 비용이 불명확하면 예약을 해제해 무료로 취급하지 않는다.
견적은 조회한 공급자 가격·환율·
검토 시각·안전 여유를 버전으로 남기고 명세에 변동 가격을 영구 상수처럼 고정하지 않는다.
원자적 global reservation으로 예상 사용액+미확정 비용+고정비가 월 상한을 넘으면 새 유료
작업을 대기/거부한다. quota 대기는 사유·재개 조건을 UI에 표시하며 실행 직전 다시 admission한다.
cutover 당일의 기존 v1 생성분이나 저장량 재대조로 상한을 넘은 관측치도 사용량 snapshot에
보존한다. 잔여량은 `max(0,limit-used-reserved)`이며 초과 관측치를 지우거나 한도를 높이지
않는다. 관측 snapshot 검증과 새 작업의 원자적 admission은 별도다.
예약 만료·취소·실패 후 원본/파생물 정리와 사용량 반환은 실제 보관 상태에 따라 멱등 처리한다.
완료 자료와 이미 생성된 내보내기 읽기·다운로드·삭제는 AI 비용 제한이 걸려도 유지한다.
필수 읽기/삭제/정리에 필요한 기술비용도 월 기본 운영 여유로 예약한다. 새 유료 export
조립은 별도 비용 admission이 필요하다. 새 결제·자동 충전·예산 증액은
이 계약의 자동 동작이 아니다. 무료 공개 가입을 특정 모집 인원으로 제한하지 않는다.

## 자료·처리·리포트

지원 대상은 문서·이미지·음성·영상 전체 범주다. 필수 검증 corpus에는 PDF/TXT/DOCX/HWP/HWPX,
XLSX/PPTX, 스캔 이미지, 한국어 음성, 음성 포함/무음 영상과 legacy office 변환을 포함한다.
UI는 실제 검증한 형식·암호 파일·손상 파일의 제한을 표시하고 지원하지 못하는 형식을 성공한
것처럼 처리하지 않는다. 한 분야/형식의 구현 공백은 마일스톤의 남은 항목으로 기록한다.

업로드 전 자동 처리·외부 AI 전송과 동의 버전을 고지한다. metadata reservation → bounded part
upload → 서버 원본 크기/hash/형식 확인 → 원본 완료 → 처리 outbox를 잇는다. 요청 한 번에 1GB를
Worker 메모리로 읽지 않는다. 초기 구현의 part 본문 상한은 8MiB이며 일반 JSON 64KiB gate와
별도 경로로 검증한다. owner/session/origin/part index/총 byte를 매 요청 확인한다.
R2 key는 opaque 식별자이며 파일명·사건 제목·사용자 이메일을 포함하지 않는다.

사건 원본·파생물·PDF·ZIP은 private R2에서 application encryption을 적용한다. 작은 텍스트는
기존 envelope를 유지하고 대형 blob은 별도 버전의 chunked AEAD를 사용한다. 파일별 무작위
data key를 환경 key로 wrap하고 part마다 고유 IV와 owner/file/revision/index/byte-length AAD를
검증한다. upload gateway가 bounded part를 암호화한 뒤 저장하고 Container는 제한된 job
reference로만 복호화한다. format/order/truncation/교체 공격을 검증한 manifest가 있어야 ready다.
R2의 플랫폼 암호화를 application encryption 또는 최종 삭제 증거로 대신하지 않는다.

문서는 페이지/표/문단 좌표, 음성은 시간 구간, 영상은 시간+frame 위치를 결과에 연결한다.
영상은 전체 음성 전사, 매 1초 frame과 장면 전환 frame을 처리 대상으로 한다. 누락 구간·
무음·화질 문제·부분 실패·처리 시간 범위를 manifest와 UI에 표시한다. 모든 frame 판독 또는
증거 진정성 확인을 주장하지 않는다. 60분 영상의 표본 전체가 처리되지 않았다면 complete를
주장하지 않고 coverage gap과 재시도 상태를 남긴다.

PDF 근거용 `selectedFileIds`와 ZIP 원본용 `selectedOriginalFileIds`는 분리하며 후자는 전자의
부분집합이다. 민감 원본을 ZIP에서 제외해도 PDF의 해당 자료 근거를 유지할 수 있다.

리포트는 요약·당사자 역할·타임라인·자료 목록/근거 위치·확인 필요·상충 및 불리한 사실·
준비한 행동·변호사에게 묻고 싶은 사항·공식 인용·생성일/버전을 포함한다. 사용자 진술과 AI
정리를 구분한다. 내보내기 전 이름/식별정보 유지가 기본이며 사용자가 편집·마스킹·제외를
검토한다. 표시용 마스킹을 선택 원본 파일의 실제 byte 삭제로 오해하지 않도록 고지하고,
민감 원본은 원본 패키지에서 제외하거나 검증된 별도 가공본을 선택하도록 한다.

원본 ZIP은 사용자가 선택한 파일만 넣고 원본 byte/hash를 유지한다. PDF+ZIP의 file manifest는
고정 snapshot과 선택 목록에 묶는다. 한글 Pretendard 폰트 포함/라이선스·쪽 나눔·긴 표·원문
내용을 실제 파일에서 검증한다. 외부 변호사에게는 사용자가 직접 전달하며 자동 전송/수신
추적/사건 접근 권한 부여는 없다. 사실 위주 PDF는 공식 출처 장애 중에도 생성할 수 있지만
검증되지 않은 법률 설명은 제거하고 확인 불가와 근거 공백을 표시한다.

## 변호사 인증·공개 revision·연락

개별 변호사가 본인/자격/사무실 정보를 신청하고 사람이 확인한다. 공개 사진·이름·소개·
사무실 주소·길찾기·전화/이메일/상담 링크·portfolio(text/image/PDF)를 갖는다. 자격 확인
문서와 공개 portfolio는 별도 종류·권한이다. 모든 공개 수정은 재심사한다. 승인된 revision은
새 submitted/draft가 있어도 계속 정본이며 승인 CAS가 성공해야 공개 pointer가 바뀐다.
자기 승인·역할 위조·동시 승인/반려·철회 후 늦은 승인·미승인 파일 접근을 막는다.

portfolio 공개본은 비공개 staging에서 안전화·심사 후 별도 public R2로 복사한다. 실제 사건
식별정보·초상·허위/과장·금지 광고 검토가 필요하며 공개 승인 사실을 자동 생성하지 않는다.
SVG/HTML/활성 PDF·외부 URL redirect는 검사하고 사용자 파일을 서비스 origin에서 실행하지 않는다.
권한 없는 revision과 인증 문서는 cache/CDN에 공개하지 않는다. 반려 이유와 확인 기록은
관련 변호사·심사자에게만 보인다. 철회/삭제 시 public pointer와 CDN purge까지 확인한다.

목록은 사용자가 직접 선택한 분야·지역 등 객관적 조건으로 필터한다. 투명하게 고지한
회전 순서와 pagination snapshot을 사용하며 동일 탐색 중 순서가 바뀌어 중복/누락되지 않게
한다. paid priority, AI fit score, 사건 본문/채팅 기반 순위, 후기 점수는 생성하지 않는다.
등록된 변호사가 없는 분야/지역은 실제 부족 상태로 표시한다. 네이버/카카오/Google 길찾기와
외부 연락 링크에는 사무실 공개 정보만 전달하고 사건 내용은 넣지 않는다.

## 삭제·복구와 완료 증거

사건/파일/계정 삭제 admission에서 tombstone과 job 취소·권한 폐기를 먼저 기록한다. 진행 중
upload·Container·모델·report가 늦게 끝나도 reference/revision/tombstone 조건으로 쓰기를
거부한다. 후속 cleanup은 원본·모든 파생물·AI message·summary·report·ZIP·부분 업로드·
job/Workflow/Container 상태를 제거한다. 정리 실패는 pending으로 남고 비민감 alert를 보낸다.

backup 복구는 traffic과 job 실행을 닫은 채 별도 보관된 deletion journal을 먼저 적용하고
D1와 R2 manifest/object·public pointer·cached 공개물을 대조한다. 삭제된 reference는 다시
다운로드/복호화하지 못하고 정리 대상 object를 재삭제한다. 원본 shadow copy·Container disk
snapshot·숨은 plaintext export를 만들지 않는다. journal은 삭제 전 개인정보를 복원할 수
없는 opaque target/object reference와 처리 상태만 보존한다. 실제 retention/rotation/drill은
운영 증거가 필요하며 문서의 목표를 완료로 취급하지 않는다.

전체 기능의 UI/파일/실제 외부 증거는 [v2 시연 증거](../quality/V2-UI-EVIDENCE.md)에 기록한다.
새 계약·migration 검증, v1 upgrade/read/delete 회귀, 다중 역할·비밀자료 차단을 함께 통과해야
한다. P0.3 외부/정책 승인과 새 서비스 공개 근거를 별도로 확인하며 건강 상태 200이나 화면
스크린샷만으로 실제 모델·공개 승인·삭제 완료를 주장하지 않는다.
