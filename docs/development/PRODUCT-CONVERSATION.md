# 대화·참고 패널·질문 화면 이관

기준은 PR #812의 `27a09b10b9d51192bb534fbdcd07ff0214031352`다.
이 작업은 `codex/baro-conversation-ui`에서 구현했으며, 기본 UI PR과 분리한 후속 검토 단위다.
사용자의 PR 제출 지시에 따라 선행 CI를 확인한 stacked PR로 진행한다. main 병합·배포는 하지 않는다.

## 화면 구성

공식 공개 Codex 영상에서 확인한 중립색 작업 공간·간결한 제목 영역·둥근 입력창을 BARO의 기존 업무에 적용한다.
최근 사건 탐색과 테마는 앞 단계의 제품 shell을 그대로 사용한다.

- 대화 header: 사건 제목, 리포트, 실제 사건 도구와 자료 열기를 구분한다. 좁은 화면에서도 44px 조작 영역을 유지한다.
- 대화 입력: 첨부·조회 메뉴와 입력·전송을 둥근 composer 안에 배치한다. 자료 업로드 동의·실패·진행 상황은 같은 입력 맥락에서 읽는다.
- 참고 패널: 큰 화면의 오른쪽 자료 영역과 작은 화면의 modal sheet에서 같은 편집 DOM을 유지한다.
- 질문: 현재 차수·진행, 한 번에 한 질문, 선택/직접 입력, 모름·건너뛰기·저장 상태와 재개를 차분한 단일 열에 배치한다.

## 보존 계약

`CaseWorkspaceFrame`의 세 effect, 단일 static Headless Dialog/Panel, 중첩 modal의 breakpoint 전환 보류와 외부 reset 포커스는 유지한다.
대화 입력의 상태·서버 호출·receipt 복구·소유권 검사는 기존 Workspace controller에 남긴다.
숨은 파일 chooser를 다시 mount하지 않으며, IME 조합·native requestSubmit·중복 제출 잠금과 Unicode 제한을 보존한다.

질문의 load/save/advance·3초 autosave·저장한 답변 탐색·정확한 실패 snapshot 재시도·응답 유실 확인과 세션/동의 검사는 view 교체와 분리한다.
질문은 최대 두 차례×세 문항이며 unknown/skipped 상태를 빈 답변으로 바꾸지 않는다.

API·DB·공유 client·모바일·랜딩과 원본 공유 CSS는 이 단계에서 변경하지 않는다.
새 utility와 portal theme은 제품 영역에만 적용한다. 상세 자료 교정·리포트 편집·요약 재확인 등 나머지 시각 tree는 후속 범위다.

## 검증

기존 기능 검증문을 유지하고 필요한 경우 시각 class 선택자만 명시적 DOM/접근성 관계로 옮긴다.
보존 검사는 기준 커밋 대비 committed/index/worktree 경로와 package 변경을 함께 검사한다.
Controller/SSR, quick/build와 변경 영역의 브라우저 검증을 수행한다.
Computer Use에서는 합성 계정의 질문 입력·저장/탐색, 대화 초안·첨부 메뉴·참고 패널, 320~1440px와 라이트/다크를 확인한다.

실제 검증 결과·화면·소스 보존과 남은 제약은 [검토 기록](../quality/product-conversation/README.md)에 남긴다.
원본 cases/workspace CSS를 제품 legacy layer로 옮기고 기존 Astro import만 제거했다. 랜딩은 해당 제품 진입을 사용하지 않는다.
독립 프레임 fixture도 실제 product.css를 컴파일하므로 새 utility를 누락한 상태로 패널을 검증하지 않는다.
