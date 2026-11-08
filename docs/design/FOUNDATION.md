# BARO 공통 디자인 기반

조사 기준: main `7236c14f88f21a64c5fe916a90779d7c238fff6d`, 2026-11-08.
공통 파일 담당은 01이며 총괄의 정보 구조·대표 화면 계약을 구현 기준으로 삼는다.
이 문서는 토큰·컴포넌트·읽기·공통 레이아웃의 소비 계약이다. 새 API/DB/자동 저장을 정의하지 않는다.

## 결정과 조사 경계

- 사용자 직접 지시는 기존 DS 유지 제약을 대체한다. 네 사건 경로와 대화/자료/리포트/초안의 반복 이동을 지원한다.
- [문서 PR765](https://github.com/creno-va/baro/pull/765) head `9ca3c0ad94bd8375a6129d66b135cbb54723e6ea`의 ADR0019는 Accepted 제품 경계다. ADR0020의 새 route·입력 admission·작성 중 보관·출력 계약은 Proposed이며 이 기반에서 구현하지 않는다.
- 기존 인증/권한/CAS/삭제/저장·출처/버전·질문2×3·AI200/일·비용 관측 전용 정책을 유지한다.
- [별도 UI PR772](https://github.com/creno-va/baro/pull/772)은 독립 작업이다. 기반에 무조건 합치거나 작성 중 변경을 덮지 않는다.

## 기존 소비 경로와 교체 이유

| 진입점 | 현재 역할 | 문제/전환 경계 |
| --- | --- | --- |
| BaseLayout → global.css | 폰트, 기본 의미 토큰, 리셋, UI, 구 랜딩/인증 | UI와 페이지 규칙이 섞임. 공개 경로 영향 확인 필요 |
| BaseLayout → shell.css | root 토큰 재정의, 앱 shell, 로그인 | native producer 원시값과 실제 웹값이 다름 |
| AppLayout → product.css | product 토큰·도메인별 override | portable 토큰의 producer이므로 무검토 삭제 금지 |
| → app-experience.css | shell·컨트롤·애니메이션·도메인 | 뒤의 두 파일에서 다시 덮음 |
| → product-refresh.css | 도메인·일부 공통 override | 제목/다이얼로그/읽기 규칙 중복 |
| → app-workspace.css | 최종 shell·패널·일부 도메인 override | 공통4파일 약2,950줄, specificity와 import 순서에 의존 |
| 화면별 CSS | 자료·리포트·편집·검색·설정 등 | 공통을 재정의하지 않고 내용/배치만 소유하도록 전환 |

`CaseWorkspaceFrame`은 단일 mounted panel을 데스크톱 inline dialog/작은 화면 modal로 전환한다.
resize 도중 열려 있는 자료 교정 모달 위에 재등장하지 않는 동작, 원래 필드의 focus/selection,
대화 visualViewport/CSS zoom 높이 계산은 기존 회귀 증거를 보존한다.

## 공식 자료에서 적용할 원칙

- [토스 UX Writing 인터뷰](https://toss.im/tossfeed/article/uxwriter-interview): 공통 언어와 컴포넌트별 문구 규칙을 함께 관리한다. BARO에서는 생성/갱신/저장/열기/내려받기를 구분하고 실제 지원하는 동작만 이름 붙인다.
- [좋은 에러 메시지를 만드는 6가지 원칙](https://toss.tech/article/21021): 상황·이유·다음 행동을 설명하고 심각도에 맞는 컴포넌트를 고른다. BARO에서는 일부 자료만 처리된 경우 성공 자료를 유지하며 실패 자료의 복구를 가까이 둔다.
- [TDS로 UI 쌓기 공식 발표](https://static.toss.im/slash21/pdf/%5B%ED%86%A0%EC%8A%A4_SLASH%2021%5D%20TDS%EB%A1%9C%20UI%20%EC%8C%93%EA%B8%B0%2C%20%EA%B7%B8%20%EB%A7%8E%EB%8D%98%20%EC%BD%94%EB%93%9C%EB%8A%94%20%EB%88%84%EA%B0%80%20%EB%8B%A4%20%EC%B9%98%EC%9B%A0%EC%9D%84%EA%B9%8C_%EB%B0%95%EB%AF%BC%EC%88%98.pdf): 반복 요소를 제품 공통 언어로 만든다. 외형·브랜드를 복제하지 않고 같은 의미의 동작과 상태가 같은 API를 쓰도록 적용한다.

## native 계약과 사용자 설정

`scripts/design-tokens.ts`는 product.css/global.css를 읽고 `packages/design-tokens/src/index.ts`를 생성한다.
`apps/mobile/src/theme/tokens.ts`와 native UI가 이 값을 소비한다. color의15개 키,
radius.card, control.minimumSize의 이름/숫자 타입을 유지한다. native의48dp 최소 제어,
OS font scaling·safe area·keyboard 동작과 플랫폼별 글꼴은 별도 소유다.
생성물을 수동 편집하거나 native 소비가 없다고 가정해 producer를 없애지 않는다.

웹의 `baro-sidebar-collapsed` localStorage 선택과 새로고침 뒤 적용을 유지한다.
OS reduced-motion, browser zoom, CSS zoom, 키보드 입력/포커스 표시도 유지한다.
설정 기능을 시각 정리 목적으로 삭제하지 않는다. 폰트는 기존 self-hosted Pretendard Variable,
아이콘은 기존 Lucide, dialog는 native backend, React19/Tailwind4/CVA를 재사용한다.
새 라이브러리와 폰트 도입은 없다.

## 공통 API

총괄의 사건 작업대 계약을 적용한다. 기존 API의 기본값은 호환 유지한다.

| API | 의미/소비 규칙 |
| --- | --- |
| Button / ButtonLink | 실행/이동 구분. loading은 중복 실행을 막고 동작 이름을 유지. 한 과업 영역의 primary는 하나 |
| Input / Textarea / Select / Label / FieldDescription | visible label 필수. 설명/오류는 id+aria-describedby로 연결, invalid는 색과 문구 동시 제공 |
| Tabs | 같은 페이지 안의 내용 선택만 사용. 화살표 focus, Enter/Space activation. 페이지 이동은 link navigation |
| Dialog / Sheet | controlled open. Escape/닫기 요청을 owner에 전달하며 owner의 busy 거절을 보존. returnFocusRef 지원 |
| PageHeader / Section | 페이지·본문 절의 제목/설명/관련 행동. 제목은 잘라 숨기지 않고 좁은 화면에서 자연 줄바꿈 |
| StatePanel / InlineNotice | loading/empty/error/limit/permission/pending와 partial/success. partial은 완료한 결과와 다음 복구를 함께 표시 |
| ReadingContent / SourceReference / TableScroll | 긴 본문·출처·표의 읽기 규칙. 의미/출처를 숨기지 않고 표 영역만 가로 스크롤 |

`CaseNavigation`은 `CaseTask = 'chat' | 'files' | 'reports' | 'drafts'`와
선택적 `activeTask`, `onNavigate(task)`를 제공한다. callback이 있으면 수정키 없는 클릭만
같은 React owner의 작업 전환으로 전달한다. href는 기존 사건/자료/리포트와
`reports#document-drafts`를 유지해 새 탭·주소 복사·직접 URL을 보존한다.
기존 `active`, `caseId`, `title`, `fileCount`, `actions`도 유지한다.
hidden/inert·owner fence·작성/선택/스크롤 보존과 작업의 실제 실행은 도메인 owner 책임이다.

```tsx
import { ReadingContent, TableScroll } from '../../components/ui/reading-content';
import { Section, ActionGroup } from '../../components/ui/section';
import { InlineNotice } from '../../components/ui/inline-notice';

<ReadingContent>
  <Section title="사건 준비 리포트" description="저장한 버전과 아직 반영되지 않은 내용을 확인해요.">
    <InlineNotice tone="warning" title="추가 자료가 아직 반영되지 않았어요">
      완료한 결과는 유지됩니다. 자료 검토 후 갱신을 실행하세요.
    </InlineNotice>
  </Section>
  <Section title="확인한 내용">{validatedBody}</Section>
</ReadingContent>
```

`ReadingContent`는 `width='reading'|'wide'|'full'`, `Section`은
`title/description/action/headingLevel(2|3)`와 section 속성을 받는다.
`TableScroll label` 안에는 native table을 둔다. 영역은 키보드로 가로 이동할 수 있다.
목록은 `list.tsx`의 List/ListRow/ListLink/ListTitle/ListMeta를 사용한다.
행의 이동 링크와 삭제/관리 버튼은 형제로 두며, 제목은 완전히 노출하고 상태/수정 시각을 구분한다.
작은 화면에서는 링크 내부의 본문/메타를 한 열로 쌓는다. 전역 탐색의 `내 사건`은 `/cases`로 연결하며
현재 위치, 키보드/축소 rail/모바일 sheet의 같은 접근을 유지한다.
`InlineNotice`의 tone은 neutral/success/warning/danger이며 동적 결과만 `announce`로 알린다.
`StatePanel`의 partial은 완료한 결과와 실패한 항목의 재시도를 함께 표시한다.
단일 확인 모달은 `Dialog showCloseButton={false}`와 명시 확인 버튼을 사용한다.
`onOpenChange`가 busy 거절을 판단하며 실제 저장/삭제 완료를 UI가 추정하지 않는다.

PublicLayout은 `title/description/showStart?`를 받으며 main/skip target·공개 헤더·정책 footer를 소유한다.
페이지에 두 번째 main을 추가하지 않는다. 인증은 `.ui-auth`, provider 그룹은
`.ui-auth-providers`, native checkbox/radio와 문장은 `.ui-check`로 구성한다.
공통 배치는 `.ui-stack`(24px), `.ui-cluster`/ActionGroup(12px,wrap), `.ui-grid`(2→1열),
`.ui-muted`, `.ui-meta`, `.ui-page--reading`을 사용한다.

## 시각·읽기 규칙

`CaseWorkspaceFrame kind='conversation'`의 머리글은 `사건 제목과 작업`이라는 이름의
키보드 스크롤 영역이다. 측정한 viewport에서 상단 탐색을 뺀 높이의 최대50%를 사용하며,
긴 제목과 네 작업의 전체 DOM을 보존한다. Tab으로 영역에 진입해 Home/End로 읽고,
각 링크는 기존 Tab 순서로 접근한다. 키보드 위치는 공통 inset 표시를 사용한다.
대화의 body와 앱 최소 높이는 같은 측정 viewport를 사용해 CSS 확대의 중복 높이를 피한다.
`document`/`compare`의 머리글에는 이 높이 제한·내부 스크롤·Tab 정지를 만들지 않으며
리포트 등 긴 본문은 기존 문서 스크롤을 유지한다.

사건 도구는 같은 native details와 네 링크를 유지하되 메뉴를 viewport에 고정 배치한다.
트리거 좌표를 CSS 배율로 정규화하고 창·visualViewport·머리글 크기·내부 스크롤·root 배율
변화에 맞춰 재배치한다. 고정 상단 탐색·측면 rail이 차지한 영역을 제외하고 트리거의 아래·위
가용 공간을 비교한다. 두 방향 모두 전체 메뉴를 담지 못하면 더 넓은 쪽에서 메뉴만 스크롤한다.
44px 링크 하나와 메뉴 여백도 담지 못하는 낮은 창은 가림 없는 전체 영역 안에서 스크롤한다.
메뉴 자체의 스크롤은 트리거 재배치를 일으키지 않는다. 포커스한 링크는 메뉴 내부에서
완전히 노출하며, 창·root 배율·머리글 스크롤이 바뀌어도 현재 링크의 초점과 조작 영역을 유지한다.
메뉴 안의 Tab/Escape와 트리거 복귀, 기존 href는 그대로다. 실제 브라우저200%에 대응하는
600×350/root CSS zoom1과 더 낮은 창에서도 End→열기→Tab→Escape→재열기의 접근을 유지한다.
CaseLayout의 native label fallback은 낮은 specificity로 유지해 토픽 등 도메인 레이아웃이
공통 기본 간격·display를 명시적으로 교체할 수 있게 한다.

- canonical `global.css`: 의미 토큰, font/reset, 공통 UI/상태/본문/공개 레이아웃.
- canonical `product.css`: 앱 탐색·사건 작업·근거 패널·반응형. AppLayout은 이 파일만 가져온다.
- 표면은 흰색/연한 중립색, 본문은 #191f28, 보조 정보는 #526176, 실행 강조는 #2364e8.
  성공/주의/실패는 문구와 아이콘을 함께 사용한다. 선 하나를 조작 경계의 유일한 단서로 사용하지 않는다.
- 본문16px/1.8, UI14~15px/1.5, 제목24~28px/1.4. 본문은48rem 가운데, 비교는76rem까지 허용한다.
  한국어는 keep-all+overflow-wrap:anywhere로 긴 제목·파일명·URL을 완전히 노출한다.
- 간격4/8/12/16/24/32/48px. 컨트롤8px·구역12px·overlay16px 곡률. 기존 portable card20은
  native 호환값으로 보존하며 웹의 내용 구분은 주로 Section/구분선을 사용한다.
- 버튼/탐색·선택 제어44px 이상. 입력16px을 유지한다. sidebar232px, 접으면64px.
  768~1199px rail,767px 이하는56px 상단과 sheet. 네 작업은 모바일2×2로 모두 읽을 수 있다.
- 메뉴/overlay만 그림자를 사용하고 본문 카드에 장식 그림자를 늘리지 않는다.
  sticky10/navigation20/menu40, modal은 native top layer다. 모션120/160ms, reduced-motion은 정지한다.
- 장문 인용은 출처 위치와 가까이, 표는 영역 내부만 스크롤, 첨부는 파일명·처리 범위·오류/재시도를 함께 둔다.
  출처/미확인/서로 다른 주장을 카드 접기나 줄 수 제한으로 숨기지 않는다.

## 금지 패턴과 교체 방법

`global → shell → product → experience → refresh → workspace` 형태의 덮어쓰기를 되살리지 않는다.
구 도메인 CSS에서 `.ui-button`, `.ui-input`, `.ui-label` 등 공통을 재정의하지 않는다.
native 버튼에 클래스만 추가해 primary/disabled/loading을 별도 구현하지 않고 Button을 사용한다.
페이지 이동에 ARIA tab을 쓰거나, 단순 읽기에 생성/갱신/저장을 연결하지 않는다.
긴 설명이 필요한 실패를 자동 사라지는 toast로 표시하지 않는다. 일부 성공을 전체 성공/전체 실패로 바꾸지 않는다.

1. 기존 페이지의 제목을 PageHeader, 본문 절을 Section, 장문을 ReadingContent로 교체한다.
2. 동작은 Button, 이동은 ButtonLink/TextLink로 교체하고 실제 pending/권한/저장 상태를 그대로 전달한다.
3. 해당 페이지의 구 CSS import를 제거한다. 자체 배치가 필요하면 공통 담당에게 파일/class/과업 증거를 전달한다.
4. 직접 CSS를 읽는 격리 fixture도 global+product로 전환한다. 구 변호사 제품 경로의 회귀는 test-only
   historical snapshot을 사용하며 활성 제품 경로/production bundle에 포함하지 않는다.
5. 새 저장/초안/문서 단독 admission이나 지원하지 않는 출력 기능을 추가하지 않는다.

합성 대표 프리뷰: `BARO_UI_TEST_FIXTURE=true bun run dev`의 `/__design-foundation`.
일반 build에는 이 경로가 없다. 기존 `/__design-system`도 유지한다.
검증: `bunx playwright test --config tests/helpers/foundation.playwright.config.ts`,
`bun run design:check`, `bun run validate:quick`, `bun run validate:build`.
로컬 도구 PATH는 pinned Bun1.4.0과 번들 Node를 포함하며 macOS 임시 경로는 `TMPDIR=/private/tmp`를 쓴다.
Astro dev와 build는 같은 worktree의 Vite cache를 공유하므로 순차 실행한다.

## 검증·마이그레이션 계획

소비 통합 뒤의 정리: 이전 shell/experience/refresh/workspace CSS와 사용하지 않는
landing16개·login/consent/policies/stories/lawyers/settings CSS를 제품 소스에서 제거했다.
직접 CSS를 읽는 공통 shell/리포트 fixture도 canonical producer로 전환했다.
`tests/helpers/retired-web/styles`의 원본 snapshot은 종료한 경로의 권한/자료 회수 회귀를 위한
test-only 이력이며 제품 route나 production bundle에서 소비하지 않는다.
현재 도메인별 CSS는 intake/cases/workspace/workspace-conversation/evidence/reports/resolution/precedents,
공통은 global/product/app-focus/feedback이다. native producer(global/product)와 PDF 출력 CSS를 유지한다.

1. 대표 합성 화면에서 한국어 긴 제목/본문·자료 비교·편집·부분 실패·출처 확인을 검증한다.
2. canonical 토큰/UI/shell로 공통 import를 교체하고 중복된 공통 override를 제거한다.
3. 02~04의 도메인 컴포넌트는 해당 담당자가 교체한다. 필요한 CSS 변경은01이 받아 도메인 파일에 정리한다.
4. 구 CSS의 소비자를 추적하고 마지막 소비자 전환 뒤 삭제한다. native/public/export 소비자는 따로 확인한다.
5. 합성 fixture는 기존 BARO_UI_TEST_FIXTURE 경계를 사용한다. production에 showcase를 노출하지 않는다.
6. 320/390/768/1440px,200% 확대, keyboard·focus·Escape·복귀, reduced-motion과 긴 콘텐츠를 확인한다.

초기 환경 기록: 기본 `~/.bun/bin/bun`은1.3.14로 lockfileVersion3를 읽지 못했다.
기존 `/private/tmp/baro-ui01-bun/bun-darwin-aarch64/bun`1.4.0으로 frozen `bun ci`를 수행했다.
앞선 환경 실패를 코드/검증 성공으로 바꾸지 않는다. 최종 검사 SHA와 quick/build/browser 결과는
기반 PR에 별도로 기록한다.
