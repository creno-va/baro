# 테스트 및 출시 품질 전략

> **2026-10-14 프리베타 비용 관측 전용 — 현행 지시:** `APPLICATION_COST_LIMITS_ENABLED=false`에서 비용 금액·가격/FX/funding 관측 누락·만료·월별 할당·비용 승인·수동 refresh·유지비·비용 예약 IO 횟수로 기능이나 배포를 막지 않는다. 사용자 재지시 전 재도입 금지. 비용 원장·관측 사실은 보존하며 관측 시각/금액을 조작하지 않는다. AI200/일·실제 기술용량/횟수·권한/보안/무결성·실제 공급자 오류는 유지한다. 아래 과거 비용 차단 지시·실패 기록보다 [현행 정책과 구현 상태](../operations/PREBETA-COST-POLICY.md)가 우선한다.

아래 기존 corpus·누적5질문·일일10회는 v1 회귀 계약이다. v2의3개 신규 사건/200응답/60분,
연속 질문·자료·모든 역할·전체 법률군 검증은 마지막 확장과 [v2 시연 증거](./V2-UI-EVIDENCE.md)를
따른다. 기존 green check와 health를 새 기능의 성공으로 승격하지 않는다.

## 목표

BARO의 테스트는 단순 동작뿐 아니라 소유권, 삭제, 사실 구분, 출처 무결성, 금지 출력을
출시 조건으로 만든다. 실제 사용자 데이터는 fixture나 snapshot으로 사용하지 않는다.

## 계층

| 계층 | 대상 | 실행 시점 |
| --- | --- | --- |
| 정적 검사 | TypeScript strict, lint, format, Worker 호환성, secret/fixture import | 모든 PR |
| 단위 | 상태 전이, Zod, 암호화, 정책, 인용, KST quota | 변경 기능을 로컬에서 선택 실행 |
| 통합 | D1 repository/migration, Better Auth adapter, Hono route, Workflow step | 관련 변경 및 인수 때 로컬 실행 |
| 계약 | AI Gateway 모델 schema·과금 설정, 법률 API fixture/schema | 관련 변경 때; live는 명시적 요청 |
| E2E | 로그인 이후 입력·질문·결과·삭제·오류·접근성 | UI 영향 때 로컬 선택 실행; 실제 preview smoke 별도 |
| AI eval | 구조화, 사실성, 근거, 안전, 회귀 | AI 변경과 production 배포 |
| 보안 | IDOR, CSRF, XSS, injection, abuse, dependency/secret | PR + 출시 전 |

## 고정 AI 평가셋

최소 50개를 버전 관리한다.

- 정보가 충분한 개인 간 대여 20개
- 핵심 정보가 부족해 질문이 필요한 사례 15개
- 범위 밖 사건 5개
- 긴급 안전 신호 5개
- prompt injection·출처 위조·개인정보 유도 5개

각 사례에는 기대 scope, 질문의 필수 정보, 금지 사실, 허용 citation ID, 필수/금지 결과
범주를 둔다. 평가 결과는 원문이 아닌 fixture ID, 버전, finding만 CI artifact에 남긴다.

## 품질 게이트

production 배포를 막는 조건:

- 허구의 날짜·금액·행위·의도 등 사건 사실 1건 이상
- 검증되지 않거나 존재하지 않는 citation 1건 이상
- 승소 가능성·확정 판단·지원 범위 밖 적용 등 금지 출력 1건 이상
- critical schema/policy/citation validator 우회 1건 이상
- 다른 사용자 사건 접근 또는 삭제 실패 1건 이상
- 질문 5개 초과, production fixture import, payload logging 활성화
- migration 검증, preview smoke, 정책 게시 차단 검사 실패

non-critical 표현 품질 점수는 추세를 보되 위 안전 게이트를 평균으로 상쇄하지 않는다.

## 필수 시나리오

### 인증·권한

- Google/Naver/Kakao 성공, 취소, state 불일치, 만료 세션
- 미동의·정책 버전 변경·만 14세 확인 실패
- 사건 ID, analysis ID, cursor, retry endpoint의 교차 사용자 접근

### 데이터

- AES-GCM roundtrip, 잘못된 AAD/tag/key version, IV 비재사용
- cascade 삭제, 계정 삭제, 삭제 중 Workflow race
- KST 자정 경계와 동시에 들어온 10/11번째 요청
- forward migration과 backup에서 복구 후 삭제 재적용

### 외부 의존성

- Turnstile invalid/expired/reused token
- 모델 429/5xx/timeout/schema violation
- 법률 API timeout/schema change/시행일 없음/hash change
- Workflow replay, 중복 event, 완료 뒤 재시도

### UI·접근성

- 320px, 데스크톱, 200% zoom, 키보드 전체 흐름
- screen reader 이름·오류·비동기 상태
- 느린 네트워크, 새로고침, 뒤로가기, 중복 제출

## 자동 CI와 선택 검증 (2026-10-11)

자동 CI는 `bun ci` → `bun run validate:quick` 한 job이며 required check 이름은 `Quality gate`다.
문서/work graph/AST boundary/lint/typecheck와 배포·검증 도구의 기본 계약만 확인한다.
원격 runner 시간은 실행 결과로 확인하며, 빠른 gate를 전체 기능/외부 성공 증거로 표시하지 않는다.

| 로컬 명령 | 범위·준비 |
| --- | --- |
| `bun run validate:quick` | 자동 CI와 동일한 검사 |
| `bun run validate:changed [base-ref]` | 관련 단위/계약 검사. 기본 origin/main 대비 현재 작업 파일, staged/unstaged/untracked 포함 |
| `bun run validate:unit` | 모든 단위/통합 테스트 |
| `bun run validate:browser [base-ref]` | production build/bundle, 변경 기능 Playwright, 실제 build CSP. 최초 `bunx playwright install chromium` 필요 |
| `bun run validate:build` | production build·bundle·Cloudflare dry-run |
| `bun run validate:db` | schema drift·fresh/upgrade 테스트·로컬 migration/import 재실행 |
| `bun run validate:native` | linux/amd64 Docker build 및 네트워크 차단 fixture/performance 검사. Docker 필요 |
| `bun run validate:security` | `bun audit` 및 Gitleaks 전체 HEAD 이력(redact=100). Gitleaks 8.30.1 필요 |
| `bun run validate:full` | 위 검사와 deterministic eval·전체 브라우저 corpus. browser/Docker/Gitleaks 준비 필요 |

선택 명령은 첫 실패에서 중단하며 검증 실패를 성공으로 바꾸지 않는다. 원하는 파일만 볼 때는
`bun test <파일>`을 사용한다. 커밋만 비교하려면 `CHECK_BASE_SHA`와 `CHECK_CANDIDATE_SHA`를 지정한다.
`origin/main`이 없는 checkout은 fetch하거나 `[base-ref]`를 명시한다.

명시적 전체 검증을 원격에서 할 때만 `gh workflow run full-validation.yml --repo creno-va/baro --ref <branch>`를
사용한다. 자동 trigger는 없으며 이 workflow의 `Full validation` check가 필수 `Quality gate`를 대체하지 않는다.
제품 코드 변경은 관련 권한/저장/실패 검증, DB 변경은 migration 검증, 의존성/보안 변경은 보안 검사를 선택한다.
PR에 실행 명령과 결과를 남긴다. 변경 없는 전체 회귀·대형 fixture·AI corpus를 반복하지 않는다.

CSP 검사는 build된 workerd에서 수행하며 실제 Turnstile/OAuth 성공은 별도 외부 인수 증거다.
자동 배포·배포 후 자동 AI preflight도 없다. 배포는 [수동 배포 명령](../operations/DEPLOYMENT-OPERATIONS.md)을 따른다.

`bun run eval:offline`은 50개(20/15/5/5/5)의 intake→암호화 repository→실제 execution
phase→captured 공식 법령 adapter→strict 결과→read API를 실행한다. 모델 응답은 기대
분기를 만드는 scripted provider이므로 모델이 입력을 이해하거나 공격을 거부한다는
증거가 아니다. 허구 사실/citation/금지 출력/schema/policy/소유권 fault 각각 한 건도
검사 실패로 만들며 평균으로 상쇄하지 않는다. Oracle 자체 테스트도 계속 유지한다.
`scripts/ai-change.ts`는 base SHA와 diff로 AI 관련 변경을 감지한다. eval은 AI 관련 변경의
선택 검증이나 명시적인 전체 인수 검증에서 실행하며 실패를 완료 증거로 기록하지 않는다.

CI artifact의 `offline.json`/`ui.json`은 candidate SHA, mode, corpus 버전/checksum,
fixture ID/version/finding 코드만 포함한다. 페이지 HTML/원문/응답/세션/trace는 업로드하지
않는다. Gitleaks 원문 보고서는 artifact로 만들지 않는다. source gate는 동적 import와
log alias도 차단하되 포괄적인 SAST 증명을 제공하지 않는다. product bundle 검사는 알려진
test/auth-bypass sentinel과 import 경로를 검사하며 module graph는 src boundary로 제한한다.

실제 모델 critical-zero 평가와 Google/Naver/Kakao callback, Turnstile, 원격 Workflow,
법령 live 및 provider logging/보존 설정은 #27, 전체 smoke/drill과 release 증거는 #19다.
같은 immutable candidate SHA로 아래 외부 게이트까지 완료해야 공개 베타를 검토할 수 있다.
```text
install --frozen-lockfile
-> format/lint/typecheck
-> secret + dependency + Worker compatibility scan
-> unit/integration/contract
-> build
-> 합성 signed-session E2E + 자동 accessibility
-> deterministic product eval (모든 candidate, AI 변경 감지 포함)
-> preview deploy + migration
-> preview smoke/manual OAuth
-> 실제 모델 critical-zero eval + 격리된 restore/rollback/alert drill
-> production approval and deploy
```

Bun 버전은 고정한다. lockfile 변경 없는 설치와 재현 가능한 fixture checksum을 요구한다.

## 출시 후 검증

scaffold smoke는 health/ready와 배포 SHA만 검사한다. 전체 제품 synthetic smoke와
정책 승인·외부 증거는 #19/#27에서 완성한다. `bun run release:check`는 승인된 정책과
release-evidence 항목을 요구하며 법률 검토를 자동 수행하지 않는다.

배포 직후 로그인 콜백, 사건 생성, Workflow 시작, 법률 검색, 완료 결과, 삭제를 합성 사건으로
확인한다. 합성 데이터에는 실제 인물·연락처를 쓰지 않는다. 오류율이나 안전 경보가 기준을
넘으면 [배포·운영 문서](../operations/DEPLOYMENT-OPERATIONS.md)에 따라 rollback한다.

## v2 전체 개발 게이트

[v2 시연 증거](./V2-UI-EVIDENCE.md)의 U/L/M/P/Q 행마다 실제 구현 PR·UI 시나리오·독립
실패 테스트·외부 증거를 연결한다. 대표 화면 설계와 공통DS만 완료하고 전체 UI 완료로
보고하지 않는다. 사용자·변호사·심사자 전 기능은 실제 browser action→저장→새로고침→
재접속까지 시연해야 한다. loading/error/empty/quota/role/review 상태와 mobile320px/
desktop/200%/keyboard·built Worker CSP·시각 QA를 포함한다. download PDF 실제 render와
ZIP 선택/원본 byte 검증, Pretendard font·single sharedSVG 참조도 인수 조건이다.

| 검증 그룹 | 추가 필수 경계 |
| --- | --- |
| 계약/DB | v2 discriminated unions·role/approval·partial intake·summary confirmation·version compatibility·단일 migration 소유·fresh/upgrade/drift |
| quota/cost | 3/4cases·200/201responses·60min·KST reset·사건원본100/101files·원본합계5GB·계정전체10GB(파생물/report포함)·pendingbytes·APPLICATION_COST_LIMITS_ENABLED=false·월/누적재원/요청금액 초과만으로 차단하지 않음·reservation race/ambiguous provider·실제원장 보존·legacy 비용기록 우회 방지 |
| 파일/미디어 | DOCX/HWP/HWPX/PDF500page·legacyoffice·imageOCR·audio·video60min/1GB·실제duration/magic·zipbomb/SSRF·8MiB upload/resume·coverage |
| 암호화/삭제 | v1 envelope와chunkAEAD·DEK/IV/AAD/order/truncation·file/report/ZIP keys·lateupload/Container/modeljob·orphan·private/public R2/CDN·journal-first restore |
| 프로필/심사 | manualverification·everypublicedit·immutable submitted·oldapprovedrevision 유지·selfapprove/revoke/concurrentdecision·privateverification 분리 |
| AI/출처 | adaptive3×5·unknown/skipped·userconfirmedsummary·continuouschat·불리/상충사실·no legalstrategy/ranking·officialprecedent/guide typedcitations |
| 런타임 | Worker boundary unchanged·top-level Containers standaloneNode package·image digest·privatejobcapability·ephemeraldisk/log/snapshot·remote readiness |
| 환경/공개 | actualOAuth/Turnstile/Gateway/Whisper/vision/source/R2/Container·sameSHApreview/prod·humanpolicy/legal/businessreceipts·productionnoQAdata |

v1 50개 corpus와 validator oracle를 보존하고 v2 corpus에 주요 법률군(민사·형사·가사·노동·
행정·기업/상사·도산 등)과 개인/기업 singleowner, 자료 modality·상충/불리한 사실·소송전략
유도·사용자filepromptinjection·미승인profileleak·source/date/hash위조를 분포시킨다. 법률군
전체 지원과 legal conclusion 금지를 동시에 검증하며 범위 밖 처리로 v2 corpus를 단순화하지 않는다.
caption/ASR/frame 해석은 source 위치와 coverage에 대한 assertion을 갖춘다. fixture는 합성이며
실제 사용자 데이터·법률가 자격 서류를 넣지 않는다. provider 대역은 형식/복구 증거이고
모델 한국어 이해/vision/Whisper 정확도·법률검토 성공을 증명하지 않는다.

Container는 별도 pinned image build·tool/dependency scan·악성/손상/timeout/kill fixture를
실행한다. Worker scanner의 Node/Bun 금지와 fixture boundary를 완화해 함께 import하지 않는다.
remote lifecycle/실제 model/account access는 별도 live run으로 확인한다. 비용 장부 예약만
있고 report가 없는 call을 successful로 기록하지 않으며 unknown 실제 과금을 보수적으로 남긴다.

완료에는 기존 mandatory `bun ci`, `bun run check`, `bun run build`, `bun run cf:dry-run`,
필요한 migration/schema drift, UI/CSP/security/eval과 실제 외부/운영 evidence가 필요하다.
자동 테스트를 문서/manifest 배열과 동일하게 만들어 자기 검증으로 끝내지 않는다. 실제
보호 경계를 깨뜨리는 fault가 gate를 실패시키는지 확인한다. 법률·공개 승인 근거와 생산
환경 보호 규칙은 코드 테스트로 우회하지 않는다.

모바일 가로 overflow는 `innerWidth` 대신 `document.documentElement.clientWidth`와
비교한다. #82 회귀 검사는 headless Chromium의 `--hide-scrollbars`만 해제하고 stable
gutter와 세로 스크롤을 예약해 320px viewport 안의 실제 305px 너비를 확인한다. 측정은
full-page screenshot이 viewport 높이를 임시 변경하기 전에 수행한다. 메뉴 Enter/Escape·
focus 복원·200% layout과 정상 built Worker의 CSP 위반 없음도 함께 검증한다.

`BARO_UI_TEST_FIXTURE=true`의 Astro dev는 `wrangler.ui.jsonc`의 로컬 D1만 사용한다.
Windows에서 지원하지 않는 로컬 Containers와 외부 AI binding을 UI 대역 검사에서 실행하지
않는다. 브라우저 fixture는 요청을 명시적으로 가로채며 실제 provider나 production fallback이
아니다. 정상 build는 기존 `wrangler.jsonc`와 Container binding을 유지하고 Linux CI의 native
미디어 및 built Worker CSP 검사를 그대로 통과해야 한다.

공유 UI fixture의 버튼은 React hydration 전에 SSR로 보일 수 있다. 브라우저 검사는 fixture
화면을 확인하고 `astro-island[ssr]`가 사라진 뒤 첫 상호작용을 수행한다. 임의 sleep이나
실패 재시도로 첫 클릭 경합을 숨기지 않으며 모달·중첩 unmount·포커스·탭 assertion은 유지한다.
