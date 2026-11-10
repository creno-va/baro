# BARO 웹 UI 계약

현재 기준은 [ADR-0022](../adr/0022-headless-web-ui-and-themes.md), 사용자 지시 #799다.

## 적용 범위

랜딩(/)을 제외한 /new, 사건/질문/요약/자료/판례/리포트/초안, 설정,
로그인/동의, 도움말/정책, 기존 종료 안내 등 모든 웹 화면이다.
랜딩의 기존 디자인은 테마 선택에 영향받지 않는다. 모바일 native와 출력 문서는 독립이다.
/app 호환과 기존 계정·사건·자료·리포트 및 변호사 미지원 흐름을 보존한다.

## 공통 계층

- design-system.css: 라이트/다크 semantic tokens, 컨트롤·surface·focus·모달·메뉴·선택 목록.
- ui/button·form: 실제 Headless Button/Input/Textarea/Checkbox/RadioGroup/Listbox.
- ui/dialog: Headless Dialog/Panel/Title/Description와 공통 sheet/stack.
- ui/disclosure·tabs: 실제 Disclosure와 TabGroup, 닫힌 panel의 편집 상태 보존.
- ui/theme-toggle: 실제 Menu와 light/dark/system 선택.
- ui/popover: 사건 도구를 자료 패널 위에서 여는 실제 Popover/portal.
- ui/experience + client/confirm: 공통 취소 우선 확인창, session/DOM/path 무효화.
- workspace-frame: 동일 editor DOM을 유지하는 responsive portal.
- ui/progress: 관측 값에 연결된 ARIA progressbar.

페이지마다 native 위젯을 새로 만들거나 token 대신 고정 색으로 다른 테마를 추가하지 않는다.
텍스트·로고·형상은 BARO와 기존 Pretendard/Lucide 자산을 사용한다. 기본 text 15~16px,
보조 12~14px, 읽기 줄 간격 1.65~1.8, 컴포넌트 radius 8~12px,
주요 touch 조작 44px을 기준으로 한다. 테두리·빈 상태·실패·진행·disabled를 구분한다.
여러 카드와 강조 색으로 모든 항목을 같은 우선순위로 보이지 않게 한다.

## 테마와 동작

저장한 선택이 있으면 우선하고 없으면 시스템을 따른다. 저장이 거부돼도 현재 선택은 적용한다.
theme key에는 계정/사건/토큰을 넣지 않는다. CSP를 완화하거나 inline script/eval을 허용하지 않는다.
Headless portal도 동일 루트 tokens를 쓴다. 자료·리포트·초안의 선택/교정/저장 상태는 테마
전환이나 resize로 초기화하지 않는다. 질문 2×3과 AI200/일, 권한·CAS·실행·비용 원장을 유지한다.

## 검증

두 테마와 시스템 선택, 새로고침·peer tab·저장 실패, dialog/listbox portal, 키보드와 초점 복귀,
반응형/확대/IME/작은 화면의 넘침, 미저장 확인 취소·owner 변경을 확인한다.
랜딩 불변은 source diff와 브라우저로 확인한다. 로컬 대역과 실제 로그인/외부 인수는 구분한다.

스크립트 없이 제공하는 503 복구 문서는 시스템 색상 모드를 따르며 앱 테마 저장소를 읽지 않는다.
