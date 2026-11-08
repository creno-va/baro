# BARO 웹 전면 개편 실행 계약

- 결정일: 2026-11-08 KST. 근거: 현재 총괄 채팅의 사용자 직접 지시.
- 기준 main: `7236c14f88f21a64c5fe916a90779d7c238fff6d`.
- 총괄: `redesign-00` / `codex/764-redesign-integration`.
- 추적: [#764](https://github.com/creno-va/baro/issues/764), [미병합 기획 PR765](https://github.com/creno-va/baro/pull/765).
- 상태: 조사·설계 계약 확정, 제품 마이그레이션·통합 인수는 진행 중. 이 문서는 완료 증거가 아니다.

## 결정의 우선순위와 구현 경계

이번 직접 지시는 기존 DS 유지, 랜딩·로그인 제외, 고정 오른쪽 패널과 이전 세 탭 제약을 대체한다.
사용자의 네 경로·문서/설명 진입·중복 없는 질문·지속 리포트·작성 보존은 제품 목표다.
기획 PR765 head `9ca3c0ad94bd8375a6129d66b135cbb54723e6ea`의 ADR0019는 초기 연결 기능 제외와
기존 계정 일반 이용에 관한 Accepted 결정이고, ADR0020의 새 admission·작업 중 보관·drafts URL은
Proposed다. 그 문서 전체를 구현 완료나 새 API/DB 승인으로 취급하지 않는다.

기존 strict DTO·암호화·owner/CAS·원문/출처·리포트 버전·삭제·Workers 경계는 유지한다.
AI200/일·질문 최대2×3·실제 기술 한도와 비용 관측 전용·원장/hold는 유지한다.
모델은 llm-gateway, 법률 API는 legal-retrieval 경계에서만 호출한다.
새 backend/storage 계약이 필요한 항목은 근거·최소 대안을 준비해 사용자 결정에 올린다.
실제 지원하지 않는 자동 저장·초안 PDF/DOCX 출력·외부 연결은 UI에 제공한다고 표시하지 않는다.

열린 [PR772](https://github.com/creno-va/baro/pull/772) head `02b4769fbd990153333d2d0de394a5047658f8b0`는
이전 UI polish 작업이다. main에 포함되지 않았고 01~04 소유 파일이 겹친다. 자동 병합하지 않는다.
각 담당이 필요한 기능 수정만 근거와 테스트를 확인해 재사용하고 중복 CSS는 새 DS로 교체한다.
기존 checkout·secret·합성 fixture·과거 실패/성공 receipt는 보존한다.

## 조사에서 확인한 문제

AppLayout은 product/app-experience/product-refresh/app-workspace CSS를 순서대로 가져온다.
BaseLayout의 global/shell 값과 domain 스타일도 겹친다. 같은 버튼·표면·본문 폭이 import 순서에
의존하며 공통 토큰 생성기는 최종 CSS cascade와 다른 원시값을 읽는다. native가 생성 토큰을
소비하므로 구 파일 삭제 전에 producer·consumer 영향부터 확인한다.

현재 대화·리포트는 별도 Astro 페이지다. 같은 트리의 자료 모달은 상태를 보존하지만 페이지
이동은 미전송 문장·미업로드 File·초안·커서를 자동 보관하지 않는다. beforeunload 경고를 보존
성공으로 취급하지 않는다. 리포트가 자료 패널 하단과 사건 도구에 묶여 주 작업으로 찾기 어렵다.
생성 첫 화면은 준비/대응만 저장하며 준비를 고소로 표시해 민사 목적과 불일치한다.
문서 추출·상대 주장·사용자 확인·분석 완료는 서로 다른 상태다.
변호사 액션은 현재 자료 조회·선택 저장·목록 연결을 포함하므로 지정 모달로 교체해야 한다.
로그인 role을 customer로 고정하면 기존 계정 role을 바꿀 수 있어 공통 로그인 보존 처리가 선행한다.

현재 화면 실제 검토와 경로별 문제 증거는 05의 독립 검수 기록과 아래 인수표에 연결한다.

## 네 경로의 핵심 과업

| 경로 | 사용자가 아는 것 / 부족한 것 | 우선 과업 |
| --- | --- | --- |
| 민사 준비 | 약정·손해·원하는 해결 / 금액·이행·증거의 공백 | 요구와 사실·근거·공백 연결, 가능한 문서의 준비 조건 확인 |
| 민사 대응 | 받은 주장·연락 / 문서 종류·상대 주장과 다른 설명 | 문서 없이도 경위 시작, 상대 주장과 본인 설명 비교 |
| 형사 고소 준비 | 경험·피해·자료 / 추정과 직접 확인의 차이 | 행위·시간·근거 위치 정리, 미확인 쟁점 드러내기 |
| 형사 대응 | 통지·알려진 주장 / 절차·확인된 범위 | 소장/고소장 강요 없이 설명, 아는 범위와 미확인 구분 |

기존 casePurpose는 prepare/respond, procedure.kind는 civil/criminal 등을 지원한다.
새 enum 네 개를 추가하지 않는다. create는 narrative 필수이며 문서만 입장과 질문 전 자료 반영은
02가 실제 API와 prompt까지 확인한 후 가능 범위/미결을 보고한다. 문서에서 나온 정보를 사용자에게
다시 입력시키지 않는다. 추출 교정·요약 확인은 새 질문과 명확히 구분하고 실제 질문 한도를 유지한다.

## 정보 구조 비교와 선택

| 안 | 구성 | 장점 | 비용/판단 |
| --- | --- | --- | --- |
| A 대화 중심 | 대화가 항상 중앙, 리포트/초안을 작업 전환하고 자료는 공통 보조 패널 | 대화 흐름이 짧고 기존 골격 재사용 쉬움 | 자료 비교·대량 검토가 보조 기능에 갇힘. 패널을 닫으면 구조 인지가 약함 |
| B 사건 작업대 | 대화·자료·리포트·문서 초안 네 작업 진입을 상시 노출, 근거는 필요할 때 펼침 | 자료를 주 작업으로 다루며 리포트/초안과 동등하게 왕복, 좁은 화면에서도 예측 가능 | retained view와 직접 URL 호환을 명시해야 함 |

**B를 선택한다.** 네 개의 기능을 복제하지 않고 기존 기능의 진입·배치를 정리한다.
목차·사실·타임라인·다음 행동·판례는 본문 근거/사건 도구에서 유지한다. 모든 항목을 가로 탭으로
늘리지 않는다. 리포트와 초안은 자료 패널 밖에서도 항상 찾을 수 있다.
초안은 기존 리포트의 실제 영역(`#document-drafts`)을 사용하며 새 `/drafts` route를 만들지 않는다.

### 대표 데스크톱 1440×900

왼쪽 232px: BARO·새 사건·최근 사건, 하단 설정·도움말·계정. 변호사 탐색/관리 메뉴 없음.
상단: 사건 제목(긴 제목 완전 노출), 현재 단계·실제 준비 상태. 그 아래 네 작업 진입.
대화: 최대48rem, 답변의 근거/미확인 표시, 미전송 입력과 첨부는 하단 composer.
자료: 목록과 선택 자료 상세를 위한 비교 폭 최대76rem. 파일명·처리 범위·교정/현재성 구분.
리포트: 읽기 최대48rem와 좁은 목차, 버전·미반영/분석 제한은 제목 가까이. 본문 다음 세 액션.
초안: 기준 리포트·부족 항목·검토 상태, 본문/검토 항목, 명시 저장·현재 지원 TXT 출력.
근거 열기: 필요할 때 320~360px 보조 영역. 읽던 위치와 편집을 유지하며 자동 생성/저장 없음.
화면이 넓어져도 본문은 무제한으로 늘어나지 않는다.

### 대표 모바일 390×844와 최소320px

상단 메뉴·사건 제목, 네 작업은 읽을 수 있는 줄바꿈/스크롤 없는 2×2 또는 동일 의미의 compact nav.
주 본문 한 열, 좌우16px(320에서는12~16px), 본문16px·행간1.75~1.8.
자료/근거는 단일 sheet·명확한 닫기. 중첩 dialog는 가장 안쪽부터 닫고 opener 초점 복귀.
목차는 본문 앞 disclosure. 도구와 저장을 서로 다른 위치에 중복 강조하지 않는다.
가상 키보드·visualViewport·safe area에서 composer와 중요 action이 가려지지 않아야 한다.
200%에서 desktop 열 수를 유지하지 않고 한 열로 reflow한다.

## DS와 컴포넌트 계약

01은 `docs/design/FOUNDATION.md`에 실제 API·예시·토큰과 상태 preview를 확정한다.
기존 Pretendard/Lucide와 설치된 React 도구를 사용하며 새 라이브러리·폰트를 추가하지 않는다.
색상은 표면/본문/보조/테두리/강조/오류/주의/성공 의미로 구분한다. 확실성은 색 하나로 표현하지 않는다.
본문16/1.75~1.8, UI14~15/1.5, 주요 제목24~28, 간격4/8/12/16/24/32를 대표 화면에서 검증한다.
장식용 카드 중첩·큰 그림자를 줄이고 목록·구분선·선택 상태로 정보 밀도를 확보한다.
주요 조작은44px 이상, focus visible·contrast·disabled 이유·reduced motion을 보장한다.

| API | 규칙 |
| --- | --- |
| Button/ButtonLink | 행동과 이동 구분, primary/secondary/ghost/danger. 한 작업의 주요 액션만 강조 |
| Input/Textarea/Select/Label | label·설명·오류 연결. pending 때 입력값 유지, 실패·부분 성공은 명시 |
| PageHeader/Section/ReadingContent | 같은 제목 위계와 폭. domain별 독자 헤더/카드 복제 금지 |
| StatePanel/InlineNotice/Badge | loading/empty/partial/error/retry/blocked/selected를 일관되게 표현 |
| Dialog/Sheet | native modality·Escape·busy dismissal·opener focus·resize 보존 |
| CaseNavigation | 기존 caseId/title/active 호환. 네 작업 상시 진입과 선택적 onNavigate callback |
| CaseWorkspaceFrame | conversation/document/compare 밀도와 공통 근거 영역, scroll 책임 명시 |

기존 portable token 키/값과 native 출력은 우선 보존한다. 웹 DS를 교체하면서 기존 native를
의도치 않게 재디자인하거나 generated 파일만 수작업 수정하지 않는다.

## 화면 이동과 작성 보존

대화/자료/리포트/초안은 같은 사건의 같은 React owner에서 최초 방문 시 mount하고 이후 보존하는
방향으로02/03이 통합한다. `ReportReview`의 기존 embedded API를 재사용한다.
숨김 화면은 tab/focus 접근에서 제외하고 불필요한 polling을 제어하며 owner 상실은 즉시 purge한다.
선택 작업/스크롤/본문·사진·가림·미전송·선택 File·초안 검토 상태를 작업 전환으로 reset하지 않는다.
열기/목차/읽기/다운로드는 새 모델·법률 실행이나 reviewed receipt 생성이 아니다.

기존 직접 URL과 새로고침은 유지한다. 메모리 보존을 새로고침 후 영구 보관이라고 표시하지 않는다.
다른 사건/전체 페이지 이동에는 현재 미보관 내용을 명확히 알리고 머무르기를 기본으로 한다.
미업로드 File을 자동 업로드·전송하거나 파일명만 복구해 성공이라고 표시하지 않는다.
계정 전환·로그아웃·삭제·권한 상실 시 이전 owner 데이터가 새 owner에게 보이지 않아야 한다.
자료 교정·리포트 편집·canonical 사실 반영은 별개이며 늦은 응답으로 새 편집을 덮지 않는다.

## 전체 웹 경로 마이그레이션과 소유권

| 경로/파일 | 담당 | 완료에 필요한 동작 |
| --- | --- | --- |
| layouts/**, styles/**, components/ui/**, workspace/CaseNavigation | 01 | canonical DS·shell·반응형·공통상태·구스타일 정리 |
| /app, /cases, /cases/new | 02 | 시작 가치·네 경로 의미·빈 목록/실패/삭제, 문서/설명 실제 지원 범위 |
| /cases/:id, /intake, /summary | 02 | 대화·질문/확인 구분·입력 보존·재확인 |
| /cases/:id/files,/timeline,/actions,/precedents | 02 | 자료 주 작업·근거/교정·이전 기능/직접 URL·비교 |
| /cases/:id/reports, 초안 실제 내부 영역 | 03 | 지속 리포트·편집/버전/출처·세 액션·검토 저장/TXT |
| /, /login,/consent,/settings,/help | 04 | 새 DS 진입·기존 계정/동의/삭제권·지원 상태 |
| /policies/terms,/privacy,/ai, /ai-notice alias | 04 | 읽기·목차·본문 불변·실제 alias 유지 |
| /lawyer,/lawyers,/lawyers/:id | 04 | 연락/탐색/전용UI 종료 안내·공통 사건 이용, 데이터 권리 보존 |
| 알 수 없는 URL | 04 | 실제 Astro404 fallback, 가짜403/500 routing 없음 |
| client/api/session.ts, return-path와 관련 인증 테스트 | 총괄 | 로그인 기존 role 보존·신규 일반 이용, 새 endpoint 없음 |
| 독립 합성 acceptance·증거 | 05 | 현재 문제→통합 정확SHA 실제 과업, 제품코드 수정 없음 |

02는 components/intake/**, workspace/**(CaseNavigation 제외), components/analysis/**와 해당 단위/브라우저 테스트를 소유한다.
03은 components/reports/**, resolution/**와 해당 테스트·기존 리포트 fixture를 소유한다.
04는 components/{AuthButtons,ConsentForm,AccountSettings,FoundationStatus,PolicyDocument}와 landing/**,
lawyers/** 및 해당 테스트를 소유한다. 정책 원문/버전/receipt는 수정하지 않는다.
01은 token producer/checker와 tests/design-tokens, 신규 foundation fixture/e2e,
astro.config의 test-only injectRoute 추가를 소유한다. 설정의 다른 부분 변경은 총괄 조율한다.
05는 새 tests/browser/redesign-acceptance.{e2e,config}.ts, tests/helpers/redesign-*,
docs/quality/redesign-acceptance/**만 소유한다. 기존 테스트 수정은 해당 담당에게 요청한다.
제품·ADR·실행·의존성·충돌은 총괄, FOUNDATION.md는01, 독립 검수 기록은05가 소유한다.
공유 client/contracts/server/DB·lock은 명시 재배정 전 수정하지 않는다.

지정 세션: 01 `01a1baa9-2cbb-7cb0-a815-35ba474d3797`, 02 `01a1baa9-800a-7542-b8bc-400f84c15709`,
03 `01a1baa9-cb75-7fc1-8384-c68949dbbdd7`, 04 `01a1baaa-0588-7c01-8563-e59d95e93d52`,
05 `01a1baaa-4abb-7261-8bb4-e1dd5910615e`。사용자가 개설한 이 세션만 메시지로 조율한다.

## PR 순서와 구 스타일 제거

1. 총괄 계약·인증 보존 선행 변경, 05 현재 문제 수집.
2. 01 공통 기반 PR: 확정 API·실제 대표 화면·native 소비 검증·CI. 소비자에게 정확 head 인계.
3. 기반 PR CI·리뷰 후02~04가 같은 exact head를 stacked base로 적용한다. 필요한 독립 모달·fixture는 먼저 준비 가능.
   이번 사용자 지시의 공통 기반 준비·계약 확정 순서를 따른다. main 병합 권한을 확대하지 않으므로
   과거 main 병합 선행 지침 대신 검증된 공통 head를 로컬 통합 브랜치와 stacked PR에서 공유한다.
4. 02/03 같은 트리 작업 전환을 공동 검증한 뒤 담당 PR 순차 통합, 04 공통 진입·종료UI 통합.
5. 01이 모든 소비 경로 grep/build 후 이전 cascade와 중복 공통 구현 제거. PDF 출력 CSS와 native 소비 보존.
6. 총괄이 정확 통합 SHA를 고정해05 독립 과업·필수 quick/build/관련 회귀 검증, PR/잔여 기록.

이번 요청에서 병합·배포 권한을 새로 확대하지 않는다. 검증된 PR을 제출하며 main/prod 완료로
표시하지 않는다. 새로운 채팅·에이전트·Goal·자동화를 만들지 않는다.

## 인수표

| ID | 필수 인수 | 현재 결과 |
| --- | --- | --- |
| R01 | 모든 경로·상태·DS/API·반응형 적용 목록 | 조사/계약 작성, 제품 검증 대기 |
| R02 | 네 경로·문서 없는 대응·추출 확인과 중복 질문 구분 | 실제 API 지원 범위 감사 중 |
| R03 | 대화·File 선택→자료/리포트/초안 왕복·스크롤/편집 보존 | 구현 대기 |
| R04 | 리포트가 항상 진입 가능, 읽기만으로 생성/저장0 | 구현 대기 |
| R05 | 세 액션 유지; lawyer 지정 문구/확인·network0·선택/편집 유지·focus | 현재 결함 확인,03 수정 중 |
| R06 | 기존 lawyer계정 일반 이용·데이터/권리·신규로그인 role 보존 | 인증 경계 감사 중 |
| R07 | 부분 분석/출처 실패·stale/CAS/계정전환/삭제·늦은응답 | 기존 회귀 보존, 통합 검증 대기 |
| R08 | 320/390/768/1024/1440/1920·200%·keyboard·긴본문 | 독립 기준선 수집 중 |
| R09 | bun ci·quick·build·필요 회귀·정확 SHA/PR CI | baseline ci/work:next PASS, 제품 변경 후 재검증 |
| R10 | unused CSS/중복 제거·native/PDF 영향 확인 | 01 소비 감사 중 |

실제 OAuth·모델·공식 법률 API·remote 저장·물리 IME·독립 법률 검증은 합성 인수와 구분한다.
검증된 SHA·명령·결과·artifact·PR 링크를 후속 기록하며 캡처만으로 과업 성공을 선언하지 않는다.

## 토스 공식 자료에서 적용한 원칙

아래는 외형 복제가 아니라 BARO 과업에 대한 설계 해석이다.
[가치 전달 원칙](https://toss.tech/article/value-first-cost-later)은 입력 전에 정리할 수 있는
결과와 다음 단계를 구체적으로 설명하는 데 적용한다. 불확실한 결과를 확정 예시로 위장하지 않는다.
[라이팅 원칙](https://toss.tech/article/21022)은 다음 행동을 예측할 수 있는 버튼과
이해할 수 있는 사용자 언어, 중복 안내 제거에 적용한다. 법적 근거·불확실성은 남긴다.
[공식 TDS 소개](https://tossmini-docs.toss.im/tds-react-native/)는 화면마다 같은 상태·동작의
공통 API를 사용하는 기준으로 참고한다. 색·브랜드·화면·패키지를 복제하지 않는다.
