# ADR-0022: Headless UI 기반 웹 DS와 테마

- Status: Accepted
- Date: 2026-11-10
- Authority: 사용자 직접 지시
- Tracking: [#799](https://github.com/creno-va/baro/issues/799)
- Partial supersession: ADR-0021의 웹 primitive/테마 선택, #795/#797의 로그인 제외·라이트 고정 범위. 기존 업무·권한·출력·런타임 계약은 유지한다.

## 맥락

페이지별 CSS와 native select/dialog/details/checkbox, 동기 window.confirm이 혼재해 모양과 동작이 달랐다.
사용자는 랜딩을 제외한 전체 웹 화면에 실제 Headless UI와 라이트/다크 모드를 요청했다.

## 결정

1. @headlessui/react 2.2.10을 정확 버전으로 고정한다. Button/Input/Textarea, Checkbox/RadioGroup,
   Listbox, Dialog, Disclosure, Tabs, Menu, Popover를 공통 UI 모듈에서 소비한다. 기본 브라우저 select,
   dialog, details, progress, checkbox/radio와 window.confirm을 제품 위젯으로 사용하지 않는다.
2. design-system.css가 비랜딩 페이지와 portal의 semantic color/interaction token 정본이다.
   업무 CSS는 구조·레이아웃을 소유하고 색은 같은 토큰을 소비한다. AppLayout의 이전 네 겹
   제품 스타일을 제거하고 같은 workbench shell을 소비한다. 새 UI state 라이브러리는 추가하지 않는다.
3. 테마는 light/dark/system이다. 최초 화면은 저장 선택 또는 시스템 모드를 CSP hash 등록
   bootstrap으로 첫 paint 전에 적용한다. 저장 실패는 현재 화면 이용을 막지 않는다.
   탭 간 선택과 시스템 변경을 동기화한다. 랜딩은 이 초기화와 테마 범위에서 제외한다.
4. Headless portal은 DOM 위치와 관계없이 루트 토큰을 상속한다. 자료 패널은 같은 portal과
   editor DOM을 유지한 채 desktop inline 배치와 좁은 화면 modal 동작을 전환한다.
5. 미저장 확인은 공통 비동기 Dialog로 처리하고 취소를 기본으로 한다. 세션 통지·계정 변경·
   원래 컨트롤 제거·페이지 이동은 대기를 취소하며 소비자는 기존 epoch/owner fence를 재검사한다.
   모달을 열었다는 이유로 API/AI 작업을 실행하지 않는다.
6. 플랫폼 파일 접근의 숨김 file input과 페이지 이탈 보호는 보안 장치로 유지한다. 앱의 보이는
   파일 추가/선택 UI는 커스텀 컴포넌트다. 기본 브라우저 폼 appearance와 확인창은 사용하지 않는다.
7. 랜딩의 마크업·기능·스타일과 native 앱, 내보낸 PDF/HTML/TXT 문서는 독립이다.
   UI 테마가 기존 문서 내용·출력·저장·마스킹·CAS·provider·quota·비용 정책을 바꾸지 않는다.
8. Dialog/Popover/TabGroup의 Headless SSR 보조 요소는 inline style을 출력하므로 같은
   hydration snapshot에서 client-ready 뒤 마운트한다. 기존 hash CSP와 style-src-attr 제한을
   유지하며 새 inline 허용이나 정책 우회를 추가하지 않는다. 이후 DOM과 편집 상태는 유지한다.

## 대안

모양만 비슷하게 덮는 접근은 서로 다른 키보드·모달·선택 동작을 남기므로 채택하지 않는다.
Astro/React islands를 SPA로 전환하는 안은 업무 owner/저장 경계를 불필요하게 바꾸므로 제외한다.
Headless UI가 제공하지 않는 progress는 공통 ARIA progressbar로 표현하며 실제 관측 값만 사용한다.

## 결과와 후속

공통 primitive가 키보드·초점·상태를 소유한다. 기존 소비자의 이벤트 어댑터는 UI 계층에 모으고
업무 코드는 기존 권한·실행 경로를 유지한다. 양 테마·portal·모달 stack·리사이즈·owner 교체·
미저장 취소·접근성·CSP·주요 사용자 흐름을 합성 입력으로 검증한다.
Accepted는 검증/배포 완료를 뜻하지 않는다. 정확 SHA와 실제 결과는 #799에 기록한다.
