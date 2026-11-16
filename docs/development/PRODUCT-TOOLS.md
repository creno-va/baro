# 대화 도구·후속 해결·계정 화면 이관

## 기준과 구현 상태

기준은 랜딩 이식 PR [#816](https://github.com/creno-va/baro/pull/816)의
`44caf3ae302bd2fafd4bb7f661b0b33130a0098c`다. `codex/baro-conversation-tools-ui`의
구현 커밋 `8180269ec4d04067c6f085be0802bd0e65dae927`을 그 위에 연결했다.
문서 작성 시 다음 검토 단위인 817은 아직 미제출이며, main 병합·배포 완료가 아니다.

앞선 [사건 상세 화면](./PRODUCT-DETAILS.md)에 이어 대화의 실제 업무 도구, 리포트 이후 해결 방법과
설정·기존 본인 자료 화면을 새 Tailwind·Headless UI 시각 tree로 옮긴다. 기존 public props·exports·URL과
업무 동작은 facade/controller에 보존한다. 전체 프론트 이관이나 API/DB 최적화 완료를 뜻하지 않는다.
API·계약·DB·모바일·랜딩·공유 CSS·문서/다운로드 business helper는 이 단계에서 바꾸지 않는다.

## 실제 연결과 화면 구성

| 기능·진입 | 기존 진입을 유지한 새 조립 | 화면 역할 |
| --- | --- | --- |
| 사건 대화의 다음 준비·다른 작업 | ConversationAgent facade → useConversationAgentController + AgentView | 실제 상태·진행·미확인/누락 항목, 읽기 pane과 실행 구분, 오류·수동 재확인 |
| 대화 안 업무 pane | ConversationPanel facade → useConversationPanelController + PanelView | 같은 inline pane·제목·닫기/포커스 복귀와 nested modal 경계 |
| 법률·판례 분석 읽기 | ConversationAnalysis → AnalysisView | 현재/이전 snapshot, 조문·요건별 사실/증거·공백, 판례 공통점/차이·약점·대응 검토 |
| 대화 안 흐름·다음 행동 | ConversationPreparation → PreparationView | 기존 timeline/action props와 과거 기록 슬롯, 완료 체크·명시적 재정리 |
| 메시지 본문·점진 표시·출처 | MessageContent/ProgressiveReply/SourceCards → 새 MessageView/ProgressiveReplyView/SourceCardsView | 안전한 heading/list/강조/code, 한국어 grapheme 단위 표시, 기존 검증 출처 카드 |
| 대화/리포트의 이후 해결 방법 | FollowUpResolution facade → useResolutionController + ResolutionView/Guide/Scope | 직접 해결·미지원 변호사 안내·리포트 저장, 절차 확인·자료/가림·허용 문서·초안 검토/저장/TXT·중단/재개 |
| `/settings` | AccountSettings facade → useAccountSettingsController + AccountSettingsView | 사용량·한도·도움말/정책 진입·연결 OAuth 재인증·계정 삭제 확인 |
| 설정의 이전 본인 등록 자료 | LegacyProfileAssets facade → useLegacyProfileAssetsController + LegacyProfileAssetsView | 기존 소유 자산 lazy 조회·원본 preview/다운로드·revision 기반 삭제 |

실제 소스는 [conversation-tools](../../src/product-ui/conversation-tools/),
[resolution](../../src/product-ui/resolution/), [account](../../src/product-ui/account/)에 있다.
Workspace와 ReportReview는 기존 controller와 부모 interlock을 유지하며 같은 facade를 조립한다.
독립 island가 다른 island의 React context를 공유한다고 가정하지 않고 기존 전역 테마를 따른다.

대화 분석/준비는 펼친 정보의 위계를 단순하게 정리하고, 실행·대기·실패·현재성 상태를 실제 snapshot에 맞춰 보인다.
메시지 renderer는 React text 경계를 유지하며 새 HTML·원격 이미지·실행 가능한 링크 해석을 추가하지 않는다.
후속 해결은 세 경로 카드, 공식 안내/확인 필요, 선택 자료·가림 범위, 문서 준비와 검토 편집 영역을 구분한다.
계정은 사용량·도움말·본인 자료·삭제의 위계를 유지하고 삭제 action과 연결 공급자 목록을 실제 상태에 맞춘다.

## 보존 계약과 소스 대조

원문 controller의 state/ref/effect·owner/epoch/AbortSignal·읽기 순서·요청 receipt·CAS를 옮기고 새 뷰의
입력/버튼을 같은 handler로 연결했다. 핵심 구문 byte 대조는 import·함수 이름·새 view return을 제외한
각 명시적 추출 범위의 증거이며 파일 전체 동일성이나 실제 브라우저 실행을 대신하지 않는다.

| 원문 구문 범위 | 동일한 UTF-8 바이트 | 유지한 실행 경계 |
| --- | --- | --- |
| ConversationAgent controller core | 19,415 | owner 재확인·mount/epoch/abort·foreground polling·continuation/receipt·dirty/pane gate |
| ConversationPanel의 ID/ref와 세 effect | 3,136 | Escape ancestor·nested modal 보류·heading/scroll·연결 해제된 opener와 composer fallback |
| ProgressiveReply grapheme/표시 제어 | 2,168 | 한국어 grapheme·기존 표시 시간 한도·RAF 취소·완료 fence·reduced motion/숨김 처리 |
| MessageContent parser | 1,679 | 기존 heading/list/강조/code 문법과 React escaping. 끝 경계 newline 제외 |
| Resolution controller core | 14,687 | owner/동의 검증·run lock·report/analysis basis·draft CAS·저장/출력·host 상태. 끝 경계 newline 제외 |
| AccountSettings controller core | 9,086 | 조회 sequence·owner·recent OAuth/삭제 marker·정확한 DELETE·삭제 후 접근 정리 |
| LegacyProfileAssets controller core | 6,785 | 기존 자격/소유 scope·lazy 조회·preview blob 수명·권한 재확인·revision 삭제. 끝 경계 newline 제외 |

독립 AST/호출 대조에서는 다음을 확인했다.

- 대화 뷰의 disabled·onClick/onChange·href/rel/target·label·checked/value/type과 pane props를 유지한다.
  `onReportViewed`의 정확한 ID/revision과 mount/epoch/abort, `onOpenPane`의 상태 정리 순서도 그대로다.
- Resolution의 disabled 15개·checked 4개와 client/verify/draft-current/download/host 호출 27개의 인자가 같다.
  분리한 동작 8개·alias 6개는 같은 의미를 유지한다. checkbox/text/select는 실제 boolean/string을 직접 넘기며
  가짜 DOM 이벤트를 만들지 않는다. prepare/pause의 state-null guard는 원래 render branch가 보장하던 경계다.
- AccountSettings의 disabled 6개·click 5개·삭제 입력 change, 기존 자산의 disabled 7개·click 7개를 대조했다.
  재인증은 연결된 공급자만 사용하고 같은 owner marker를 유지한다. 삭제 전 같은 계정·최근 OAuth·정확한 DELETE를 확인한다.
- 공유 Disclosure는 기존 `open/close/contains/closest/focusTrigger` handle을 실제 root/trigger에 연결한다.
  static hidden subtree와 기존 close 동작을 유지한다. 이 소스 대조만으로 실제 포커스 타이밍 인수를 완료하지 않는다.

초안은 현재 report/analysis basis와 자료/가림 범위가 맞을 때만 본문을 제공한다. stale·paused·재동의·미저장 변경은
기존 읽기/수정/출력 차이를 유지한다. TXT 다운로드는 명시적 읽기이며 최신 resolution을 다시 조회해 같은 draft ID/revision과
현재 기준을 검증한 저장 본문을 받는다. ‘변호사와 해결’은 원래 문구의 미지원 dialog만 열고 trigger로 복귀하는 계약이다.
대신 제출·발송·대리하거나 새 연결 서비스를 호출하지 않는다.

기존 자산 조회가 새 프로필 생성·재공개로 이어지지 않으며, owner 변경/권한 실패 시 preview와 사적 상태를 정리한다.
로컬 읽기/HTTP 취소를 서버 작업 중단이나 원격 삭제 완료로 표시하지 않는다. 모든 새 view가 실제 처리 로직을 새로 구현한 것은 아니다.

## 스타일·검사 연결 경계

기존 resolution/settings CSS는 product.css의 legacy layer에서 읽고 settings 페이지의 중복 raw import 한 줄만 제거한다.
원래 CSS 내용은 보존한다. 테스트 전용 서버도 같은 제품 stylesheet를 컴파일하며 API resolver·endpoint·CSP는 유지한다.
대화 에이전트 독립 Astro fixture는 같은 bootstrap/hash·cache·head·Experience·app-focus 계약으로 새 CSS를 격리해 읽는다.

controller 이동으로 테스트 stub 대상에서 빠진 import는 테스트 전용 config 세 개의 정확한 suffix만 복구한다.
생산 Astro config·fixture API·binding·실제 반환 URL을 넓히지 않는다. 실제 resolve callback의 대상/인접 경로·다른 domain 검증도 유지한다.

현재 `product-ui:check`/`product-tools:check`는 [새 단계 가드](../../scripts/check-product-tools-preservation.ts)를 사용한다.
기준 #816부터 HEAD/index/worktree/untracked와 rename·symlink를 검사하고, 이전 검사 alias·dependency·lock을 보존한다.
기존 browser consumer 여덟 파일은 승인된 selector argument만 AST로 옮기며 나머지 단언은 보존한다.
API 문자열·spread·변수 이름을 치환하지 않는다. 계정 section은 유지한 aria-labelledby ID 관계를 사용하고,
geometry/RGB/Axe/권한·호출 수·다운로드 단언이나 legacy zero/harness 경계는 완화하지 않는다.

## 확인한 검증과 아직 남은 검증

아래 결과는 구현 중 기록한 서로 다른 검증 묶음이다. 겹치는 테스트가 있으므로 합산한 고유 테스트 수로 쓰지 않는다.

| 확인한 범위 | 기록된 결과 |
| --- | --- |
| 순수 대화 도구 뷰 | 19 tests / 213 assertions 통과. 실제 import graph에서 인증 API/transport/polling이 pure view로 유입되지 않는 경계 포함 |
| 위 뷰와 기존 message/analysis/agent/progress 회귀 | 독립 검토 53 tests / 358 assertions 통과 |
| 후속 해결 새 SSR/native prop 상태 | 14 tests / 95 assertions 통과 |
| 기존 resolution review/error/runtime/service/concurrency/request-proof | 63 tests / 307 assertions 통과 |
| 계정·기존 자산 새 SSR/상태 | geometry 소스 수정 뒤 9 tests / 666 assertions 통과 |
| 계정/후속 해결과 기존 review/error 독립 회귀 | 32 tests / 836 assertions 통과 |
| 단계 보존 가드와 실제 fixture resolver | 19 tests / 157 assertions 통과. 승인 CSS/config·선택자 차이, staged/committed 은닉·새 fixture 내용 제약 포함 |
| #816 위 초기 통합 | 실제 보존 가드 55개 경로와 tools TypeScript 검사 통과. 최종 문서·QA 결과를 포함한 head는 별도 재확인 |

최종 관련 묶음 61 tests/1,131 assertions와 로컬 Computer Use를 실행했다.
실제 결과·화면과 한계는 [검토 기록](../quality/product-tools/README.md)에 남긴다.
원본 byte/AST와 SSR/단위 검증을 모든 브라우저 overlay·RAF/visibility·실제 IME나 OAuth·삭제·원격 공급자
성공으로 해석하지 않는다. 최종 quick/build·현재 보존 가드·tools 타입은 통과했고,
정확한 head/PR CI는 제출 검증과 구분한다.

계정 삭제 action은 기존 desktop 오른쪽/수직 중앙 관계를 유지하도록 section header action으로 옮겼다.
이 소스 수정 뒤 SSR/AST와 실제 1440px geometry를 다시 확인했으며 오른쪽 배치·중심 오차0px·44px을 유지했다.
CUA는 로컬 합성 범위이며 원격 데이터 작업·배포 완료를 뜻하지 않는다.

## 실제 남은 기능 UI

| 남은 범위 | 이번 단계와 구분할 실제 source/진입 |
| --- | --- |
| 자료 업로드·촬영·전송/처리·복구 | Workspace의 upload UI, EvidenceUpload/useEvidenceUpload와 EvidencePicker/ChatAttachments/Requirements 등. 자료 목록·교정과 다른 범위 |
| 원본 문서/이미지·음성·영상 viewer | Workspace의 fileViewer JSX와 MediaPlayer. 이번 계정 자산 preview 이관과 다른 사건 자료 영역 |
| 판례 검색·공식 원문·사건 비교 | PrecedentResearch/PrecedentDocument/PrecedentComparisonPanel/ComparisonResult. 새 AnalysisView에서 기존 snapshot을 읽는 기능과 구분 |
| 외부 조회 | LookupDialog·Workspace tool 요청/결과 소비. 새 composer나 Agent UI가 실제 조회 화면 전체를 대신하지 않음 |
| standalone timeline/actions | Workspace의 `/cases/:id/timeline`, `/actions` tab와 편집/복구 UI. 대화 안 PreparationView 이관과 구분 |
| 로그인·동의·도움말·정책·오류/종료 안내 | AuthButtons/ConsentForm/HelpFaq/PolicyDocument, 404/410 body. 새 AccountSettings와 별도 |
| v1 구형 사건 | CaseDetail/Feedback의 기존 읽기·인용·질문·삭제/실패 경계 |

별도 `baro-material-research-ui`에서 후속 소스 작업이 진행 중이어도 이 브랜치의 연결·검증 완료로 미리 세지 않는다.
ToolResults 전용 카드·리포트 HTML/ZIP 웹 조작·ReportReading `onAsk` 등 기존 미노출도 새로 완성한 기능으로 세지 않는다.
기능표와 전체 후속 범위는 [웹 UI 재구성 계획](./WEB-UI-REBUILD-PLAN.md)을 따른다.
