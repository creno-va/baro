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

## 공통 API 설계안

총괄 계약 후 확정하며 기존 API의 기본값을 호환 유지한다.

| API | 의미/소비 규칙 |
| --- | --- |
| Button / ButtonLink | 실행/이동 구분. loading은 중복 실행을 막고 동작 이름을 유지. 한 과업 영역의 primary는 하나 |
| Input / Textarea / Select / Label / FieldDescription | visible label 필수. 설명/오류는 id+aria-describedby로 연결, invalid는 색과 문구 동시 제공 |
| Tabs | 같은 페이지 안의 내용 선택만 사용. 화살표 focus, Enter/Space activation. 페이지 이동은 link navigation |
| Dialog / Sheet | controlled open. Escape/닫기 요청을 owner에 전달하며 owner의 busy 거절을 보존. returnFocusRef 지원 |
| PageHeader / Section | 페이지·본문 절의 제목/설명/관련 행동. 제목은 잘라 숨기지 않고 좁은 화면에서 자연 줄바꿈 |
| StatePanel / InlineNotice | loading/empty/error/limit/permission/pending와 partial/success. partial은 완료한 결과와 다음 복구를 함께 표시 |
| ReadingContent / SourceReference / TableScroll | 긴 본문·출처·표의 읽기 규칙. 의미/출처를 숨기지 않고 표 영역만 가로 스크롤 |

## 검증·마이그레이션 계획

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
