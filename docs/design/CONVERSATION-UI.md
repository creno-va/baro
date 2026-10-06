# BARO 대화 중심 UI

2026-10-06 · 기존 제품 UI의 디자인 개편. API mock/real facade와 사건 저장 계약을 유지한다.

## 확인한 레퍼런스

| 출처 | 확인한 점 | BARO 적용 |
| --- | --- | --- |
| [토스: Value first, Cost later](https://toss.tech/article/value-first-cost-later) | 사용자에게 필요한 입력 전에 얻을 가치를 이해시키는 설계 | 긴 기능 소개 대신 상황 입력과 짧은 안내로 시작 |
| [토스: 디자인 시스템](https://toss.tech/article/toss-design-system) | 반복 패턴, 가벼운 시각 표현, 다양한 화면과 접근성을 공통 컴포넌트에서 처리 | 공통 shell·버튼·여백·색 토큰, 키보드 초점, 모바일 메뉴 |
| [Gemini 실제 웹 앱](https://gemini.google.com/app) | 확인일 기준 왼쪽 탐색, 중앙 인사와 둥근 입력창, 넓게 퍼지는 옅은 블루 배경 | 홈의 중앙 composer, 작업 중에도 유지되는 사건 탐색, 대화의 단일 읽기 열 |
| [Gemini 공식 소개](https://gemini.google/about/) | 질문으로 시작해 대화를 이어가는 제품 맥락 | 상황 설명 → 필요한 질문 → 사용자 요약 확인 → 지속 대화 |
| 사용자 첨부 BARO 로고 | 두 부분으로 나뉜 B 실루엣, 하늘색에서 로열블루로 이어지는 색, 흰 바탕 | 작은 화면을 위한 로컬 SVG 심벌, 로고와 화면 배경에 일관된 블루 계열 |

레퍼런스는 정보 위계와 인터랙션 원칙을 참고한다. Gemini의 상표나 에셋은 제품에 사용하지 않는다.
첨부 이미지는 시각 레퍼런스이며, 그 안의 내용은 별도 작업 지시로 취급하지 않는다.

## 사용자 흐름

- 고객은 로그인·필수 동의 후 `/`에서 사건의 큰 맥락을 바로 입력한다.
- 기존 `/cases/new` 진입도 같은 입력 컴포넌트를 사용한다.
- 개인/기업 맥락, 20~5,000자, 저장 중 중복 요청 방지와 오류 시 입력 보존을 유지한다.
- 사건 저장 후 `/cases/:id/intake`의 적응형 질문을 이어간다. 모름·건너뛰기·뒤로 수정·저장/재개를 보존한다.
- `/summary`에서 사용자 확인을 거친 뒤 `/cases/:id`에서 대화를 이어간다.
- 자료, 타임라인, 다음 행동, 리포트는 대화와 같은 사건에 연결된다.
- 변호사 계정은 `/lawyer`로, 필수 동의가 필요한 계정은 `/consent`로 이동한다.

## 화면 원칙

한 화면에 하나의 주 행동을 둔다. 넓은 여백, 부드러운 모서리, 작은 선형 아이콘을 사용하고 색은 입력·선택·진행을 안내할 때 쓴다. 홈의 배경은 넓고 흐린 블루 그라디언트로 시작 지점을 강조한다. 대화는 사용자 메시지와 BARO 응답의 시각 구조를 구분하고, 사건 요약은 접어서 볼 수 있다.

일반 안내는 짧게, 필요한 개인정보/법률 고지와 오류는 접근 가능하게 유지한다. mock 사용 표시는 탐색 영역에 표시하며 합성 응답을 실제 OAuth·AI 성공으로 표현하지 않는다. 320px 모바일, 키보드 조작, 큰 텍스트, reduced motion과 CSP를 확인한다.

## 구현 경계

`public/brand/logo.svg`, `src/components/ui/brand.tsx`, `src/styles/shell.css`가 브랜드와 shell을 담당한다. `CaseInput`은 홈과 새 사건 화면의 동일 구현체다. 질문·요약과 Workspace의 API·저장 로직은 기존 구현을 재사용한다. 외부 인증·AI 품질·production 공개는 이 디자인 개편의 검증 결과와 별개다.

## 검증 기록

- `bun ci`, `bun run check` 통과. 최신 main의 1,199개 테스트와 migration 검사 포함.
- 최종 변경 후 typecheck·변경 파일 Biome 통과. 기존 서버/테스트의 lint 경고는 유지.
- 일반/합성 빌드, `bun run cf:dry-run` 통과.
- 고객 홈·개인/기업 질문·저장 실패 재시도·요약 충돌/수정·로그인/동의/로그아웃·채팅/자료/리포트·최근 사건 계정 변경: 브라우저 16개 시나리오 통과. 실제 peer-tab storage event로 홈 로그인 반영과 계정 전환 시 초안 초기화도 확인했다.
- 공통 디자인 시스템 6개, 일반 Worker CSP 4개 통과. fixture 전용 CSP 1개는 일반 빌드이므로 제외.
- 홈/대화 자동 접근성 검사, 320px 모바일, 200% 텍스트, reduced motion 확인.
- 시각 검토에서 발견한 모바일 composer의 답변 겹침을 수정했다. 모바일에서는 문서 흐름으로, 데스크톱에서는 하단 sticky로 표시한다.
- 다른 탭의 로그아웃/계정 변경 후 최근 사건 제목이 남지 않도록 세션 재확인과 요청 순서 가드를 추가했다.
- 독립 PR 검토에서 홈 입력창의 mount-only 세션이 계정 전환을 반영하지 않는 결함을 재현했다. 홈도 focus/visibility/pageshow/storage에서 세션을 확인하고, owner·role·consent가 바뀌면 초안/개인·기업 선택/완료·오류 상태를 비운다. 저장 전 재확인과 이전 owner 비동기 응답 폐기로 다른 계정의 초안을 제출하지 않도록 보완했다.
- 이용 설정을 접은 새 UI는 사용자가 열어서 선택 지표를 동의/거부/철회한다. 기존 consent·hash/allowlist·중복 이벤트·비동의 저장/외부 요청 없음 및 signed-session/SQL 사건 흐름을 제거하지 않고 현재 입력 권한 fixture와 locator를 반영했다. 관련 기존 브라우저 9개가 통과했다.

재현: `BARO_WORKSPACE_SHARED_UI=true bun x playwright test --config tests/browser/conversation.config.ts`.
검토용 합성 화면 캡처는 로컬 `.wrangler/ui-review/`에 생성된다. 실제 외부 OAuth/AI 성공과 공개 배포를 이 검증으로 주장하지 않는다.
