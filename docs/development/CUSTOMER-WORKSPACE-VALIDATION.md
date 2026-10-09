# 고객 사건 연결 회귀 검증 (#64, #65)

- 기준: main `ca6e15b` (UI PR125 병합), `codex/65-customer-workspace`.
- 통합 기준: main `7943496` (공유 PR127의 역할 경계·session marker·dependency audit 수정 병합). 공유 수정은 해당 선행 PR에서 가져왔다.
- 최종 통합 기준: main `a5130db` (공유 PR129의 정식 WorkspaceView 및 고객 real browser 순차 runner 병합). 고객 DTO는 공유 WorkspaceView를 직접 재사용한다.
- 추가 통합 기준: main `5e094b7` (변호사 PR126 및 공유 fixture PR131 병합). 고객 poll 경합 수정의 최종 회귀는 이 기준에서 수행한다.
- 경로: 기존 `/cases`, `/cases/:id/intake`, `/cases/:id/summary`, `/cases/:id`와 자료·타임라인·할 일 탭.
- 공유 contracts/schema/migration/router/auth/session/CI는 수정하지 않았다.
- 기존 workspace execution engine과 llm-gateway를 재사용한다. 새 공급자·모델·품질 corpus는 추가하지 않는다.

## 재현과 수정

| 실패 조건 | 결과와 증거 |
| --- | --- |
| 요약 PUT 또는 확인 POST가 실제 저장 후 응답만 유실 | 원래 intake/summary revision, 본문, idempotency key로 재전송한다. 성공 응답과 authoritative 조회가 끝나기 전에는 요청을 해제하지 않는다. 요약 화면의 background refresh도 실패한 요청 revision을 교체하지 않는다. |
| 같은 key의 변경된 본문 / 새 key의 오래된 revision / 다른 owner | 실제 Hono API가 각각 409 / 409 / 404를 반환한다. 저장 revision이 다시 증가하지 않는다. |
| 확인된 v2 사건의 owner 접근 거부 | 요약/질문 adapter도 v1 fallback을 보내지 않고 실제 404를 유지한다. Hono의 foreign-owner GET 뒤 legacy 요청이 없음을 검사하며 기존 v1 사건 fallback은 보존한다. |
| 다른 탭의 로그아웃·계정 변경·역할 변경 | 고객 screen boundary가 identity epoch를 폐기하고 요약·확인 checkbox·메시지·자료·파일 input·초안·대화상자를 지운다. mutation 전후 세션을 확인하고 이전 epoch의 늦은 결과를 적용하지 않는다. |
| session 조회의 일시적 네트워크 장애 | 정상 owner의 초안을 보존하고 쓰기를 보내지 않는다. 외부 변경 재검증이 불가능하면 UI를 가린 채 초안을 보관하며 같은 owner를 확인한 뒤 복구한다. 실제 401/동의 거부/404와 구분한다. 명시적인 Better Auth signout 알림은 네트워크 상태와 관계없이 즉시 지운다. |
| 재시도 session 조회 중 15초 배경 poll | 배경 poll은 진행 중인 foreground session 조회를 취소하지 않는다. 실제 session 응답을 지연시키고 등록된 15초 callback을 호출한 browser 회귀에서 수정 전 authoritative workspace 조회가 생략됨을 재현했고, 수정 후 새 조회와 초안 보존을 확인한다. |
| 기존 v1 질문의 저장 전 답변과 focus 재검증 | 기존 CaseDetail을 가리고 inert 상태로 보존해 같은 owner 확인 시 답변을 복구한다. 실제 계정 변경/접근 거부는 view를 없애 기존 subtree도 제거한다. 기존 analysis browser에서 모름/건너뛰기 답변의 focus 후 보존을 재현·검사한다. |
| 작업 도중 customer→lawyer 변경 | runtime은 admission, execution, 각 gateway reserve와 게시 전 권한을 재검사한다. 실제 account-type API로 합성 모델 실행 도중 역할을 바꾼 회귀에서 결과가 게시되지 않고 이후 작업은 stopped가 된다. 비용 receipt는 지우지 않는다. 공유 403/ROLE_REQUIRED도 고객 adapter에서 접근 거부로 매핑한다. |
| 타임라인 생성 저장 후 응답 유실 | POST receipt와 결정적인 entity ID를 재사용한다. 생성은 workspace revision, 편집은 entity revision을 검사한다. 새로고침 후 1개 항목만 남는다. |
| 이전 batch 질문 수정 | 질문 ID로 원래 batch를 찾고 해당 batch 계약으로 검증한다. 요약을 무효화하고 다른 batch 답변은 보존한다. |
| 처리 ACK/job ID 유실 뒤 currentJobId 해제 | owner-scoped latest job을 조회해 실패/진행 상태를 복구한다. browser storage가 없어도 실패한 intake/chat job을 찾는다. |
| chat ACK는 받았지만 뒤의 workspace 조회가 실패 | client의 원래 RequestInit을 유지해 동일 key/body로 receipt를 복구한다. 사용자 메시지 1개를 보존한다. |
| 반복 polling/focus | workspace 권한 조회는 유지하되 같은 workspace revision의 요약·메시지·행동·타임라인 목록을 재사용한다. 자료 목록과 job 상태는 갱신한다. 사건 목록은 optional previews로 항목별 HTTP intake 조회를 줄인다. |
| 작은 화면·키보드·200% 확대 | 읽던 채팅 위치를 유지하고, dialog를 visualViewport/zoom에 맞추며 저장 버튼을 보이게 한다. 입력 글꼴 16px, safe-area composer, 키보드 Enter 저장을 검사한다. |

## 재실행 가능한 증거

아래 명령은 같은 checkout에서 순차 실행한다. Bun 1.3.14와 Node를 PATH에 둔다.

```sh
bun ci
bun run check
bun test ./tests/independent-review/intake-real-retry.repro.ts
bunx playwright test --config tests/browser/intake103.config.ts
bunx playwright test --config tests/helpers/customer-mock.playwright.config.ts --grep 'intake summary|workspace clears|owner API boundaries'
bunx playwright test --config tests/browser/customer-real.config.ts
BARO_C_TEST_API=true bunx playwright test --config tests/helpers/workspace.playwright.config.ts
bun run build
bun run cf:dry-run
bun run test:csp
```

- `tests/customer-workspace-api.test.ts`: 실제 Hono route, 서명된 합성 session, migrated SQLite D1 binding, 실제 암호화 repository와 execution engine을 사용한다. 응답을 버리기 전에 서버 응답 성공과 저장 revision을 확인한다. 모델 admission/응답은 명시적 합성 fixture다.
- `tests/browser/customer-real.e2e.ts`: 제품 UI의 real domain adapter를 loopback Hono 서버에 연결한다. 저장/확인/타임라인 응답을 commit 후 중단하고 wire body/key, 새로고침, cookie owner 변경, 동일 owner의 실제 역할 저장, network 실패 시 초안을 검사한다. 390×844, 200% browser 확대에 해당하는 640×450 CSS viewport reflow, 별도의 1280×900 CSS zoom 2 스트레스 검사를 순차 실행한다. CSS zoom은 media query가 유지되는 점에서 browser 확대와 다르다. screenshot은 Playwright test-results에 생성한다.
- 기존 intake browser 6개 및 independent-review의 해당 결함 3개를 보존하고 회귀 검사한다. 다른 소유 영역의 전체 independent-review를 이 결과로 대체하지 않는다.
- `tests/workspace-client.test.ts`: 기존 v1 fallback, owner/deleted-case 404와 일시적 503 구분, revision 캐시 invalidation, 파일 upload의 합성 재접속 증거를 보존한다.

이 증거는 실제 OAuth provider 로그인·실제 유료 모델·R2/Containers/Whisper 처리 성공을 뜻하지 않는다. 실제 기기의 OS 키보드, 외부 장애 복구 및 공개 승인 gate는 별도 검증이다.

PR127 통합 전 로컬 결과(2026-10-07 KST): `bun ci`, `bun run check`(1,210개 및 migration 6개), 기본/production build, bundle check, `cf:dry-run` 통과. 브라우저는 홈 7개, intake 6개, v1/실제 API/XSS 11개(실제 고객 Hono 연결 3개 포함), workspace fixture 4개, 알려진 결함 3개로 총 31개 통과했다. CSP는 production Worker 4개 통과, 별도 explicit fixture build 전용 1개는 정상 조건부 skip이다. 원래 summary 재시도 `.repro.ts` 2개도 통과했다. 기존 4350 포트는 다른 checkout이 사용 중이므로 홈 검사는 동일 config의 포트/cwd만 4357/고객 worktree로 바꿔 실행했다. 공유 CI config는 변경하지 않았다.

PR127 통합 후 실제 API의 동일 owner 역할 거부는 403/ROLE_REQUIRED를 정확히 검사하고, 고객 adapter가 이를 NOT_FOUND로 매핑하는 것도 같은 Hono 응답으로 검사한다. 다른 owner는 기존 404, 실제 충돌은 409다. 통합 후 전체/browser/CI 결과는 PR128의 최종 head 증거로 기록한다.

## 통합 세션 인계

- 고객 namespace에 POST `/api/v2/cases/:id/timeline`을 추가했다. 기존 `v2TimelineEditRequestSchema`를 사용하며 create의 expectedRevision은 workspace revision이다. 201에는 기존 timeline entry 계약을 반환한다. PUT 편집 계약은 유지한다.
- GET `/api/v2/cases/:id/workspace-jobs/latest`은 기존 Job 또는 null을 반환한다. owner/workspace로 제한하며 intake/chat만 선택한다. client는 구버전 route의 404를 허용한다.
- 사건 목록 응답의 optional `previews: { id, title, hasSummary }[]`는 기존 items/cursor를 유지한다. 고객 workspace view의 optional facts/people/unknowns/notices는 기존 Summary 계약에서 읽는다. 4번의 PR129에 병합된 정식 공유 WorkspaceView와 계약 문서를 재사용한다.
- shared session의 `baro-session-changed` peer-tab/same-tab marker는 4번의 PR127에서 병합됐다. 고객 boundary는 이 marker와 Better Auth의 `better-auth.message`, focus/pageshow/visibility 및 15초 session 검사를 사용한다. 동일 owner의 lawyer 전환은 공유 403/ROLE_REQUIRED 경계와 고객 API namespace 가드에서 거부한다.
- 자료 처리 POST `/api/v2/cases/:id/files/:fileId/retry` 연결은 2번 소유이며 [요청 코멘트](https://github.com/creno-va/baro/issues/59#issuecomment-6018985215)에 기록했다. 자료 API/처리/report/삭제는 이 PR에서 변경하지 않는다. 처리 요청의 실제 외부 성공을 합성 upload 증거로 대신하지 않는다.
- #64/#65 및 #70/#71 외부·정책·공개 조건은 OPEN으로 보존한다. PR은 Refs만 사용한다. 병합·배포는 4번 통합 세션에 맡긴다.

## 2026-10-08 요약 조회 응답 경합 수정

요약 화면에서 focus 조회가 겹치면 먼저 시작한 요청의 늦은 응답이 최신 요약과 확인 상태를
되돌리거나, 최신 조회 성공 뒤에 오래된 오류를 표시했다. 기존 코드에서 두 조건을 각각
브라우저로 재현했다. 조회 순번을 검사하고 저장·확인·계정 상태 초기화 때 이전 조회를
무효화해 현재 요청의 결과·오류·로딩 종료만 반영한다.

`tests/browser/intake103.e2e.ts`의 조회/저장 이후 지연 성공/실패 조합 4개를 포함한
25개 브라우저 검사가 통과했다. 합성 API adapter를 사용하는 회귀이며 실제 외부 로그인·AI
성공 증거는 아니다. PUBLIC_PREVIEW와 기능 제한·화면 구조·공유 계약·DB는 변경하지 않았다.

로컬 필수 검사: frozen `bun ci`, 문서·작업 그래프·경계·lint·타입 검사, `bun run build`,
`bun run cf:dry-run`, schema drift/fresh/upgrade migration 6개가 통과했다.
`bun run check`는 단위 검사 1,394개 통과/33개 실패로 종료했다. 실패는 변경하지 않은
법률 벤치마크의 Windows 경로 문자열 import(26개)와 테스트 선택기의 역슬래시 경로
처리(7개)에서 발생했다. 전체 검사 성공으로 표시하지 않는다.

실제 Hono/SQL·서명된 합성 세션을 사용하는 `customer-real.e2e.ts`는 640px/1280px가
통과했다. 최초 390px 실행은 저장 재시도 버튼 클릭 중 60초 timeout으로 실패했고,
동일 코드의 모바일 단독 재실행은 통과했다. 외부 OAuth·AI·R2 검증과 구분한다.
로컬 시연은 API mock과 PUBLIC_PREVIEW_TEST를 사용해 배포의 기능 제한을 유지했다.
