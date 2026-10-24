# 앱 내부 경험 정비 — 2026-10-25

- 추적: [#522](https://github.com/creno-va/baro/issues/522), `codex/522-app-experience`
- 출발점: main `999b127167283d9d5b4268360ceb582a02a7661c`, 해당 main CI SUCCESS
- 범위: 웹 앱 표현·상태·레이아웃. 랜딩, RN, 서버, API/계약, DB는 변경하지 않는다.
- AI #458/#506 담당과 직접 조율: `Workspace.tsx`, `PrecedentResearch.tsx`, `CaseNavigation.tsx`의 기능 소유권은 AI 담당에게 유지한다. 공통 UI와 앱 전용 CSS를 여기서 소유한다.

## 조사와 설계 판단

토스의 화면을 복제하지 않고, 기존 랜딩의 파랑·Pretendard·충분한 여백·둥근 모서리를 앱의 읽기와 작업에 맞게 적용한다.

| 근거 | 적용한 판단 |
| --- | --- |
| [토스의 8가지 라이팅 원칙](https://toss.tech/article/8-writing-principles-of-toss) | 현재 수행하는 작업과 다음 행동을 알 수 있게 안내한다. 로딩·빈 목록·연결 오류를 서로 구분하고, 기술 구현 문구를 새로 노출하지 않는다. |
| [인터랙션, 꼭 넣어야 해요?](https://toss.tech/article/interaction) | 모션을 누름·상태 변화·화면 열림의 피드백으로 사용한다. 공통 easing과 160/240ms 전환을 사용하며 대화/요청에 인위적인 지연을 추가하지 않는다. |
| [첫 인터랙션 디자이너가 문제를 해결하는 법](https://toss.tech/article/1st_interaction_designer) | 기다릴 때 실제 단계와 저장된 내용을 존중한다. 확인하지 않은 진척률·완료 시간·성공 상태를 만들어 표시하지 않는다. |
| [W3C 상태 메시지](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | 상태 문구와 장식용 spinner/skeleton을 분리한다. 오류 안내·기존 live region·권한 철회 동작을 보존한다. |
| [W3C 텍스트 대비](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 카드와 캔버스는 면·테두리로 나누고 본문/보조 문구의 대비를 axe 및 실제 PNG로 검사한다. 일반 글자 4.5:1, 큰 글자 3:1을 기준으로 한다. |
| [W3C 인터랙션 모션](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | `prefers-reduced-motion`에서 회전·펄스·모달 진입·누름·페이지 전환 효과를 중지하고 문구로 상태를 유지한다. |

## 발견한 문제와 구현

- 기존 `.sidebar-desktop` 전체가 `overflow-y:auto`여서 최근 목록이 계정 영역을 밀었다. 상단 메뉴와 하단 계정은 고정하고 가운데 `.sidebar-recent__list`만 스크롤한다. 목록은 키보드로도 스크롤할 수 있고, 읽기 실패를 빈 목록으로 표현하지 않는다.
- 공통 native Dialog는 Escape의 기본 닫기를 차단하고 소유 컴포넌트에 닫기를 요청한다. 처리 중 소유자가 닫기를 거절해도 모달이 먼저 사라지지 않으며, 중첩 모달의 Escape가 부모까지 전파되지 않는다.
- 데스크톱의 일반 dialog는 viewport 중앙에 두고, 긴 내용은 dialog 안에서 스크롤한다. 공통 dialog의 제목·닫기는 스크롤 밖에 유지한다. 작은 화면과 모달 내부 가로 overflow, Escape·focus 복귀·중첩 모달은 별도로 확인한다.
- 높이 560px 이하의 데스크톱 창은 상단 메뉴 버튼을 사용한다. 가로 모바일 메뉴도 헤더를 유지하며 계정까지 접근할 수 있다.
- 캔버스 `#f5f7fb`, 흰 카드, 명확한 테두리와 안쪽 여백을 사용한다. 사건 목록의 읽기 영역과 삭제 액션을 분리하고, 설정·검색 카드와 채팅 입력 면·내 메시지·추천 질문의 식별성을 보강한다.
- `LoadingContent`는 목록·디렉터리·상세·사용량의 구조를 예약한다. 사건 목록, 질문, 요약, 공개 프로필, 계정 사용량, 리포트에 연결한다. 재조회 시 기존 내용은 해당 화면의 기존 권한/복구 규칙을 따른다.
- 공통 Button의 명시적 `loading`은 spinner와 중복 제출 방지를 제공한다. 검색은 진행 중에도 다른 조건으로 다시 검색할 수 있는 기존 취소 동작을 유지한다. 초기 상태·로그아웃·기존 StatePanel·설정/리포트 작업에도 회전 피드백을 연결한다.
- `app-experience.css`는 AppLayout에서만 읽는다. `global.css`, `shell.css`, `product.css`, BaseLayout, index 및 랜딩 코드·자산·스타일은 그대로 보존한다. 공통 spinner의 작은 CSS는 해당 컴포넌트를 사용하는 인증 화면에도 적용한다.

## 검증과 증거

서로 다른 브라우저 시나리오 123개가 성공했다. 모든 입력과 계정은 합성이며 유료 모델 호출을 하지 않는다. 아래 결과는 실제 OAuth/공급자/production 인수를 대신하지 않는다.

- `bun ci`: frozen 설치 성공.
- `bun run validate:quick`: lint·타입·경계·문서/작업 그래프 및 선택 계약 검사 성공(457 tests).
- `bun run validate:build`: production build, bundle, Worker dry-run 및 local workerd의 익명 로그인 응답 성공.
- 기존 product UI 12개: 주요 화면 320/390/768/900/901/1024/1440px, 입력창 위치, 자료·타임라인 dialog, 읽기/편집, 200% 글자 확대와 axe 검사.
- AI PR521/main2803b4f 통합 후 `validate:quick` 549개와 build/local workerd도 성공했다.
- 신규 app-experience 7개: 합성 사건 30개, 1440px 폭·600/720/900px 높이의 독립 사이드바 스크롤; 320/390/768/1024/1440/1920px 모달; 지연/실패 spinner·skeleton; reduced motion; 모바일/가로 메뉴·classic scrollbar·200% 확대·axe; 검색·프로필 대기/오류; 처리 중 삭제의 Escape/닫기 거절과 중첩 모달 Escape·focus 복귀.
- 로그인·동의·랜딩·리포트 기존 회귀 66개 성공. 랜딩의 영상/스크롤/접근성·모바일 상호작용도 유지됨을 확인했다.
- 계정/세션 복구 회귀 15개 성공. 처음에는 보조 사이드바 오류와 본문 상태를 동시에 선택해 13 성공/2 실패였으며, 본문 상태로 locator를 한정한 뒤 15개 전체가 성공했다.
- 앞선 6개 파일 회귀는 39 성공/1 실패였다. 인증 테스트가 새 사이드바 상태와 본문 상태를 동시에 선택하던 strict locator 문제였고, 검사 대상을 main으로 좁혔다. 이후 인증 전체가 포함된 위 66개가 성공했다. 제품 인증 guard는 변경하지 않았다.
- 신규 프로필 지연 fixture의 첫 실행은 self-service 선행 endpoint를 가로채지 못해 4 성공/1 실패했다. 두 조회 경로를 함께 가로채도록 fixture를 고쳐 5개가 성공했다. 실제 공급자 오류로 해석하지 않는다.

최종 PR head와 CI 결과는 #522와 PR에 기록한다. 전체 `validate:full`·동일 SHA preview/production 배포는 운영 문서의 수동 절차와 별도 승인/검증 범위를 따른다.

## 최종 합성 화면

![데스크톱 사건 목록과 고정 계정](./app-experience-2026-10-25/cases-desktop.png)

![모바일 채팅 입력 영역](./app-experience-2026-10-25/chat-mobile.png)

![설정 카드 위계와 여백](./app-experience-2026-10-25/settings-desktop.png)

![320px 모달 내부 스크롤과 고정 제목·닫기](./app-experience-2026-10-25/dialog-mobile.png)

![목록 대기 구조](./app-experience-2026-10-25/loading-mobile.png)
