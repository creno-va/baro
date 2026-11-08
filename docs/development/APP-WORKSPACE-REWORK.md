# 앱 작업공간·고객용 리포트 개편 통합 계약

## 현재 기준과 소유

- 사용자 지시: 2026-11-08 KST. 통합 담당 BARO-UI-00. 이 문서·EXECUTION·공유 인수표는 00 단독 작성한다.
- 추적 [#751](https://github.com/creno-va/baro/issues/751), shell [#752](https://github.com/creno-va/baro/issues/752), 대화·자료 [#753](https://github.com/creno-va/baro/issues/753), 고객 리포트 [#754](https://github.com/creno-va/baro/issues/754).
- 실제 저장소: `/Users/hwang-eunchan/Desktop/baro/repository`, origin `creno-va/baro`. 사용자 기준 `D:/Project/baro`의 파일 경로는 각 worktree 루트로 치환한다.
- 신규 조사 기준 main `b643069bf9e923e50441c06c22930e9cd646e123`(PR750), main CI41946519596 SUCCESS. 2026-11-08 시작 조회에서 열린 PR/이슈0이었다. 과거 인계 SHA를 최신으로 사용하지 않는다.
- [ADR-0018](../adr/0018-conversation-report-rework.md), [기존 대화·리포트 계약](./CONVERSATION-REPORT-REWORK.md), [현행 비용 정책](../operations/PREBETA-COST-POLICY.md)을 유지한다. 과거 #620~627의 완료·외부 증거를 이번 화면 인수로 재사용하지 않는다.
- 00: `ui-00`, `codex/751-app-workspace-integration`, 포트4300. 01: `ui-01-shell`, `codex/752-app-shell`, 포트4311. 02: `ui-02-chat-materials`, `codex/753-chat-materials`, 포트4322. 03: `ui-03-reports`, `codex/754-customer-reports`, 포트4333. 다른 이름을 실제 등록하면 이 표를 정정한다.
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

`tests/helpers/report-*`, `reports-*`와 리포트 browser 파일은03 소유다. workspace/conversation/attachments
테스트·fixture는02 소유다. shell 전용 신규 fixture는01 소유다. 공통 config·package·lock·contracts·
design-tokens·migration은 현재 미배정이므로 변경 필요를00에 제안한다. 각 담당은 시작·브랜치와
주요 단계에 정확한 SHA/PR/파일/검증/남은 조건을 이슈와00에 인계한다. 배포·타 담당 병합은00만 수행한다.

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
`onStateChange?: (state: ConversationState) => void` callback으로 부모에 전달해 자료 하단에
표시할 수 있다. 공유 DTO 변경 없이 기존 state 타입을 재사용한다. 별도 무조건 polling은 금지다.
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

앱 전용 기본 토큰은 white main, slate50 sidebar, slate200 border, slate950/600 text, 기존
blue600 primary를 참조한다. Pretendard 유지. 본문16px/1.7, 보조13–14px/1.5, 작은 사건 제목
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
| 사진 배치·제외/가림·식별정보·PDF/HTML/기존다운로드 | 리포트 작업 메뉴와 기존 선택·저장·내보내기. 같은 저장 snapshot 기준 내용/사진/출처 일치 |
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

아래 표의 미검증은 실제 작업 완료 뒤 정확한 SHA/환경/결과로 바꾼다. 합성 기능 검증과 실제
OAuth·공급자·공식 법률 API·remote storage·독립 법률 인수는 별개다. 과거 성공을 이번 결과로 복사하지 않는다.

| ID | 시나리오/검사 | 담당 | 현재 결과 |
| --- | --- | --- | --- |
| A01 | 새 사건→2×3 이하 질문·요약 확인→중앙 대화 | 02/00 | 미검증 |
| A02 | 업로드→검토·교정→선택 자료 대화 반영·실패/재시도 | 02/00 | 미검증 |
| A03 | 자료 panel→리포트→목차/근거 이해·편집·사진/가림·저장·다운로드→대화 | 03/00 | 미검증 |
| A04 | 고객/변호사·직접 URL·새로고침·뒤로·재접속·owner/동의 변경 | 01/02/03 | 미검증 |
| A05 | panel/resize 중 입력·선택·교정·업로드/작업·편집 유지 | 02/03 | 미검증 |
| A06 | 상태 조회 false dirty·저장 지연·늦은 응답/충돌 덮어쓰기 방지(PR743/747/749 보존) | 03 | 미검증 |
| A07 | 320/390/768/1024/1440·keyboard/IME·긴 제목/파일명·200%·focus | 전원 | 미검증 |
| A08 | 6개 탭 제거·전 기능 새 진입·기존 URL 보존 | 00 | 미검증 |
| A09 | 랜딩/로그인 전후 시각·스타일 import 경계 | 01/00 | 미검증 |
| A10 | 청구/대응·자료 없음/상충·불완전 분석·절차 미확인·stale, 고객 내용 전후 | 03/00 | 미검증 |
| A11 | 같은 저장본 웹/HTML/PDF 본문·사진·출처·한글 전페이지 시각 | 03/00 | 미검증 |
| A12 | 각 PR bun ci·quick/build·관련 회귀·정확 head CI·리뷰 | 전원/00 | 미검증 |
| A13 | 최종 main SHA 수동 validate:full·동일 SHA preview 규칙 | 00 | 미검증 |

00은 각 PR diff와 증거를 읽고 필요한 회귀를 수행하며 CI 성공한 정확 head만 정상 순차 병합한다.
main 직접 push/gate 우회는 하지 않는다. 마지막 main의 수동 full은 실제 checkout SHA와 run을
기록한다. preview는 기존 같은 SHA·권한 규칙을 따르며 **이번 작업으로 production에 배포하지 않는다.**
모델/공급자/결제 경로·AI200/일·질문2×3·Workers·gateway/retrieval·권한·동의·암호화·삭제·CAS·
물리/기술 한도·비용 관측 전용은 유지한다. 남은 실제 외부/법률 인수 이슈는 실제 상태로 남긴다.
