# Responsive workspace frame

현재 기준은 docs/design/HEADLESS-WEB-UI.md와 ADR-0022 (#799)다.
Headless Dialog의 안정된 portal 안에서 같은 material/editor DOM을 유지한다.
데스크톱에서는 비모달 우측 표면으로 배치하고 1200px 미만에서는 모달 sheet로 동작한다.
테마는 루트 tokens를 상속한다. resize/테마는 선택·교정·입력 상태를 초기화하지 않는다.
Headless UI가 focus/inert/scroll lock을 관리하며 owner는 기존 권한/저장/미저장 닫기 검사를 유지한다.
