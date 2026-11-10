# 앱 공통 shell 사용

현재 UI 정본은 `docs/design/CASE-WORKBENCH.md`와 #795/#797이다. `/new`와 사건 화면은 같은 밝은 CaseWorkbenchLayout과 사이드바를 사용한다. 새 사건 본문 배치와 공개/로그인 시각 구성은 유지한다. `/app`은 인증·동의 경계를 거쳐 `/new`로 연결한다. 내 사건 목록 메뉴는 없으며 최근 개별 사건 링크는 유지한다.

`AppLayout.astro`는 기존 props를 유지하고 `[data-app-workspace]` 아래에서만 새 토큰을 적용한다.
AppNavigation island는 세션·최근 사건·역할·이름 변경/삭제·로그아웃을 독립적으로 소유한다.
다른 island와 React context를 공유하지 않는다. `baro-sidebar-collapsed`는 표시 취향만 담는다.

```tsx
import { CaseWorkspaceFrame } from '../ui/workspace-frame';
import { CaseNavigation } from '../workspace/CaseNavigation';

<CaseWorkspaceFrame
  kind="conversation"
  header={<CaseNavigation caseId={caseId} title={title} active="chat" />}
  panel={<MaterialsPanel /* 기존 state/query/mutation을 재사용 */ />}
  panelOpen={materialsOpen}
  onPanelOpenChange={setMaterialsOpen}
>
  <ConversationContent />
</CaseWorkspaceFrame>
```

`CaseWorkspaceFrameProps`:

| prop | 타입·기본값 | 책임 |
| --- | --- | --- |
| header / children | ReactNode, 필수 | 같은 React island의 헤더·중앙 본문 |
| panel | ReactNode, 선택 | 미제공 시 toggle과 panel 없음 |
| panelOpen | boolean, false | 소비자가 관리하는 열림 상태 |
| onPanelOpenChange | (open: boolean) => void, 선택 | toggle·Escape·바깥 클릭의 닫기 요청; 미제공 시 toggle 비활성 |
| panelLabel | string, 자료 | toggle 이름과 panel 제목 |
| panelId | string, case-materials-panel | aria-controls·label 연결; 한 문서에 여러 frame이면 각각 지정 |
| kind | conversation / document / compare, conversation | 뷰포트 작업공간 / 일반 문서 스크롤 |

panel은 항상 같은 React 트리에 남는다. 닫힌 native dialog는 화면·키보드 탐색에서 제외되지만
하위 입력·상태는 unmount하지 않는다. 1200px 이상에서는 non-modal inline, 그 아래는 같은
DOM을 `showModal()`로 전환한다. 내부 dialog의 Escape는 외부 패널을 닫지 않는다. resize 중
교정 필드의 값·선택·초점을 보존한다. 별도 sibling 또는 내부 descendant native modal이 열려 있으면
panel mode 전환은 해당 modal의 native close가 끝날 때까지 보류한다. 기다리는 dialog 자체에
일회성 close listener를 두므로 조건부 unmount로 DOM에서 제거돼도 재동기화하며, effect cleanup은
남은 listener를 모두 해제한다. 다른 dialog를 닫거나
재열지 않으며, 실제 현재 폭에 맞춰 한 번 동기화한다. 닫으면 opener로 복귀하고 sidebar drawer를 desktop으로
전환해 닫는 경우에는 보이는 사이드바 버튼으로 돌아간다.

`CaseNavigation`은 기존 `caseId,title,active,fileCount?`와 `actions?: ReactNode`를 받는다.
API는 호출하지 않는다. 실제 title/snapshot은 소비자가 전달한다. 상단 리포트는 별도 페이지로 연결하고,
사건 도구는 요약/타임라인/다음 행동/판례/자료/리포트 링크를 보존한다. 대화의 우측 패널은
CaseContextPanel이 실제 상태를 바탕으로 지금 확인/자료/판례를 제공하며 교정 뷰어는 같은 owner에 남는다.

## 크기·스크롤 적용

- Desktop >=1200: sidebar248~356px, 우측330~388px, 중앙 minmax(0,1fr).
- Tablet768–1199: 왼쪽 사건 목록 유지, 우측은 modal overlay.
- Mobile<768: 상단52px + 메뉴 drawer, 중앙 우선, 자료 overlay.
- 사건 DS는 `--wb-reading:920px`, `--wb-panel-width:330~388px`, primary#2364e8을 쓴다.
  `CaseWorkbenchLayout`의 `.baro-workbench` 아래에서만 적용하고 AppLayout 기본값과 native 토큰은 보존한다.
- `case-workspace__header`: 작은 헤더와 toggle; 메뉴가 본문 위에 그려진다.
- `case-workspace__body`: 중앙/패널 grid; min-width/min-height0.
- `case-workspace__content`: conversation에서 overflow hidden. 소비자가 높이100%인 grid를 만들고
  `minmax(0,1fr)` 메시지 영역에 overflow:auto, 마지막 행에 composer를 둔다. 바깥 fixed composer는 쓰지 않는다.
- `case-workspace__panel-content`: 독립 overflow:auto; 소비자는 자체 sticky 리포트 footer를 넣을 수 있다.
- conversation frame이 `visualViewport.resize`에서 앱 루트의 `--app-viewport-height` 한 값을 갱신한다.
  root computed CSS zoom으로 한 번 환산하며 visualViewport.scale로 다시 나누지 않는다. root style/class
  변경과 resize를 관측하되 값이 달라질 때만 별도 앱 루트에 쓴다. body/HTML style은 변경하지 않는다.
  fallback은100dvh다. 기존 탭 높이·composer 높이를 빼는 `--chat-panel-height` 계산은 제거한다.
- AppLayout main은 conversation opt-in에서만 viewport grid를 쓰며 CaseLayout 고지는 마지막 자동 행이다.
  문서·리포트는 기본 body 스크롤을 유지한다. document frame에 목차/읽기 본문을 조립하고 필요한 작업바만 sticky한다.

02는 Workspace의 기존 state·조회·권한/CAS·자료 교정·업로드를 유지해 frame을 소비한다.
03은 `kind="document"`, header=CaseNavigation, 중앙에 목차·긴 문서·편집/저장을 조립한다.
순수 shell에는 리포트 상태 polling/새 분석·생성·저장을 추가하지 않는다. 리포트 primary URL은
`/cases/:id/reports?mode=conversation`이며 기존 `/reports`는 기존 snapshot 읽기 경로로 유지한다.

## 검증 명령

```sh
bunx playwright test --config tests/browser/app-workspace.config.ts
BARO_INTEGRATION_URL=http://127.0.0.1:4311 bunx playwright test --config tests/browser/app-workspace-app.config.ts
```

첫 명령은 독립 합성 fixture4312를 시작하며 DB·외부 API를 사용하지 않는다. 두 번째는 실제
Astro + 명시적 mock API dev 서버를 사용한다. 기본 실행은 기존 integration config의4340을
따른다. 실제 iOS/Android 가상 키보드 인수와 합성 Chromium visualViewport 회귀는 구분한다.

현재 공유 API·읽기·상태·마이그레이션은 [FOUNDATION](../../../docs/design/FOUNDATION.md)을 따른다.
