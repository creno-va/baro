# BARO 동일 UI·API mock: 5개 세션 실행 계획

- Updated: 2026-10-06
- 사용자 결정: UI를 먼저 검토할 수 있도록 실제 클라이언트를 완성하며 API만 mock으로 대체한다.
- 시간 목표: 5개 세션 실제 착수부터 120분. 계획·이슈 정리 후 사용자가 세션을 직접 시작한다.
- UI milestone: [#6](https://github.com/creno-va/baro/milestone/6), tracking [#101](https://github.com/creno-va/baro/issues/101).
- 실제 기능 milestone: [#5](https://github.com/creno-va/baro/milestone/5). 완료된 작업은 보존한다.
- 고정 계약: [CLIENT-API-CONTRACT.md](./CLIENT-API-CONTRACT.md). 별도 mock UI와 `/mock` 사이트를 만들지 않는다.

## 완료 기준과 우선순위

M0는 실제 제품 경로의 동일 UI가 합성 API 응답으로 모든 고객·변호사 흐름을 끝까지 수행하는 상태다.
프로필 승인·반려·운영자 심사는 MVP에서 제외한다. 통합 로그인에서 고객/변호사를 선택한다.
디자인은 기존 blue/shadcn/Lucide/Pretendard와 공통 SVG를 재사용하며 전체 화면을 먼저 만든다.
AI 답변 품질 개선, corpus 전체 재평가, 새 비용/DB 설계는 M0 선행 작업이 아니다.

M1은 같은 화면의 real adapter를 실제 API에 연결하는 상태다. M0 화면과 mock 응답이 동작하는
담당 영역부터 기존 API·PR을 재사용해 M1을 진행한다. 다른 세션이 화면을 만드는 동안 가능한
실제 기능 연결을 진행하되, mock 화면 완성을 늦추는 실서비스 blocker를 새로 선행하지 않는다.
공개 승인·실제 외부 성공은 기존 gate에서 별도로 확인한다.

| 세션 | UI issue | 소유 화면과 파일 | 같은 UI의 실제 기능 후속 |
| --- | --- | --- | --- |
| A | [#102](https://github.com/creno-va/baro/issues/102) | 공통 API core/types/index/mock runtime, 로그인·동의·역할/공통 shell/홈 | 기존 인증 + 역할 저장, PR 통합·preview |
| B | [#103](https://github.com/creno-va/baro/issues/103) | 사건 목록·생성·질문·요약, cases client/mock | #64/#65 중 intake·요약 API 연결; PR100 재사용 |
| C | [#104](https://github.com/creno-va/baro/issues/104) | workspace·chat·files·timeline·actions, workspace/files client/mock | #58/#59/#64/#65 중 workspace·자료 연결 |
| D | [#105](https://github.com/creno-va/baro/issues/105) | report/PDF/ZIP·settings·usage/delete·help/policy, reports/account client/mock | #66/#67/#68 기능 연결 |
| E | [#106](https://github.com/creno-va/baro/issues/106) | lawyer 자기 profile·directory/profile, lawyers client/mock | #62와 승인 없는 본인 공개 연결; #60/#61 재사용 |

## 파일 소유와 화면 연결

- A: `src/client/api/core.ts`, `types.ts`, `index.ts`, `session.ts`, `mock/runtime.ts`, `mock/session.ts`,
  공통 registration, `src/pages/index.astro`, `login.astro`, `consent.astro`, `src/layouts/`,
  `src/components/AuthButtons.tsx`, `ConsentForm.tsx`, `ui/app-navigation.tsx`, `src/styles/global.css`.
- B: `src/pages/cases/index.astro`, `new.astro`, `[caseId]/intake.astro`, `[caseId]/summary.astro`,
  `src/components/intake/`, `src/client/api/cases.ts`, `mock/cases.ts`, `src/styles/intake.css`.
- C: `src/pages/cases/[caseId].astro`, `[caseId]/files.astro`, `timeline.astro`, `actions.astro`,
  `src/components/workspace/`, `src/components/analysis/`의 v1 호환, `src/client/api/workspace.ts`,
  `files.ts`, `mock/workspace.ts`, `mock/files.ts`, `src/styles/workspace.css`.
- D: `src/pages/cases/[caseId]/reports.astro`, `src/components/reports/`, `src/pages/settings.astro`,
  `src/components/AccountSettings.tsx`, help/policy 페이지, `src/client/api/reports.ts`, `account.ts`,
  `mock/reports.ts`, `mock/account.ts`, `src/styles/reports.css`, `settings.css`.
- E: `src/pages/lawyer/`, `src/pages/lawyers/`, `src/components/lawyers/`,
  `src/client/api/lawyers.ts`, `mock/lawyers.ts`, `src/styles/lawyers.css`.

각 담당 browser test는 별도 파일에 둔다. 공통 types/global/CI/문서/schema는 각 세션이 동시에 고치지 않는다.
자료 상세는 C, 리포트는 D가 구현한다. C의 workspace에서 D의 reports 경로로 연결한다.
B의 요약 확인은 C workspace로 이동하며 E의 directory는 비로그인에서도 탐색한다.
기존 v1 페이지·결과·읽기·삭제는 지우거나 자동 재분석하지 않는다.

실제 기능을 병렬 연결할 때도 서버 파일의 소유권을 지킨다. 첫 120분의 mock UI 완료를 우선한다.

| 세션 | 실제 API 파일 소유 | 공유 파일 요청 |
| --- | --- | --- |
| A | `src/server/auth/`, 기존 me/consent 및 신규 accountType API, 통합 router·CI | 역할 저장의 schema가 필요하면 기존 DB 소유 범위에 요청; mock은 계속 |
| B | 실제 cases/intake/summary client adapter; 기존 서버 API 소비 | #64 workspace service/API의 누락은 C에 요청; 같은 서버 파일을 중복 수정하지 않음 |
| C | `src/server/modules/workspace/`, `runtime/workspace.ts`, `api/v2/workspaces.ts`, 기존 files API·files 모듈 | report·계정 삭제는 D, role은 A에게 요청 |
| D | `src/server/modules/reports/`, reports API, deletion 모듈·계정 삭제 API | workspace 상태 변경 primitive는 C, router 등록은 A에 요청 |
| E | lawyers/profile/directory 모듈·API, 본인 프로필 공개 | auth 역할·router는 A에 요청; 기존 shared schema 변경 요청은 기록 |

이 소유권은 M1을 먼저 진행한 세션이 다른 세션의 파일을 수정해 충돌하는 것을 방지한다.
공유 DB·migration 변경은 2시간 UI 시연의 선행 작업으로 만들지 않는다.

## 120분 진행 규칙

| 경과 | 목표 |
| --- | --- |
| 0~20분 | A는 API 계약·transport·공통 shell 최소 기반 push. B~E는 고정 계약으로 소유 UI 개발 시작 |
| 20~75분 | 각 영역의 happy path와 저장·새로고침 연결. mock 응답만 교체하고 실제 페이지 사용 |
| 75~100분 | 각 세션 PR 제출, 담당 기능·타입·빌드 확인. A가 검증된 PR을 즉시 통합 |
| 100~120분 | A가 preview 하나로 통합, 고객/변호사 전체 경로 확인. 나머지 세션은 자기 영역 통합 결함 수정 |

A의 구현 PR 병합을 B~E의 독립 UI 착수 조건으로 두지 않는다. 공통 계약은 이 문서와 고정된 DTO다.
A의 첫 기반 commit은 다른 checkout에서 가져오되 미검증 shared contract 변경을 production 완료로 취급하지 않는다.
모든 PR은 같은 main에 순서대로 통합한다. A만 통합·preview를 맡고 B~E는 서로 다른 checkout에서 작업한다.
검사 대상은 변경 기능 동작·권한·저장, 타입·빌드다. 전체 corpus·대용량 회귀·법률 적합성 반복 검사는 하지 않는다.
동일 PC에서 무거운 검사/서버를 중복 실행하지 않으며 포트는 A 4340, B 4341, C 4342, D 4343, E 4344다.
새 API/DB primitive가 없다는 이유로 mock UI를 멈추지 않는다. 실제 endpoint 미연결은 기존 기능 이슈로 기록한다.

## 세션 시작용 프롬프트

각 블록은 사용자가 별도 BARO 세션에 그대로 붙여 넣는다. 새 세션/Goal/자동 실행/추가 에이전트를 만들라는 지시가 아니다.
다른 세션에 진행 확인·통합 인계 메시지를 보내는 것은 이 병렬 작업 범위에서 허용한다.

### A: 공통 API·로그인·통합

```text
BARO 5세션 작업의 A를 맡아 #102를 구현하고 #101 통합을 책임져.
AGENTS.md, README.md, docs/development/PARALLEL-UI-SPRINT.md,
docs/development/CLIENT-API-CONTRACT.md와 GitHub #101/#102를 읽고 최신 main에서 시작해.
현재 사용자 지시가 예전 전체 서비스/관리자 명세보다 우선한다.

목표는 5세션 착수부터 2시간 안에 실제 클라이언트 UI 하나를 API mock으로 전부 시연하는 것이다.
별도 /mock 페이지나 mock 전용 컴포넌트를 만들지 마. mock/real transport만 교체해.
고객/변호사 선택 통합 로그인, OAuth 선택, 동의, 역할별 복귀, 로그아웃과 공통 shell/홈을 만든다.
운영자·승인·반려 화면은 MVP에서 제외한다. 자기 선택 역할을 자격 확인 완료로 표시하지 마.

소유 파일은 실행 문서의 A 범위다. 공통 API types/core/index/mock runtime/session,
layouts/global/navigation/login/consent만 직접 편집해. B~E domain/UI 파일은 초기 기반 push 이후 넘겨.
처음 20분 안에 고정 계약과 공통 mock 저장소/registration 최소 기반을 push하고 commit/사용법을 알린다.
domain mock 저장소에서 같은 case/session/profile 상태를 재사용하게 해.
mock에서 실제 OAuth/AI/R2 요청이나 비용이 발생하지 않게 하고 production에는 mock을 허용하지 마.

별도 worktree와 codex/102-api-mock-shell 브랜치를 사용하고 issue claim을 남겨.
다른 세션의 PR을 조회하고, 검증된 PR 병합 및 통합 preview 배포를 수행해도 된다.
#64 PR100은 CI를 통과한 기존 backend다. 재구현하지 말고 검토 후 필요한 연결에서 재사용해.
다른 세션에 이 작업의 진행 확인·통합 인계 메시지를 보내도 된다. 새 세션/Goal/에이전트는 만들지 마.

화면이 먼저 완성되면 기존 auth와 고객/변호사 역할 저장의 real 연결을 진행해.
전체 사례·법률 품질·대용량 회귀를 반복하지 말고 변경 기능·타입·빌드만 확인해.
75~100분에 PR들을 통합하고 120분 전에 단일 preview URL과 두 역할의 실제 클릭 흐름을 보여줘.
실 API 미연결 부분은 정확히 표시하고 목업 성공을 실제 로그인/모델 성공으로 표현하지 마.
프롬프트를 다시 작성하지 말고 구현·PR·통합을 수행해.
```

### B: 사건 생성·질문·요약

```text
BARO 5세션 작업의 B를 맡아 #103을 구현해.
AGENTS.md, README.md, docs/development/PARALLEL-UI-SPRINT.md,
docs/development/CLIENT-API-CONTRACT.md와 GitHub #103/#65를 읽고 최신 main에서 시작해.
별도 worktree/codex/103-intake-ui-api-mock 브랜치, 개발 포트 4341을 사용해.

2시간 내 실제 제품 경로에서 사건 목록/빈 상태/생성 → 질문 → 요약 편집/확인 → workspace 이동을 완성해.
질문은 모름/건너뛰기/뒤로 수정/저장·재개를 지원하고 새로고침 후 같은 사건을 이어가게 해.
별도 mock UI를 만들거나 컴포넌트에 fixture를 넣지 말고 api.cases를 호출해.
동일 UI의 request/response 경계에서 API mock 응답을 사용해. A가 계약을 구현하는 동안 화면부터 시작해.

소유는 cases/index.astro,new.astro,[caseId]/intake.astro,summary.astro,
components/intake, client/api/cases.ts와 mock/cases.ts, styles/intake.css다.
workspace 상세, reports, 공통 types/global/layout/CI/schema는 편집하지 마.
요약 확인 뒤 /cases/{id}로 연결하고 생성한 case id를 C/D와 공유 API 저장소에서 재사용해.
완료된 v1 작업과 데이터는 보존해. 승인 어드민은 구현하지 마.

기존 디자인 시스템을 써서 모든 버튼이 먼저 작동하게 해. AI 답변 품질 개선은 후순위다.
mock 흐름이 완성되면 #64 PR100을 재사용해 실제 intake/summary adapter 연결을 진행해.
실제 API/외부 키가 없다는 이유로 UI mock을 멈추거나 새 DB 기반 작업을 만들지 마.
담당 흐름·새로고침·오류/재시도와 타입·빌드만 확인하고 전체 corpus는 반복하지 마.
75~100분 안에 PR과 시작 경로/검증 결과/미연결 API를 남겨 A가 통합할 수 있게 해.
검증된 PR 생성·수정은 허용한다. main 통합·preview는 A와 조율해. 다른 세션에 인계 메시지를 보내도 된다.
새 세션/Goal/추가 에이전트를 만들거나 작업 프롬프트를 다시 쓰지 말고 구현해.
```

### C: workspace·대화·자료

```text
BARO 5세션 작업의 C를 맡아 #104를 구현해.
AGENTS.md, README.md, docs/development/PARALLEL-UI-SPRINT.md,
docs/development/CLIENT-API-CONTRACT.md와 GitHub #104/#65를 읽고 최신 main에서 시작해.
별도 worktree/codex/104-workspace-ui-api-mock 브랜치, 개발 포트 4342를 사용해.

2시간 내 실제 /cases/{id} workspace에서 채팅/자료/타임라인/다음 행동 UX를 완성해.
채팅 전송/실패 재시도, 파일 선택/업로드/처리 상태/추출 결과/미리보기/삭제,
행동 체크, 타임라인 추가·편집, 새로고침 후 이어서 이용까지 같은 API mock 상태에 저장해.
별도 mock 사이트나 컴포넌트 fixture import를 만들지 말고 api.workspace와 api.files를 호출해.
A의 기반 병합을 기다리지 않고 고정 계약으로 소유 화면부터 만들고 A 첫 commit을 통합해.

소유는 cases/[caseId].astro와 하위 files/timeline/actions 페이지,
components/workspace, analysis의 v1 호환, client/api/workspace.ts,files.ts와 해당 mock,
styles/workspace.css다. B의 intake/summary와 D의 reports/settings는 편집하지 마.
리포트 버튼은 /cases/{id}/reports로, 변호사 탐색은 /lawyers로 연결해.
공통 types/global/layout/CI/schema는 소유자가 바꾸게 하고 완료된 v1 흐름을 보존해.

기존 디자인 시스템을 재사용해 모든 탭/상태를 먼저 클릭 가능하게 만들어.
AI 답변 품질·전 미디어 품질 평가는 후순위다. mock 완료 영역부터 기존 #58/#59/#64 API와
PR100을 재사용해 real adapter를 연결하고, 외부 blocker는 UI 개발 선행으로 두지 마.
담당 동작·새로고침·오류/재시도와 타입·빌드만 확인하고 전체 corpus/대용량 회귀를 반복하지 마.
75~100분에 PR과 시작 경로/검증 결과/미연결 API를 남겨 A가 통합하게 해.
main 통합·preview는 A와 조율해. 이 작업의 세션 간 인계 메시지는 허용한다.
새 세션/Goal/추가 에이전트·프롬프트 재작성 없이 구현해.
```

### D: 리포트·다운로드·설정·삭제

```text
BARO 5세션 작업의 D를 맡아 #105를 구현해.
AGENTS.md, README.md, docs/development/PARALLEL-UI-SPRINT.md,
docs/development/CLIENT-API-CONTRACT.md와 GitHub #105/#66/#67/#68을 읽고 최신 main에서 시작해.
별도 worktree/codex/105-reports-settings-api-mock 브랜치, 개발 포트 4343을 사용해.

2시간 내 실제 /cases/{id}/reports와 /settings에서 리포트 검토/수정/마스킹/자료 제외,
PDF/선택 자료 ZIP 다운로드, 사용량/한도, 사건·계정 삭제 확인, help/policy 흐름을 완성해.
UI는 api.reports/api.account를 호출하고 API mock 응답만 바꿔. 별도 데모 화면/fixture 직접 import 금지.
실제로 열 수 있는 합성 PDF/ZIP을 반환하고 다른 파일에 pdf/zip 확장자만 붙이지 마.
mock 저장소의 삭제가 목록/자료/session에 반영되고 새로고침 후도 유지되는지 확인해.

소유는 reports 페이지/components/reports, settings/AccountSettings, help/policy 페이지,
client/api/reports.ts,account.ts와 해당 mock, styles/reports.css,settings.css다.
chat/files/intake/lawyer 화면과 공통 types/global/layout/CI/schema는 편집하지 마.
자료는 C의 api.files.list를 사용하고 사건·요약은 B/C와 동일 id를 사용해.
운영자 승인 UI는 만들지 말고 기존 공개 정책 초안/승인 상태를 꾸미지 마.

기존 디자인 시스템으로 전체 상호작용을 먼저 연결해. 실제 R2/모델/복구 drill을 mock 개발 선행으로 두지 마.
담당 mock UX 완료 뒤 #66/#67/#68의 real API 연결을 가능한 범위에서 재사용해 진행해.
담당 다운로드·저장/삭제·새로고침과 타입·빌드만 검증하고 전체 사례 검사를 반복하지 마.
75~100분에 PR과 시작 경로/검증 결과/미연결 API를 남겨 A가 통합하게 해.
main 통합·preview는 A와 조율해. 다른 세션에 작업 인계 메시지를 보내도 된다.
새 세션/Goal/추가 에이전트·프롬프트 재작성 없이 구현해.
```

### E: 변호사 프로필·디렉터리

```text
BARO 5세션 작업의 E를 맡아 #106을 구현해.
AGENTS.md, README.md, docs/development/PARALLEL-UI-SPRINT.md,
docs/development/CLIENT-API-CONTRACT.md와 GitHub #106/#62를 읽고 최신 main에서 시작해.
별도 worktree/codex/106-lawyer-ui-api-mock 브랜치, 개발 포트 4344를 사용해.

2시간 내 변호사 역할 로그인 후 /lawyer에서 본인 프로필 편집/저장/사진·포트폴리오 관리/
공개 미리보기/공개·비공개를 완성하고 /lawyers 탐색·필터·상세·외부 연락·길찾기로 연결해.
운영 어드민, 자격 심사, 승인/반려/대기/재신청 UX는 MVP에서 전부 제외한다.
자기 역할 선택/프로필 등록을 실제 자격 확인 완료 badge로 표시하지 마.

UI는 api.lawyers를 호출하고 API mock 응답만 교체한다. 실제 제품 페이지 한 벌만 만들어.
본인 프로필 저장/공개가 directory의 같은 id에 반영되고 새로고침 후 유지되게 해.
소유는 pages/lawyer,pages/lawyers,components/lawyers,client/api/lawyers.ts와 mock/lawyers.ts,
styles/lawyers.css다. 통합 login/consent/role 저장과 공통 types/global/layout/CI/schema는 A 소유다.
완료된 #61 directory와 기존 profile 코드/승인 기록은 재사용·보존하고 전면 재작성하지 마.

A의 기반 완료를 기다리지 말고 고정 계약으로 화면을 먼저 만들어.
mock 흐름 완성 뒤 #62 기능 트랙에서 본인 profile 저장·승인 없는 공개의 real adapter/API 연결을 진행해.
새 DB/비용 기반 작업이나 기존 moderation 삭제를 선행하지 마.
담당 저장/공개·목록·모바일·오류/재시도와 타입·빌드만 확인하고 전체 corpus는 반복하지 마.
75~100분에 PR과 시작 경로/검증 결과/미연결 API를 남겨 A가 통합하게 해.
main 통합·preview는 A와 조율해. 다른 세션에 인계 메시지를 보내도 된다.
새 세션/Goal/추가 에이전트·프롬프트 재작성 없이 구현해.
```
