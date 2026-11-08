# 앱 작업공간·고객용 리포트 개편 통합 계약

## 현재 기준과 소유

- 사용자 지시: 2026-11-08 KST. 통합 담당 BARO-UI-00. 이 문서·EXECUTION·공유 인수표는 00 단독 작성한다.
- 추적 [#751](https://github.com/creno-va/baro/issues/751), shell [#752](https://github.com/creno-va/baro/issues/752), 대화·자료 [#753](https://github.com/creno-va/baro/issues/753), 고객 리포트 [#754](https://github.com/creno-va/baro/issues/754).
- 실제 저장소: `/Users/hwang-eunchan/Desktop/baro/repository`, origin `creno-va/baro`. 사용자 기준 `D:/Project/baro`의 파일 경로는 각 worktree 루트로 치환한다.
- 신규 조사 기준 main `b643069bf9e923e50441c06c22930e9cd646e123`(PR750), main CI41946519596 SUCCESS. 2026-11-08 시작 조회에서 열린 PR/이슈0이었다. 과거 인계 SHA를 최신으로 사용하지 않는다.
- [ADR-0018](../adr/0018-conversation-report-rework.md), [기존 대화·리포트 계약](./CONVERSATION-REPORT-REWORK.md), [현행 비용 정책](../operations/PREBETA-COST-POLICY.md)을 유지한다. 과거 #620~627의 완료·외부 증거를 이번 화면 인수로 재사용하지 않는다.
- 실제 조회에서 #71은 사용자 범위 종료(not planned)로 CLOSED다. 본문의 과거 OPEN·완료 대기는
  현재 상태로 해석하지 않으며 다시 열지 않는다. 이 종료가 전체 MVP·독립 외부/법률 승인 완료를
  뜻하지 않는다는 원래 경계를 보존한다. 새 개편의 기능/외부 검증 상태는 #751에서 별도 추적한다.
- 00: `ui-00`, `codex/751-app-workspace-integration`, 포트4300. 01: `ui-01-shell`, `codex/752-app-shell`, 포트4311. 02: `ui-02-workspace`, `codex/753-conversation-materials`, 포트4322. 03: `ui-03-reports`, `codex/754-customer-reports`, 포트4333. 각 지정 채팅에서 실제 등록을 확인했다.
- 각 worktree 내부 `.wrangler`·DB·출력 fixture를 격리한다. 기존 checkout/secret/미커밋 작업은 보존한다. 실제 OAuth·사건·token·SQL/stack은 공개 기록·artifact에 넣지 않는다.

## 작업 순서와 파일 계약

01은 아래 계약 확인 뒤 공통 골격을 구현한다. 00의 설계 문서 PR은 제품 코드 선행이 아니다.
02/03의 shell 의존 제품 코드는 **01 PR의 정확한 head CI 성공과 main 병합 후**, 00이 전달하는
정확한 main SHA를 기준으로 시작한다. 선행 branch를 cherry-pick하거나 미병합 코드를 소비하지 않는다.
03은 #754의 명시된 독립 범위인 신규 리포트 조합·서버 정제·순수 parser 회귀를 현재 기준 SHA에서
진행할 수 있다. 이 독립 PR은 01 UI와 별개로 검토·병합할 수 있다. 02는 그전 조사·계약·격리 신규
fixture만 준비한다. 공유 파일 변경은 단일 소유자를 먼저 정하고 순차 통합한다.

| 담당 | 수정 가능 파일 | 제외·인계 |
| --- | --- | --- |
| 00/#751 | 이 문서, EXECUTION, docs/README, 공유 인수표·작업 그래프 | 제품 파일은 담당 리뷰 요청 뒤 소유권을 넘겨받기 전 수정하지 않음 |
| 01/#752 | AppLayout.astro, CaseLayout.astro, ui/app-navigation.tsx, workspace/CaseNavigation.tsx, 새 ui/workspace-frame.tsx·styles/app-workspace.css, AppLayout 전용 product/app-experience/product-refresh 스타일, shell 전용 테스트/독립 fixture | BaseLayout/global.css/shell.css는 공개 화면도 쓰므로 변경 금지. Workspace/리포트 업무 상태 금지 |
| 02/#753 | Workspace·ConversationAgent·ConversationPanel·CaseMaterials·자료/첨부 UI 및 추출 컴포넌트, 전용 workspace-conversation.css, case files/timeline/actions/precedents page wiring, workspace browser/helper | shell/CaseNavigation/리포트/서버 생성·공유계약 금지 |
| 03/#754 | components/reports, reports.css, utils/report-sections·report-markdown, server/modules/reports, FollowUpResolution·resolution.css, 필요한 기존 gateway analysis/resolution prompt, reports.astro, 리포트 전용 tests/fixtures | Workspace/Conversation/자료/공통 fixture·계약/DB 변경 금지. 프롬프트는 bounded 기존 실행과 audit 유지 |

추가 배정:03은 `src/client/api/mock/reports.ts`도 단독 소유한다. 새 합성 생성/명시 갱신만
고객 구조로 맞추며 저장/편집된 fixture를 자동 재작성하지 않는다.00은 실제 CI 차단 원인
#757의 `services/file-processor/Dockerfile`·README를 단독 소유해 LibreOffice/UNO5개 pin을
공식 Debian-security의 현재 제공 버전 `4:25.2.3-2+deb13u9`로 수리했다. 다른 버전·격리·gate는 유지한다.

03 UI 검증에서 공통 `product-refresh.css`의 옛 report-only 규칙이 새 전용 CSS를 덮는 것을
확인했다. 이 파일은03 UI PR 통합까지 **03 단독 소유로 임시 이전**한다(위01 기본 배정보다 우선).
report 블록만 정리하고 혼합 선택자는 분리해 비리포트 규칙을 보존한다.01의 후속 frame 수리는
`app-workspace.css`만 사용한다.02도 공통 파일을 수정하지 않고 전용 CSS를 사용한다.
같은 충돌을 확인한 `product.css`의 report-only 선택자도03 UI PR 병합까지03 단독 소유로
이전했다. 혼합/비리포트 규칙은 보존하며 보고서 전용 스타일의 중복 원인을 제거한다.

합성 report 편집만으로 false stale/PDF 잠금이 되는 경로를 분리하기 위해
`src/client/api/mock/rework.ts`는02 단독 소유로 배정했다.03의 mock/reports와 계약을 조율하되
실제 서버·API/DTO·새 fallback은 변경하지 않는다. 실제 source 변경의 stale와 보관 편집을
구분하고 동일 저장본 사진·가림·다운로드/owner/삭제·CAS 회귀를 유지한다.
mock/reports의 private optional `reportSourceHashes`는03이 소유하고,02의 rework는 공유 helper로
문서 현재성을 analysis binding/검증 상태와 구분한다. 순수본문/사진 PATCH는 기존 source hash를
상속하고 같은 revision의 자료·관찰·범위 변경은 stale로 남긴다.03은 mock/account의 사건삭제에
해당 hash 삭제1줄도 단독 소유한다. 공개DTO/runtime/DB/실제API는 변경하지 않는다.

`tests/helpers/report-*`, `reports-*`와 리포트 browser 파일은03 소유다. workspace/conversation/attachments
테스트·fixture는02 소유다. shell 전용 신규 fixture는01 소유다. 공통 config·package·lock·contracts·
design-tokens·migration은 현재 미배정이므로 변경 필요를00에 제안한다. 각 담당은 시작·브랜치와
주요 단계에 정확한 SHA/PR/파일/검증/남은 조건을 이슈와00에 인계한다. 배포·타 담당 병합은00만 수행한다.

실제 기존 전체 흐름 회귀의 단일 소유자는02다: `rework-conversation.e2e.ts`,
`rework-shared-mock.e2e.ts`, `conversation-agent.e2e.ts`, `helpers/rework-*`·`conversation-agent-*`.
기존 inline report/one conversation URL 기대를 주 reports 경로와 복귀로 바꾸되 양입장×후속3경로/
자료·사진·정확 원문·HTTP/SQL·identity/CAS·권한·native PDF/ZIP 단언을 유지한다.
`reports-*`·`report-*` helper/controls/브라우저와 `report-rework-layout-fixture`는03 소유를 유지한다.
공유 `helpers/case-ui-capture.ts`와02의 `helpers/workspace-navigation.ts`도02 단독 소유로
명확히 배정했다. 캡처에서 실제 자료 panel 닫기만 조작하며 fixture/API 우회를 추가하지 않는다.
PR762의 legal CI42444906438이 판례15개 중13 PASS/2 FAIL로 끝나 `precedents.e2e.ts`도02
단독 소유로 추가했다. 닫힌 도구 메뉴의 현재 링크 조회와 옛358px dialog 폭 기대를 실제 메뉴
조작·새 모바일 sheet의 범위/스크롤/닫기·포커스 검증으로 이관한다. 법률 원문·비교·권한·중복
실행 단언은 유지하고 backend/workflow 변경 없이 새 exact head의 모든 CI를 다시 확인한다.
나머지 탐색 회귀 `shell-integration.e2e.ts`, `product-ui.e2e.ts`, `public-preview.e2e.ts`,
`customer-real.e2e.ts`, `human-review.e2e.ts`는01 단독 소유다. 제거한 탭 선택자를 실제 사건 도구
열기·대화 복귀로 이관하며 URL/역할/업무 동작 단언을 보존한다.02/03 제품 통합 뒤 최신 main에서
검증하고 독립 PR로 통합한다.
전수검색에서 남은 `intake103.e2e.ts`, `customer-recovery-workspace.e2e.ts`의 숨긴 탭 링크와
`reports-integrated.e2e.ts`의 옛 후속 제목도01의 최종 탐색 PR에 단독 배정했다. 마지막 파일은
03에게서 임시 이전하며 기존 저장·PDF/권한 단언을 보존한다. 공개 랜딩 시연과 디자인 시스템의
독립 tab은 제거 범위가 아니다. fixture/API/제품 파일은 이 배정에 포함하지 않는다.

첫 최종 main 수동 full42453874134의 browser 실패를 확인해 추가 단독 소유를 배정했다.
01은 `cases.e2e.ts`, `design-system.e2e.ts`, `app-experience.e2e.ts`,
`intake-reconfirmation.e2e.ts`를 소유한다.02는 `customer-completion.e2e.ts`,03은
`reports.e2e.ts`를 소유하며 기존 각자 제품/전용 fixture 경계는 유지한다. 기준 main은
`96ff9355db02c361c129d0d5c7fbec4b7d053c85`이며 새 깨끗한 후속 branch를 등록한 뒤 수리한다.
일반 dialog의 중복 선택, 옛 문구/색상/desktop 폭·모바일 중앙 기대와 실제44px 대상·사진 삭제를
구분한다. 제품 회귀를 옛 테스트로 치부하거나 단언을 삭제하지 않으며 각 전체 config를 재실행한다.
완전한 raw job 로그에서 후반 실패도 확인해02에 `conversation-home.e2e.ts`,
`workspace-shared.e2e.ts`를 추가 배정했다. 기존02의 rework native WebKit 대응/save 경로도
분석 상태/관측·실제 준비 완료를 검증한다. 일반 `gh run view --log`의 긴 사진HTML 오류 뒤
누락과 raw job 로그를 구분하며 후반 실패를 숨기지 않는다.
44px 실패는 실제 공통 제품 회귀다. `product-refresh.css`의
`.app-frame[data-product-ui="refresh"] .conversation-context label`의 min-height38px를
44px로 수리하는 **해당 한 규칙만01 단독 소유**로 다시 배정했다.02 home도 같은 원인이므로
CSS를 중복 수정하거나 미병합 수리를 소비하지 않고01 정확CI/main 뒤 재검증한다.
01의 기존 독립 fixture `helpers/app-workspace-entry.tsx`와 `app-workspace.e2e.ts`에는
opt-in 장문 실제 Dialog의 내부 scroll/44px/닫기/초점 검증1개를 추가 배정했다. 기존25를
유지한26개 전체와 위4개 suite를 검사하며 제품 DOM/공유 fixture를 조작하지 않는다.
장문 실제Dialog의 마지막44px 버튼이390px 최대 스크롤에서도0.375px 잘리는 것을 추가 재현했다.
모바일 content의 bottom padding0과 CSSOM 정수 반올림이 원인으로, 같은 product-refresh.css의
`.ui-dialog:not(.ui-sheet) .ui-dialog__content` 모바일 padding 끝0→1px만01에 추가 배정했다.
전역 Dialog/공개 스타일/높이 기준은 바꾸지 않고 strict 완전노출1·44px/휠/초점 기준을 유지한다.
03은 모바일 PDF CTA를 `reports.css`의 유효 본문 폭100%/44px로 복구하고 desktop은 compact
오른쪽 정렬을 검증한다. 사진 실패는 새 첫 절을 잘못 편집한 경로로 재현됐으며 실제 증거자료
절의 inline/legacy 사진 token을 제거해 새 snapshot/HTML/PDF 사진0·이전본 사진 유지·다른
본문/출처 동일을 검사한다. 사진 부재 단언은 유지하고 큰 dataURI HTML 진단은 제한한다.
WebKit native는 model phase 시작 카운터와 currentW/confirmedS의 실제 게시 완료를 구분한다.
이미 접수된 fixture task만 settle한 뒤 실제 SDK GET·case·UI 현재 상태를 대조하며 새 admission/
DTO·SQL 조작/강제 reload·focus로 제품 회귀를 숨기지 않는다. 로컬 Docker 미실행과 최종 Linux
native 전체 여정의 실제 완료를 구분한다.

## 실제 조립 방식과 공통 인터페이스

현재 `BaseLayout`은 랜딩·로그인까지 global/shell/app-focus를 import한다. `AppLayout`만
product/app-experience/product-refresh를 import하며 AppNavigation island와 Astro slot main을
조립한다. `CaseLayout`은 AppLayout·case CSP·분석 설정을 제공하고 각 page가 Workspace 또는
ReportReview island를 mount한다. 이 구조를 유지한다. React island 사이 context는 공유하지 않는다.
새 SPA/router/대규모 상태관리 도구를 넣지 않는다.

01은 AppLayout의 기존 props `title`, `description`, `role`, `availableRoutes`, `contentClass`를
유지하며 앱 루트에 `data-app-workspace`를 부여해 토큰·새 규칙을 제한한다. AppNavigation은
독립 island로 최근 사건·현재 경로·역할·이름 변경/삭제·로그아웃의 기존 요청 및 owner guard를 보존한다.
다른 island와 업무 상태를 나누지 않는다. 사이드바 접기는 UI 상태이며 사건 본문 저장소가 아니다.

01이 제공하는 순수 조립 컴포넌트:

```tsx
type CaseWorkspaceFrameProps = {
  header: React.ReactNode;
  children: React.ReactNode;
  panel?: React.ReactNode;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  panelLabel?: string; // 기본 '자료'
  panelId?: string; // 기본 'case-materials-panel'
  kind?: 'conversation' | 'document';
};
// src/components/ui/workspace-frame.tsx
export function CaseWorkspaceFrame(props: CaseWorkspaceFrameProps): React.ReactNode;
```

frame은 헤더·중앙·패널 grid와 자료 열기/닫기, overlay의 포커스 trap/복귀·Escape만 소유한다.
업무 상태/API/polling은 소유하지 않는다. panel이 없으면 toggle을 표시하지 않는다. header 슬롯의
기존 CaseNavigation과 frame toggle은 중복 버튼이 되지 않아야 한다. 패널은 닫아도 같은 React
트리에 남기며 hidden/inert·CSS로 가린다. 모달 overlay가 닫힐 때 내부 미저장 교정을 버리지 않는다.
Escape는 가장 안쪽 기존 dialog가 먼저 처리하며 외부 panel이 그 동작을 가로채지 않는다.

CaseNavigation은 기존 `caseId,title,active,fileCount?`를 그대로 받고 작은 사건 제목과 `사건 도구`
메뉴를 제공한다. 추가 `actions?: React.ReactNode` 슬롯을 허용한다. 메뉴에 요약 재확인·타임라인·
다음 행동·유사 판례의 기존 URL을 둔다. 현재 도구는 aria-current로 표시한다. 대화 복귀 링크는
보조 화면에서 제공한다. **6개 가로 탭은 제거한다.** 중간 shell PR에서도 모든 기존 경로가
열리도록 자료/리포트 링크를 도구 메뉴의 보조 진입점으로 유지할 수 있다. 최종 primary 진입은 자료 panel이다.

```tsx
<CaseWorkspaceFrame
  header={<CaseNavigation caseId={caseId} title={view.title} active="chat" />}
  panel={<MaterialsPanel /* 기존 state/query/mutation 재사용 */ />}
  panelOpen={materialsOpen}
  onPanelOpenChange={setMaterialsOpen}
>
  <ConversationAgent /* 기존 검증/진행/선택/첨부 state 유지 */ />
</CaseWorkspaceFrame>
```

02의 Workspace가 panelOpen과 기존 자료 업무 state를 소유한다. chat/files 경로의 자료 JSX를
복제하지 않고 공통 추출한다. `ConversationAgent`가 읽은 실제 progress를 최소
`onStateChange?: (state: V2ConversationState | null) => void` callback으로 부모에 전달해 자료 하단에
표시할 수 있다. 공유 DTO 변경 없이 기존 state 타입을 재사용한다. 별도 무조건 polling은 금지다.
현재 revision·owner·읽기 상태를 확인하지 못하면 null로 전달해 완료 상태를 추정하지 않는다.
구형 files URL은 metadata-only 계약을 유지하며 전체 대화/facts/messages나 별도 progress island를
자동으로 읽지 않는다. 이 경로의 하단은 '리포트에서 준비 상태를 확인할 수 있어요'와 열기 링크를
표시한다. chat에서는 기존 ConversationAgent의 단일 진행 조회와 명시적 상태 재확인을 공유한다.
리포트 링크는 `/cases/:id/reports?mode=conversation`이며03은 이 mode를 기존 conversation
report opt-in으로 해석한다. 구형 `/reports`의 기존 snapshot 읽기도 보존한다. 링크·GET만으로
prepare_report/save_report/analysis를 호출하지 않는다. 명시적 새 생성/갱신은 기존 액션을 사용한다.

## 화면·토큰·스크롤

| 화면 | 구조·기본 동작 |
| --- | --- |
| 데스크톱 >=1200px | 왼쪽256px 접이식 sidebar, 중앙 minmax(0,1fr), 자료360px(필요시320–400 내 조절). 중앙 읽기 폭 최대800px, 입력 최대800px. 자료는 같은 화면 오른쪽 |
| 태블릿768–1199px | 기본 sidebar rail 또는 접힘, 필요시 왼쪽 drawer. 자료는360px overlay. 중앙 대화 폭을 침식하지 않음 |
| 모바일<768px | 중앙 대화 우선. sidebar/자료는 각 drawer/sheet, 동시에 열린 modal은 하나. 고정 헤더·하단 입력과 가상 키보드가 본문을 가리지 않음 |
| 리포트 | 같은 AppLayout sidebar. 중앙 document+접이식 목차(데스크톱200px 내외), 본문 최대820px. 모바일 목차는 disclosure로 문서 위, 읽기/작업 메뉴가 본문을 계속 덮지 않음 |

자료 frame의 overlay 기준은1200px다. 공통 내용 Dialog는 기존 product-refresh CSS의
760px 이하 하단 sheet/761px 이상 중앙 배치를 유지하며 두 경계에서 containment·44px·
장문 내부 scroll·초점 복귀를 검사한다. 앱 sidebar의768px 전환과 각 컴포넌트의 실제 기준을 구분한다.

앱 전용 실제 토큰은 `--app-canvas:#fff`, `--app-sidebar:#f8fafc`, `--app-line:#e2e8f0`,
`--app-text:#0f172a`, `--app-secondary-text:#475569`, `--primary/--product-blue:#2563eb`다.
BARO 로고와 blue primary를 유지하며 이 재정의는 AppLayout scope에 적용한다. Pretendard 유지.
본문16px/1.7, 보조13–14px/1.5, 작은 사건 제목
16–18px/1.4. 여백4/8/12/16/24/32px, 표면 radius8–12px, 입력 radius16px, 그림자 최소화.
큰 히어로·중복 안내·겹친 카드·블루 배경 면적을 줄인다. 앱 헤더 높이56px 전후, 조작 대상
최소44px, visible focus, reduced motion, 한글 keep-all+긴 파일명 anywhere를 사용한다.

AppLayout은 sidebar와 main의 공간을 제공한다. conversation frame은 `100dvh` 안에
header(auto)/body(minmax(0,1fr))를 두고 중앙 메시지·자료 각각 스크롤을 소유한다. composer는
중앙 내부 마지막 행이며 전체 body를 가리는 fixed positioning을 피한다. 중복 height 계산·
이중 스크롤/모바일 강제 100vh를 만들지 않는다. 보고서와 일반 앱 페이지는 문서 스크롤을
기본으로 하고 목차/작업바만 sticky한다. 부모 min-width/min-height=0, overflow 책임을 명확히 한다.
화면 폭 변경은 CSS 위주이며 입력·첨부·선택·진행·교정·편집을 remount하지 않는다.

## 기존 기능과 새 진입점

| 기존 탭/기능 | 최종 진입·보존 |
| --- | --- |
| 대화·전송·진행/재시도·첨부·ProgressiveReply | 사건 기본 중앙, 하단 composer. 과거 읽기 중 강제 스크롤 없음, IME 조합 Enter 전송 금지 |
| 요약·AI 재조율·사용자 재확인 | 사건 도구의 요약 보기/재확인과 기존 대화 액션·summary URL |
| 자료 업로드·처리/실패·coverage·pagination | 오른쪽 자료 panel, 기존 동의/한도/metadata projection 재사용 |
| 자료 선택·원본·검토/교정·삭제·대화 반영 | 동일 panel과 기존 FileReview. preview와 대화 selected를 구분. /files?file= 동일 자료를 열고 직접 URL 보존 |
| 타임라인 추가·편집·최신 반영·더 보기 | 사건 도구→기존 /timeline. 리포트의 현재 사건 타임라인 링크. snapshot 본문을 현재 편집 상태와 혼동하지 않음 |
| 다음 행동 편집·완료·최신 반영 | 사건 도구→기존 /actions, 리포트 다음 준비의 현재 행동 관리 링크 |
| 유사 판례 원문·비교·검색 | 사건 도구→기존 /precedents. 리포트의 저장된 검증 판례·공식 출처와 현재 판례 탐색을 구분 |
| 리포트 준비 상태·읽기 | 자료 하단 '리포트 열기', 실제 not_started/pending/ready/failed/stale. report URL은 준비 전에도 상태를 보여줌 |
| 리포트 새 생성·갱신·버전·읽기/편집/저장 | 주 리포트 화면. 새 생성/명시 갱신만 새 기준 적용. 준비/실패/미확인을 완성으로 위장하지 않음 |
| 사진 배치·제외/가림·식별정보·기존다운로드 | 리포트 작업 메뉴와 기존 선택·저장·PDF 내보내기. HTML은 기존 내부 미리보기/렌더링 API를 보존하고 사용자 다운로드 CTA를 새로 추가하지 않음. 같은 저장 snapshot 기준 내용/사진/출처 일치 |
| 직접 준비·전문가 도움·리포트만 저장·후속 초안 | 리포트의 다음 준비/해결 선택, 기존 FollowUpResolution. 법률 분석·절차 근거 미준비는 그대로 표시 |
| 최근 사건·새 사건·역할별 탐색·이름변경/삭제·설정·계정 | 앱 sidebar, 변호사 역할 프로필/기존 공개 탐색·URL 보존 |

## 고객 리포트 편집·정제 기준

표시 명칭은 **내 사건 이해와 해결 준비**를 기본으로 한다. 사건 title·저장 version/time/basis는
실제 snapshot으로 표시한다. 새 본문은 다음 순서를 목표로 하되 데이터가 없는 절을 꾸며 채우지 않는다.

1. 지금 내 사건: 사용자 확인 목적/입장, 현재 단계·미확인, 핵심 상황과 읽는 법.
2. 지금 준비할 일: 기존 행동·자료/확인 공백에 연결한 할 일·이유·준비물·확인 기준. 완료/추론을 임의 추가하지 않음.
3. 핵심 쟁점과 내 근거: 검증된 분석과 사실/자료의 연결, 상대 주장·우리 측 약점·상반 자료.
4. 사실과 경위: 사용자 주장/자료 기재/확인 범위/AI 정리/미확인 구분, 당사자·타임라인·자료 처리 범위.
5. 관련 법·판례의 의미: 기존 검증 조항/원문/claim binding과 판례별 공통점·차이점·적용 한계. 단순 나열 금지.
6. 선택지와 확인 조건: 직접 준비 가능한 범위, 공식 기관 확인/전문가 검토가 필요한 이유와 조건, 기존 후속 해결 선택.
7. 자료·공식 출처·분석 기준: 사진과 원래 위치·출처, 검토한 범위·누락·기준 시각. 내부 provenance ID는 사용자 언어로 정리.

이 순서는 기존 verified snapshot을 안전하게 조합하는 기준이지 새 법적 결론 생성 권한이 아니다.
공식 근거 없는 기한·관할·기관·필수 순서를 만들지 않는다. 청구 준비/상대 청구 대응과
민형사·단계는 사용자 확인을 넘어서 확정하지 않는다. 반대 증거·약점·unknown은 보존한다.
모든 행동을 변호사 상담으로 끝내지 않고, 직접 준비와 전문가 검토 조건을 구분한다.

현재 `reportReviewSections`가 숨기는 준비할 행동/공식 출처/자료 처리 범위를 조사해 새 고객
문서에서 접근 가능하게 한다. 서버 신규 정제→공유 parser→웹/HTML/PDF의 같은 본문 흐름을
유지한다. 사진 토큰·편집 section 범위·출처 링크/XSS 방어·정확 인용을 손상하지 않는다.
**과거 저장본·사용자 편집본은 열기/상태/다운로드에서 재정제하거나 덮어쓰지 않는다.**
현재 사건과 snapshot이 다르면 갱신 필요를 표시하되 자동 갱신하지 않는다. 새로운 LLM 정제 단계를
추가하지 않고 필요한 프롬프트 변경은 기존 bounded gateway 실행·독립 audit 안에서 검증한다.

## 인수표와 실제 결과

### 통합 기록

- 설계 PR755 exact `7df0323668afd8e6a22a32359210441053ef40f1`: pinned ci/quick/build PASS,
  CI42438237235 SUCCESS→main `3b9c459da53c1cc1fdb2633aadfe6d786100fa7c`.
- native 수리 PR758: 첫head ca1797e의 품질/native 성공·기존 PDF PNG31쪽 시각 검토 후,
  최신 base 필수 gate가 병합을 거절해 우회 없이 문서 main을 통합했다. 새 exact head
  `11c502fc0e1537de32d89d0e1e61e87e10302296`의 quality42438975887/native42438975903
  SUCCESS→main `3a61b3619e18dbbb58970ef4c3c8821a4c6a4627`. 두head의 src/services/tests/scripts/
  lock/package/workflow diff0을 확인했고 새head native도 실제 재실행됐다. PR756의 원래 apt실패/
  artifact0은 보존한다. 이 단계는 새 고객 내용이 아닌 기존 조판 런타임 회귀다.
- 이후 통합/최종 main 수동 full·같은 SHA preview의 실행 결과 정본은
  [#751 실행 기록](https://github.com/creno-va/baro/issues/751)과 아래 인수표다. 중간 성공을 최종 인수로 확대하지 않는다.
- 공통 shell PR759 exact `bbefd957ac7c00815c1d6df70ad72a4c930a4e3d`: CI42439939329 SUCCESS
  →main `4a6ea5c0ed76a0ae87f2ed54eb26028622e1cc65`. 01의 ci/quick/build·독립 shell16/실제 Astro5/
  기존 인증6/공개 pixel4 검증과00 독립 shell16/16을 확인했다.00이 실제 메뉴 겹침과 초기 열린
  desktop panel의 잘못된 modal/focus를 찾아 각각 수정·재검증했다.이 SHA를02 제품 착수와03
  서버 PR 재검증 기준으로 전달했다. 실제 export·적용법은
  [공통 frame 가이드](../../src/components/ui/workspace-frame.md), 전후 화면은
  [shell 검증 기록](../quality/app-workspace-shell/README.md)이다.
- 고객 본문 서버 PR756 exact `8bb58a65e13c03fb00db1946bbe5b5f68f6dd2df`: quality42440378000/
  native42440377956 SUCCESS→main `ac2cf6a6e6e9bb3a1c8b89b2b9aa9b9723eb3244`.
  03의 ci/quick/build·reports363 PASS/2 native opt-in SKIP,00 독립 고객/HTML/snapshot/readable
  34/34를 확인했다.00은 exact CI의 PNG33쪽을 시각 검토했고, 신규 청구4쪽·대응4쪽 모두 개요/
  핵심 쟁점/준비/선택 조건/법·판례/출처를 포함하며 잘림·겹침이 없음을 확인했다. 이 단계의
  구형 eyebrow/footer와 숨긴 자료 범위는03 UI 후속에서 정렬하며 전체 화면 완료로 표시하지 않는다.
- 02의 실제 자료 교정 통합에서 sibling FileReview modal을 연 채 desktop→mobile로 resize하면
  frame이 새 modal로 그 위에 올라오는 문제를 발견했다.01이 #752 후속 `codex/752-panel-modal-order`
  단독 소유로 재현·수리한다.02는 common 파일을 수정하지 않고 수리 PR의 CI/main 뒤 소비한다.
- 공통 후속 PR760 exact `d464cd23eba321350dc68e0dc053a9c62dc79c08`은 CI42441779312 SUCCESS
  →main `b686352d1eb012275705f1d0bea7f69e9388eaa8`로 정상 병합했다.01의 ci/quick/build와
  기존16+모달/확대5+조건부 unmount4=25/25,00 독립25/25를 확인했다.실제 기다리는 dialog의
  once close를 수신해 detach 이후에도 새 mode로 동기화하며 타 dialog의 DOM/상태는 조작하지
  않는다. root zoom은 한 번만 환산하고 observer 자기 피드백0을 검사했다.02에 이 SHA를 전달했다.
- 리포트 UI PR761 리뷰 중00은 사진 가림 시 합성 PDF 제목의 식별정보 누출과 Workers 전용
  새 조판 머리말의 옛 명칭을 발견해03에 수리를 요청했다. 기존 저장 PDF bytes/제목은 보존하고
  새 raster/PDF 경계만 정렬한다. 중간 exact7b2782의 quality42443029783/native42443029808은
  SUCCESS,00 독립48/48·395 assertions PASS와 native47 PNG+실제SQL PDF10쪽=57쪽 시각
  검토를 마쳤다. 청구/대응 각4쪽 신규고객구조, 긴55행표·가로/세로사진·가림 각9쪽과 기존
  조판3쪽을 구분했다. 마지막 제품 변경은 Workers 머리말1줄과 실제 PDF추출검사이며 이후
  웹 fixture에 누락됐던 동일 세로사진·전체55행 단언만 보강했다. 최종 exact head
  `2e5c65fb9b67888fe50b462d2ffbd7010fc2342b`의 quality42443726527/native42443726453
  SUCCESS와 최종 PNG47/47 byte동일을 확인해 정상 병합했다. main은
  `aeebe0509fad5f4efe91e8a6f184f42e42817f17`이다.03의 최종 ci/quick/build, focused browser31,
  mock26/171 assertions, 별도 Workers2쪽 검증과 정확한 branch/파일/외부 경계 인계를 받았다.
  그 뒤02의 helper 소비를 해제했다. 두 공통 CSS의03 임시 단독 소유권은 이 병합으로 반환한다.
- 대화·자료 PR762는 선행 main aeebe050을 정상 소비한 뒤 마지막 exact head
  `4b7707611ec09eedb4bb42c8053d1ea08409856b`에서 quality42446123492/legal42446123424/
  native42446123523 SUCCESS를 확인해 main `7bdafac83dcc7f80a8f13ce57bb8398072446bab`로
  정상 병합했다.00은 제품/19파일 diff와 단언 보존을 리뷰했고 mock47/47·344 assertions를
  독립 재실행했다.02의 ci/quick/build, 자료8/기존90/첨부18/초안24/shared2/agent42/
  양입장 sharedmock4/legal15를 확인했다. 실제SQL20 중 기존17 PASS 이후 잘못된 기본제목
  기대와 접힌 준비도구 진입을 수리한 양브라우저 targeted4 PASS로 모든 실패 경로를 재검증했다.
  최초 legal42444906438의13/15 실패는 지우지 않는다. 최종130 탐색 회귀와 Docker가 필요한
  native6 전체 여정은 이 중간 성공과 구분해 최종 main에서 수행한다.
- 01의 최종 실제 reports 통합 axe에서 절 번호 대비2.99:1이 발견돼03의 기존 전용 소유 범위에서
  `reports.css`의 본문/목차 번호2색만 `#647084`로 수리했다. PR763 exact
  `3e67a6fbebde299dde08b0d442c673213072d7af`의 quality42448285429/native42448285489
  SUCCESS,03의 기존 실제 shared 검사 RED→GREEN과01 독립 report3/3 PASS를 확인해
  main `d5bdcbc4eb77db0e482a0cd84c5a94daf2b7d75a`로 정상 병합했다. 본문/사진/저장/
  API/정제/프롬프트/fixture/테스트 변경은 없고 white5.01/hover4.57의 대비를 유지한다.
- 최종 탐색 회귀 PR766 exact `974c469c65574fbe315d55c0dca3677e3af46c42`는 위 main을
  기준으로 제품·API·seed·fixture를 바꾸지 않고 지정9개 테스트 파일만 이전했다. 실제 사건 도구
  펼치기·링크·대화 복귀, hydration 완료, 고정 헤더/입력창과 메시지 내부 wheel 스크롤을 검사한다.
  01의 frozen ci/quick/build와 최종130 PASS/0 SKIP을00이 receipt·전체 diff로 검토했다.
  품질 CI42453081108 SUCCESS 뒤 main `080cde77bbee04259ee94e9c06e197e42f1d1698`로
  exact head를 정상 병합했다. 최종 docs/전체 검증은 [#751 실행 기록](https://github.com/creno-va/baro/issues/751)에 남긴다.
- 인수 문서 PR767 exact `23b506832ff85055754102b429b28b668b913094`의 ci/quick/build·
  CI42453533606 SUCCESS 뒤 main `96ff9355db02c361c129d0d5c7fbec4b7d053c85`로 정상 병합했다.
  이 SHA의 main CI42453839910, preview42454227087은 SUCCESS다. preview live/ready도 같은
  release와 schema0022, 익명GET9개·observation-only configuration readiness를 확인했다.
  **수동 full42453874134는 FAILURE**다: core SUCCESS(전체5426 PASS/8 기존 opt-in/platform
  SKIP/0 FAIL), native SUCCESS(실제SQL PDF/ZIP2와 전체 codec/보안), browser FAILURE,
  join SKIPPED. browser의 구형 UI 기대·중복 dialog·44px/사진 삭제 경로를 담당별로 수리한다.
  부분 성공을 최종 full로 대체하지 않고 실패/artifact13607619592를 보존한다. 앞선 존재하지
  않는 target의 수동42453855888은00 전사 오류로 즉시 취소한 기록이며 성공으로 세지 않는다.
- 공통 후속 PR768 exact `ebf2d71294acae940265eef803e779c3e1b9b492`: CI42458625207 SUCCESS,
  같은 HEAD Node24.22.1/Bun1.4.0 ci/quick/build와 cases5/design8/app11/intake53/frame26=
  103 PASS/0 SKIP/0 flaky를 receipt로 직접 확인했다.00은7파일 전체diff와 실제 CUA390px
  장문 끝버튼 완전 노출·읽을 수 있는 한글·초점을 시각 검토해 정상 병합했다. main은
  `7d1a250ae1988f2f32955ca0af66898252ebb493`이며02/03에 소비 gate를 해제했다. 제품 diff는
  위44px와모바일 끝여유1px 두 선언뿐이다. 일시적 빈 paint의 자동 PNG는 최종 시각 근거로 쓰지 않는다.
- 리포트 후속 PR770 exact `cf4232a160f16f08aa1a8d14c3a4ef99b06ba53a`: quality42459529236/
  native42459529217 SUCCESS와 같은 HEAD ci/quick/build, reports10·SQL photos14·state16/
  requests6 PASS를 확인했다.00은3파일 전체diff·원자적 동일프레임 기하 측정·새id/revision/
  inline·legacy 사진 삭제와 이전본/정확 원문 보존을 리뷰했다. 실제 읽기 PNG2장을 확인하고
  native artifact13608968311의47PNG가 앞선 검토본과47/47 byte동일임을 독립 확인해 정상
  병합했다. main `31d9e104db16d4f1a187091cb64ff6d93489cb04`를02에 전달했다. 제품 diff는
  모바일 PDF CTA 유효폭100%3줄뿐이며 parser/사진fallback/저장/DB/LLM은 바꾸지 않았다.
- 대화·자료 회귀 PR769 exact `3e83b081a82d726e1f3f27dd9cf466702fbda39b`: CI42460022979
  SUCCESS, 같은 HEAD home18/customer14/shared4/material8=44 PASS와 ci/quick/build를
  SHA256 로그 receipt로 확인했다.00은 지정4파일 전체diff와 기존 검토본 대비diff0을 재확인해
  main `b0f084277f026a56dd1268fdb8988808cb864e2f`로 정상 병합했다. 제품/DTO/API/SQL/workflow
  변경0, 실제 dialog 범위·owner 초안 purge·원문/교정/제외/coverage·저장본 동일성과 모델/출처
  횟수 불변 단언을 보존했다. WebKit native의 currentW/S·실제 게시/ready 관측은 사전PDF까지
  로컬 검증했고 Docker PDF/ZIP까지32개 전체는 후속 최종 main manual full로 남긴다.

00은 별도4300의 실제 Astro 화면에서 합성 대응 사건2×3 질문·요약·긴 제목, TXT 업로드·교정v2·
모바일 resize·대화 반영과 기존 입력 보존을 직접 조작했다. 저장 리포트v2/사용자 메모는 자료
변경 후에도 그대로였고 현재 사건과 다름을 표시했다. 명시v3만 교정 자료를 반영했다. 사진
추가 후 명시v4→배치/저장v5의 실제 이미지 naturalWidth1000, 상태 조회 뒤 미변경 저장 disabled,
가림 저장v6의 사진0·현재 source 기준, 대화 복귀/사이드바 양방향을 확인했다. 마지막1280×720에서
6탭 DOM0·자료2개·입력 enabled·가로넘침0, viewport override를 원복했다.

같은 합성 IAB의 PDF3쪽/947,924 bytes 파일은 실제 저장됐지만 다운로드 묶음 tool walltime854초,
파일 선택 묶음4240초의 단회 도구 대기가 있었다.03의 기존 묶음8.811초 관측과 구분하며 폰트/
canvas/owner 조회/도구 대기 중 원인을 현재 증거로 단정하지 않는다. 이를 실제 서버 native
생성 시간이나 production 성능 결과로 사용하지 않는다.4240초 관측 뒤 파일 선택·다운로드
도구를 재실행하지 않았다. 저장 PDF의3쪽도 별도 렌더링해 한글·사용자 메모·미확인/상반 내용과
저장 당시 자료 없음 표시, 겹침·잘림 없음을 확인했다. 이후 자료를 올려도 이v2는 바뀌지 않았다.

로컬 고정 도구는 Bun1.4.0과 Node24.11.0을 `/private/tmp`에 격리 설치해 사용한다.
Mac 기본 TMPDIR의 `/var`와 `/private/var` realpath 차이로 기존 coverage consumer 검사가
실패하는 것을 재현했고 `TMPDIR=/private/tmp`에서 원래 assertion 그대로 통과했다.
Bun 설치 디렉터리의 `bunx`는 같은 공식 Bun 바이너리 symlink다. lock·의존성·테스트를 바꿔
이 환경 문제를 숨기지 않는다. workerd 로컬 listen은 sandbox 허용 환경에서 수행한다.
첫 full 실패 수리부터는 실제 `apps/mobile/.node-version`의 Node24.22.1로 전환했다.
02가 공식 archive와 SHASUMS256.txt를 대조한 격리 설치/verification receipt를 제공했고00/01/03은
그 도구를 읽기 전용으로 소비한다. 이전 로컬24.11 결과와 구분하며 CI는 repository pin을 따른다.

02의 추가 조사에 따라 legacy `/files` 직접 진입은 metadata-only 읽기를 보존한다.
같은 추출 자료 UI를 주 작업으로 열고 대화 복귀 링크를 제공한다. canonical 대화 경로는
중앙 채팅·오른쪽 자료이며 `/files` 열기만으로 facts/messages를 추가 조회하지 않는다.

아래 결과는 이번 exact PR과 격리된 합성 입력의 기능 인수다. 최종 docs PR까지 병합한 main의
실제 checkout SHA·수동 full의 core/browser/native와 join·동일 SHA preview 결과는
[#751 최종 receipt](https://github.com/creno-va/baro/issues/751)에 기록한다. 해당 실행이 실패하면
그 실패와 수정 PR·재실행을 보존하며 이 중간 인수로 대체하지 않는다. 합성 기능 검증과 실제
OAuth·공급자·공식 법률 API·remote storage·독립 법률 인수는 별개다.

| ID | 시나리오/검사 | 담당 | 현재 결과 |
| --- | --- | --- | --- |
| A01 | 새 사건→2×3 이하 질문·요약 확인→중앙 대화 | 02/00 | PASS: 00 실제 Astro 합성 대응 사건·질문6개·요약 확인·대화, 02 양입장 sharedmock4와 실제SQL 경로, 01 customer6/intake29 |
| A02 | 업로드→검토·교정→선택 자료 대화 반영·실패/재시도 | 02/00 | PASS: 00 TXT 원문·교정v2·대화2메시지·사진 업로드, 02 자료8/첨부18/초안24/agent42, 업로드 ACK 대기 resize 중 중복0 |
| A03 | 자료 panel→리포트→목차/근거 이해·편집·사진/가림·저장·다운로드→대화 | 03/00 | PASS: 00 저장v2/다운로드3쪽→자료 변경 후 보존→명시v3/v4→사진v5→가림v6→대화. 03 focused31·후속770의 실제 증거자료 token삭제/새본 사진0·이전본 사진1·SQL14/실제 native 증거 |
| A04 | 고객/변호사·직접 URL·새로고침·뒤로·재접속·owner/동의 변경 | 01/02/03 | PASS: 최종130에 역할/6URL/재접속/CAS/계정 변경·report3 포함. 02 기존90/실제SQL·03 기존 owner/삭제 회귀 유지. 실제 OAuth 성공과 구분 |
| A05 | panel/resize 중 입력·선택·교정·업로드/작업·편집 유지 | 02/03 | PASS: 00 실제 모바일↔desktop dirty 교정·선택·초안 보존, 02 자료8의 ACK/중복 방지, 01 frame25의 sibling modal/조건부 unmount/초점·zoom |
| A06 | 상태 조회 false dirty·저장 지연·늦은 응답/충돌 덮어쓰기 방지(PR743/747/749 보존) | 03 | PASS: 00 상태 조회 뒤 변경 없는 저장 disabled·v5 보존. 03 mock26/171 assertions·focused31·01 report3의 지연/복구/CAS·oversized 원문 검사. 기존 저장 deadline 회귀 유지 |
| A07 | 320/390/768/1024/1440·keyboard/IME·긴 제목/파일명·200%·focus | 전원 | 중간130/0skip·자료8/legal15·00 실제 resize PASS. full에서 발견한 실제38px와 장문끝clip은768의103/0skip/0flaky로 수리·완전노출/44·최대휠·키보드·focus 확인,770의PDF 기하/위치도 유지. composition 자동 검증이며 물리 한글 IME·실기기 인수와 구분 |
| A08 | 6개 탭 제거·전 기능 새 진입·기존 URL 보존 | 00 | PASS: 00 최종 DOM0, 01 실제 도구6링크·aria-current·Enter/Tab/Escape·복귀, 위 기능 대응표의 URL/메뉴/자료 panel/리포트 진입 보존 |
| A09 | 랜딩/로그인 전후 시각·스타일 import 경계 | 01/00 | PASS: 원래 baseline b643069의 390/1440px 공개4화면 raw pixel 차이0. BaseLayout/global/shell 보존, app 전용 scope 및 actual Astro 검사 |
| A10 | 청구/대응·자료 없음/상충·불완전 분석·절차 미확인·stale, 고객 내용 전후 | 03/00 | PASS: 신규 양입장 native4쪽씩·00 독립34/48 및 mock47, unknown/상반 내용·근거·직접 준비/전문가 조건 실제 구성. 기존 저장 제목/사용자 편집 자동 변경0 |
| A11 | 같은 저장본 웹/HTML/PDF 본문·사진·출처·한글 전페이지 시각 | 03/00 | PASS: exact761 native47 PNG byte동일·실제SQL10쪽 합계57쪽 전페이지 검토, 55행표/인용/한글/2방향사진/가림/출처. 00 별도 mock PDF3쪽. 최종 full native6 여정은 #751 receipt로 별도 확정 |
| A12 | 각 PR bun ci·quick/build·관련 회귀·정확 head CI·리뷰 | 전원/00 | 각 제품 PR PASS·정상 순차 병합, 위 exact head/run 참조. 최종 탐색/인수 docs PR의 exact CI·병합 SHA도 #751에 기록. 실패한 apt/legal/대비 관측을 보존 |
| A13 | 최종 main SHA 수동 validate:full·동일 SHA preview 규칙 | 00 | 첫96ff935의 full42453874134 FAILURE(browser)/join SKIPPED, preview42454227087 SUCCESS 보존. 후속768/770/769 수리·CI/선택회귀 정상 병합. 이 인수 문서까지 병합한 마지막 SHA를 다시 고정해 full/core-browser-native/join·동일SHA preview를 수행하며 #751에 actual checkout/SHA/run/receipt·성공 또는 실패 기록. production 배포 없음 |

전후 화면과 새 고객용 본문은 [합성 검증 자료](../quality/app-workspace-rework/README.md)에 모았다.
실제 고객 사건/공급자·공식 법률 API의 새로운 외부 호출, 독립 법률가의 내용 인수, 물리 기기의
한글 IME·접근성 보조기기, production PDF 성능은 이 합성 인수로 완료 처리하지 않는다.
기존 #71은 사용자 범위 정리로 CLOSED/NOT_PLANNED인 실제 상태를 보존하며 이번 성공을
전체 MVP·외부·법률 승인으로 확대하지 않는다.

00은 각 PR diff와 증거를 읽고 필요한 회귀를 수행하며 CI 성공한 정확 head만 정상 순차 병합한다.
main 직접 push/gate 우회는 하지 않는다. 마지막 main의 수동 full은 실제 checkout SHA와 run을
기록한다. preview는 기존 같은 SHA·권한 규칙을 따르며 **이번 작업으로 production에 배포하지 않는다.**
모델/공급자/결제 경로·AI200/일·질문2×3·Workers·gateway/retrieval·권한·동의·암호화·삭제·CAS·
물리/기술 한도·비용 관측 전용은 유지한다. 남은 실제 외부/법률 인수 이슈는 실제 상태로 남긴다.
