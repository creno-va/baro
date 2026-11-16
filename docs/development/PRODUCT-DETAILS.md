# 사건 요약·자료·리포트 화면 이관

## 기준과 실제 범위

기준은 PR #813의 `8c642ea1dd157e83456314095251a8d58f9d4c38`이다.
`codex/baro-case-details-ui`는 선행 CI 성공을 확인한 별도 후속 UI 작업이다.
최종 검사와 한계는 [화면 검토 기록](../quality/product-details/README.md),
정확한 head·PR/CI 결과는 제출한 PR의 검증 탭에 남긴다. main 병합·배포 완료와 구분한다.

사용자가 선택한 대화 중심 + 사건별 자료·리포트 방향으로 사건 정리와 문서를 읽고 고치는 화면을
새 Tailwind 시각 tree와 Headless UI로 구성한다. 기존 entry의 props·exports·URL을 유지하고
업무 controller와 새 view를 분리한다. 외부 공급자·API·DB·모바일·랜딩은 변경하지 않는다.

| 실제 진입 | 새 화면과 조립 경계 |
| --- | --- |
| `/cases/:id/summary` | SummaryReview → SummaryReconfirmation facade → `product-ui/summary/SummaryReconfirmationView` |
| 대화 안 사건 정리 재확인 | 기존 ConversationReconfirmation host → 같은 새 Summary 뷰와 ContextReviewView |
| `/cases/:id/files`와 대화 자료 탭 | 기존 Workspace → 새 MaterialsPanelView. 업로드·원본 viewer는 기존 슬롯 |
| 대화 참고 패널 | CaseContextPanel facade → 새 CaseContextView. 명시적 탭 선택과 lazy 판례 진입 보존 |
| 자료 내용 확인·교정 | FileReview facade → 새 FileReviewView/ReviewObservation과 기존 처리 로직을 옮긴 controller |
| `/cases/:id/reports` | ReportReview facade → 새 ReportReviewView/ReportReading/SectionEditor. 기존 EvidenceUpload·FollowUpResolution을 소유자 조건 아래 슬롯으로 조립 |

관련 코드는 [summary](../../src/product-ui/summary/), [materials](../../src/product-ui/materials/),
[reports](../../src/product-ui/reports/)에 있다. 바깥 shell·탐색·composer·질문은 앞선
[shell](./PRODUCT-SHELL.md)과 [대화·질문 이관](./PRODUCT-CONVERSATION.md)을 사용한다.

## 화면과 입력 설계

- 사건 정리는 전체 내용·질문과 사실·출처·상반된 진술·불리한 사실·미확인 내용을 읽기 중심으로 배치한다.
  canonical 본문을 직접 덮어쓰는 입력란 대신 기존 자연어 변경 요청을 사용한다.
  변경안은 기존/제안 내용과 이유를 따로 읽고, 명시적으로 확정·취소한다.
- 입장·분야·절차는 별개 정보다. 새 SelectField는 실제 Headless Listbox의 string 값을 받으며
  가짜 DOM 이벤트를 만들지 않는다. 경합 시 로컬 선택을 보존하고 최신 기준과 비교한 뒤 저장한다.
- 자료 목록은 처리·실패·사건 반영 상태와 실제 검토/재시도/삭제 동작을 보인다.
  교정 화면은 원본 추출문·교정문·위치·관찰 종류·확실성·포함 여부·coverage를 유지한다.
  업로드 접수·교정 저장·사건 반영·분석·리포트 갱신은 서로 다른 단계로 안내한다.
- 리포트는 준비 상태·작성 기준·과거 기준 여부·저장 상태와 본문을 구분한다.
  기존 섹션 parser와 안전한 HTML renderer를 사용하며, 목차 anchor·사진 위치·공식 출처 링크를 보존한다.
  실제 textarea의 ref·selection·rows와 전체 본문 30,000자 한도, 사진 최대 12개·8MB를 유지한다.
- 미저장 본문·사진·범위와 저장본을 구분한다. 과거 기준 또는 재동의 전 리포트도 기존 허용 범위에서 읽고
  저장된 깨끗한 PDF를 받을 수 있으며, 새 생성·교정·수정 저장에는 기존 동의/현재성 검사를 유지한다.
- Dialog는 기존 호출자를 유지하면서 명시적 포커스 복귀와 필요한 mounted editor를 지원한다.
  Select/Field/Dialog의 SSR·CSP 경계는 기반 primitive 계약을 따른다. 최초 권한 확인 전 사적 화면을 제공하지 않는다.

`GlobalProductTheme`는 기존 전역 테마를 새 UI와 portal에 전달한다. 별도 island 사이의 React context 공유나
새 preference 저장소를 가정하지 않는다. 제품 전용 `product.css`에서 intake/evidence/reports CSS를 legacy layer로
읽고, 이관한 진입점의 중복 raw import만 제거한다. 원래 공유 CSS 내용이나 랜딩 import는 바꾸지 않는다.
그 import만 옮긴 CaseMaterials·EvidencePicker·ChatAttachments·EvidenceRequirements 등의 시각 tree는 여전히 기존 구현이다.

## 보존 계약과 소스 대조

controller의 상태·ref·owner ticket·load sequence·읽기/ACK 복구·CAS·작업 interlock을 기존 API와 함께 유지한다.
뷰 handler를 옮길 때 실제 argument·비활성 조건·확정 의미를 대조한다. 다음 값은 기준 소스와 공통 구문 범위를
byte 비교한 증거이며 import·함수명·view return·끝 빈 줄을 제외한 범위다. 파일 전체의 동일성이나 실행 검증을 대신하지 않는다.

| 대조 범위 | 동일한 UTF-8 바이트 | 별도 보존 확인 |
| --- | --- | --- |
| SummaryReconfirmation controller 핵심 | 17,987 | load/readSnapshot·accept·finishContext·mutate, 정확한 canonical/요약/workspace revision, 불확실한 요청 복구 |
| summary completion matcher | 1,830 | 최초 확정 ACK·같은 사건/본문·최신 workspace proof, proposal/request ID와 확정 revision |
| ConversationContextReview controller 핵심 | 6,690 | 변경 초안·attempt/acknowledged ref·최신 기준 비교·명시적 reload/review |
| FileReview controller 핵심 | 6,759 | 원문·file/workspace revision·부분 저장·페이지 읽기·교정 초안·권한 변경 시 폐기 |
| CaseContextPanel 선택 로직 | 833 | 명시적 탭 선택·자료 열기 요청·판례 lazy intent 유지 |
| ReportReview controller 핵심 | 25,813 | run/ownedResult·owner·정확한 저장/PDF 대상·작업 receipt·dirty/현재성·foreground 처리 |
| SectionEditor 입력/삽입 로직 | 905 | 같은 textarea ref·caret 복귀·사진 중복/개수/bytes 제한 |
| ReportReading section/outline/photo 구성 | 621 | 같은 section parser·useId anchor·저장 사진/허용 URL 구성 |

ReportReview에서 분리한 callback 24개는 원래 AST body와 대조했다. `changeExcluded`는 기존 file ID를
같은 argument로 전달하고, report에 의존하는 세 callback에는 null 시 종료하는 guard만 더했다.
비활성 조건 22개와 `aria-expanded`/`aria-controls` 원식도 유지한다.
자료 교정의 retry·loadMore·부분 저장 이어가기/취소·save handler는 기존 호출 대상·revision·확인 흐름으로 연결한다.

서버에서도 사용하는 report Markdown/document·마스킹·다운로드·정확한 검토본 다운로드 helper는 변경하지 않는다.
HTTP 읽기 취소를 서버 job 취소로 바꾸거나, 상태를 펼치거나 이동하는 동작으로 새 생성 요청을 실행하지 않는다.
새 Zustand/TanStack factory는 이 단계에서 기존 업무 조회를 대신하지 않으며 API/DB 성능 개선 완료로 설명하지 않는다.

## 확인한 검증과 한계

관련 primitive·SSR/상태·native prop·보존 검증은 **57 tests / 387 assertions**를 통과했다.
소유자 미확인 화면·slot 비노출, 동의 후 읽기/저장 PDF, stale/dirty/export 조합, 교정·coverage,
before/after·canonical completion, native 입력/Select callback·Unicode, 안전한 문서/출처/사진 표시를 포함한다.
기존 browser 검사의 기능·owner·원문·출력 단언은 유지하고 지정한 시각 선택자만 새 hook으로 바꾼다.
별도 harness는 실제 product.css를 컴파일하며 배포 경로를 추가하지 않는다.

Computer Use에서는 `localhost:4362`의 실제 Astro 경로와 명시적 mock adapter/합성 자료를 사용해 다음을 확인했다.

- 요약 변경 설명 제출 → 변경 전후 제안 → 확정, 입장/절차 Select의 키보드 민사 선택 → 저장.
- 부분 처리 자료의 coverage 확인, 교정 저장 후 v2 readback과 새로고침 뒤 보존.
- 리포트 준비의 unavailable 상태를 실제 한계로 표시, 본문 편집 v2 → 범위 변경 v3 저장과 합성 PDF 다운로드.
- 1440px 다크, 390px 라이트, 320px 확인 dialog에서 내용/조작 접근과 가로 넘침 여부.

이 과정에서 SummaryDisclosure가 기본 Fragment에 DOM 속성을 전달하던 문제를 `as="div"`로 고쳤고,
기존 CSS의 `appearance: none` 영향으로 보이지 않던 새 radio/checkbox에 native `appearance-auto`를 명시했다.
화면·조건·정확한 검사 SHA와 최종 quick/build/CI 증거는 [검토 기록](../quality/product-details/README.md)에 구분해 남긴다.
위 확인은 실제 OAuth·유료 모델·원격 D1/R2·실제 법률 결과·원격 PDF 엔진·배포 성공을 뜻하지 않는다.
다른 viewport/모든 실패 경로 또는 전체 프론트 UI 인수를 완료한 증거로 확대하지 않는다.

## 남은 화면과 다음 범위

| 남은 범위 | 실제 production 연결 | 다음 이관에서 보존할 내용 |
| --- | --- | --- |
| 대화 메시지·작업/pane·법률 분석 | Workspace, ConversationAgent/Panel/Analysis, MessageContent/ProgressiveReply/SourceCards | 실제 작업 상태·source/currentness·partial/실패·pane dirty/focus·다음 작업 |
| 업로드와 원본 viewer | EvidenceUpload/useEvidenceUpload, Workspace의 fileViewer JSX, MediaPlayer와 첨부/촬영 보조 UI | 동의·chunk/ACK 복구·server job·원본 권한·미디어 재생/탐색·preview 폐기 |
| 흐름·다음 행동 | Workspace timeline/actions tab과 ConversationPreparation/TimelineEvidence | 날짜 미상·근거·revision·완료 체크·과거 기록·명시적 재정리 |
| 판례·외부 조회 | PrecedentResearch/Document/ComparisonPanel/ComparisonResult, LookupDialog | 공식 원문·만료·분석과 검색 구분·수신처별 동의·같은 요청 복구 |
| 이후 해결·문서 초안 | 대화/리포트의 기존 FollowUpResolution | 직접 해결·지정 미지원 변호사 안내·리포트 저장, allowedDocumentKinds·검토 receipt·초안 CAS·TXT·중단/재개 |
| 계정·공개 보조 화면 | AccountSettings/LegacyProfileAssets, AuthButtons, ConsentForm, HelpFaq/PolicyDocument, 404/410 안내 | 재인증·삭제·기존 자료 권리·정책 버전·복귀·상태 코드 |
| v1 구형 사건 | Workspace schemaVersion1 → CaseDetail/Feedback | 기존 읽기/인용·질문·삭제·실패 상태. 자동 재분석하지 않음 |

ToolResults 전용 카드는 production import에 연결되지 않았고, ReportReading의 `onAsk`도 현재 호출자에서 전달하지 않는다.
HTML·ZIP API가 존재해도 현재 리포트의 주 내보내기는 PDF다. 이들은 기준부터 있던 미노출 상태이며 이번 포트로
삭제한 기능이나 새로 완성한 UI로 세지 않는다. 변호사 공개/전용 화면의 410은 의도한 종료 경계다.

전체 기능과 후속 이관 순서는 [웹 UI 재구성 계획](./WEB-UI-REBUILD-PLAN.md)을 따른다.
이번 단계의 완료 표현은 사건 요약·자료 목록/교정·참고 패널·리포트 화면 이관이며 전체 프론트 완료가 아니다.
