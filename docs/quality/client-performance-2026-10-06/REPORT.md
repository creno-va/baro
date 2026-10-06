# BARO 실제 client 성능 프로파일 — 2026-10-06

가장 효과가 확인된 후보는 대화 시간 표기용 `Intl.DateTimeFormat` 재사용이다. 동일한 실제 Workspace UI와 1,000개 메시지를 유지한 built-artifact 실험에서 입력 Event Timing p95가 **392 → 48ms (87.8% 감소)**, 30회 입력 중 긴 task가 **30 → 0개**로 줄었다. 제품 파일은 수정하지 않았고 [후보 patch](../../../scripts/profiling/candidates/shared-chat-formatter.patch)를 담당자 검토용으로 제출한다.

## 고정 기준과 범위

- 측정 기준: **9ae91932c99f54a1618c3697cf160ad1607007d9**, A가 #102에 인계한 #110의 당시 head. 별도 managed worktree `baro-client-profile`에서 고정했다.
- #102에 명시적 고정 SHA와 C/A 조율을 요청했으나 측정 종료 시 별도 지정 회신이 없었다. 따라서 이것을 A가 추가 승인한 SHA라고 표현하지 않는다. 이후 #110 head/main 변경을 측정에 섞지 않았다. 앞선 dc22c26 탐색 실행은 아래 증거에서 제외했다.
- 착수 21:47 KST. 최종 반복 측정과 분석은 같은 60분 창 안에서 수행했다. 추가 chat, Goal, agent, schedule 없음.
- 실제 `/login`, `/cases`, `/cases/:id`, `/cases/:id/reports`, `/lawyer`, `/lawyers` 구현체의 optimized build를 Workers 로컬 런타임으로 실행했다. 별도 mock 화면 없음.
- `PUBLIC_API_MODE=mock`의 합성 localStorage와 `PUBLIC_API_MODE=real`의 합성 native HTTP DTO intercept를 구분했다. **OAuth, DB, AI, 실제 API 서버 처리시간, preview/production 성능 또는 외부 성공을 검증한 결과가 아니다.** #70/#71/P0.3 공개·정책 gate는 유지한다.
- 도구 PR의 main 통합과 측정 source SHA는 별개다. 제품 변경을 main에서 받아도 이 보고서의 기준은 위 SHA이다.

## 재현 조건과 지표

[도구 실행 방법](../../../scripts/profiling/README.md), [전체 반복별 수치/리소스/해시](results.json).

| 항목 | 조건 |
| --- | --- |
| 기기 | Windows 11 10.0.26200, Intel Core i3-1315U, 논리 코어 8, RAM 16,847,990,784 bytes |
| 브라우저 | Playwright Chromium 153.0.8010.12 headless, viewport 1365×900, Node 24.16.0, Bun 1.3.14, Asia/Seoul |
| CPU/cache | CDP CPU 4× slowdown, 반복마다 새 browser context, client 측정은 CDP cache disable |
| 기본 network | unthrottled localhost loopback, 외부 API 호출 intercept/차단 |
| 제한 network | latency 150ms, download 200,000 B/s (1.6Mbps), upload 93,750 B/s (0.75Mbps) |
| 반복 | mock 9시나리오×5, real HTTP 8×5 + 긴 대화×5, 후보 2×5, 제한 network 6×3, 인위 API delay 2×3, 사진/portfolio 5회, 날짜 계측 hook 제거 control 2×5 |
| 입력 크기 | 기본 사건/메시지/변호사 20개, 스트레스 각각 1,000개. 메시지 288문자/688 UTF-8 bytes, 사건 summary 240문자, report 2,500문자. 파일/행동/타임라인은 비움 |
| 입력 동작 | Workspace composer와 변호사 검색에 ASCII 30문자 `synthetic input response 12345`, key 간 요청 delay 30ms. 사진 편집은 이름 입력 22문자 |

JS bytes는 초기 외부 script 응답의 gzip encodedBodySize와 decoded body 합계이다. 표의 KB는 1,000 bytes이며, 모든 페이지의 **inline script 4,579 bytes는 HTML에 별도로 포함**된다. 헤더/HTML/CSS/font bytes를 JS로 합산하지 않는다. 요청 수는 초기 ready 구간의 요청 시도이며 API만 별도 표시한다.

Hydration은 navigation origin부터 마지막 **Astro `astro:hydrate` 이벤트**까지의 wall time이다. 순수 CPU 소요 또는 데이터 로딩 완료가 아니다. hydrate 호출 span도 JSON에 별도 보존한다. `loadAndUiReady`는 `page.goto`의 load 완료 후 ready locator까지이므로 폰트 등의 load를 포함하는 상한이다. 이를 첫 사용 가능 시점이나 TTI로 부르지 않는다.

긴 task는 PerformanceObserver의 >50ms 항목이다. 날짜 호출 계측과 observer 자체 비용이 포함되며, 이 비교를 field INP 또는 순수 제품 실행 비용으로 일반화하지 않는다. 초기 구간은 load/ready 직후 snapshot까지, 입력 구간은 30 key 시퀀스까지다. Event Timing은 interactionId별 최대 duration으로 중복 제거하고, 브라우저의 16ms threshold/8ms 양자화가 적용된다. 따라서 미보고된 빠른 입력은 0ms로 간주하지 않으며 p95는 관측된 interaction의 nearest-rank 값이다. 별도 input-event → 2 RAF wall time을 함께 측정했다. 한국어 IME/실기기/field INP 측정은 하지 않았다.

## 초기 측정: 실제 UI + 제품 mock adapter

모두 5회, 시간/task count는 중앙값. 최대 task는 5회 전체 최대이다.

| 페이지 | gzip / decoded JS KB | hydration ms | 초기 긴 task 개수 / 합 ms | 최대 task ms | 전체 / API 요청 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 로그인 | 121.1 / 385.5 | 647.5 | 2 / 135 | 102 | 11 / 0 |
| 사건 20개 | 150.6 / 459.0 | 742.7 | 2 / 144 | 97 | 31 / 0 |
| Workspace 20개 | 178.4 / 534.0 | 707.0 | 2 / 136 | 90 | 37 / 0 |
| 리포트 | 168.0 / 501.1 | 646.8 | 1 / 94 | 103 | 36 / 0 |
| 변호사 편집 | 150.0 / 459.2 | 726.1 | 2 / 119 | 72 | 32 / 0 |
| 변호사 목록 20개 | 145.5 / 447.0 | 763.1 | 3 / 329 | 237 | 28 / 0 |

mock API 요청 0은 local adapter 동작의 결과이며 서버가 빠르거나 요청이 필요 없다는 뜻이 아니다.

## 초기 측정: real client + 합성 HTTP adapter

native DTO 응답 delay 0ms, 5회. backend는 실행하지 않으며 client 요청 구성/렌더만 측정한다.

| 페이지 | gzip / decoded JS KB | hydration ms | 초기 긴 task 개수 / 합 ms | 전체 / API 요청 |
| --- | ---: | ---: | ---: | ---: |
| 로그인 | 121.4 / 385.8 | 716.9 | 2 / 142 | 12 / 0 |
| 사건 20개 | 152.1 / 463.7 | 685.8 | 1 / 74 | 55 / 23 |
| Workspace 20개 | 163.7 / 501.2 | 886.1 | 3 / 194 | 39 / 7 |
| 리포트 | 157.2 / 475.7 | 729.6 | 1 / 94 | 36 / 3 |
| 변호사 편집 | 148.2 / 455.0 | 807.8 | 2 / 119 | 34 / 2 |
| 변호사 목록 20개 | 143.8 / 442.8 | 852.6 | 3 / 171 | 31 / 3 |

## 병목 상위 3개

### 1. 긴 대화에서 매 입력마다 전체 메시지 시간 표기 생성

| 같은 1,000개 메시지 mock UI | 기준 | formatter 재사용 후보 |
| --- | ---: | ---: |
| 입력 Event Timing p50 / p95 ms (각 150 interactions) | 224 / 392 | 24 / 48 |
| input → 2 RAF 중앙값 / p95 ms | 217.3 / 393.1 | 23.7 / 33.7 |
| 30 key 중 긴 task 개수 중앙값 | 30 | 0 |
| DOM nodes / 초기 요청 | 4,209 / 37 | 4,209 / 37 |
| decoded / gzip JS bytes | 534,025 / 178,398 | 534,257 / 178,511 |

composer state 변경이 전체 Workspace 렌더를 반복한다. 기본 20개 메시지는 30회 입력에 날짜 포맷 호출 600회, 1,000개는 30,000회였다. 옵션을 매번 전달하는 `toLocaleTimeString` 대신 동일한 `Intl.DateTimeFormat` 한 개를 재사용했다. 메시지 수/표시/저장/권한 처리를 줄이지 않았다. 20개 메시지에서는 전후 p95 48ms로 개선을 주장할 근거가 없다. 초기 hydration 개선도 작은 표본/순서 변동 때문에 주장하지 않는다.

real HTTP client의 기존 history adapter는 1,000개 fixture 중 **500개까지만 가져왔다**. 실제 렌더 500개, API 16회, 입력 p50/p95 128/152ms, 긴 task 30개였다. 1,000개 표시 실험과 같은 규모라고 혼합하지 않는다. 기존 cap 축소는 제안하지 않는다.

같은 고정 built artifacts에서 날짜 호출 hook을 완전히 복원한 별도 5회씩 control에서도 입력 p50/p95는 **240/312 → 32/56ms (p95 82.1% 감소)**, input→2 RAF 중앙값은 **239.9 → 27.9ms**, 긴 task는 **30 → 0개**였다(각 150 interactions). 다른 observer는 양쪽에 동일하게 남는다. control은 tool checkout SHA를 별도 기록하며 retained build source는 9ae9193이다. 전후 실행 순서와 호스트 부하가 완전히 격리되지 않은 한 기기의 결과이고, field INP로 일반화하지 않는다.

이 patch가 **가장 효과가 확인된 하나의 개선**이다. 145개 날짜(유효 144개 + invalid)에서 기존 ko-KR 시간 표기와 일치했고, 후보 built UI의 메시지 저장→reload와 다른 owner의 reload 후 차단을 확인했다. cross-tab 권한 전환 전체 보장을 의미하지 않는다. 소스 적용 후 담당자는 source build와 같은 검증을 다시 해야 한다.

### 2. 사건 목록의 전 페이지 로딩 + 건별 intake fetch

실제 client adapter의 API 수: session 1 + legacy 빈 목록 1 + v2 목록 `ceil(N/50)` + intake N. 1,000건에서 **1,022 API / 1,054 전체 요청**이 일관되게 발생했다. metadata는 5개씩 batch되며 전체 페이지가 끝나야 목록 ready가 된다.

| 사건 목록 | mock load+ready ms | real HTTP delay 0ms | 합성 API당 delay 150ms (3회) |
| --- | ---: | ---: | ---: |
| 20개 | 1,004.6 | 986.0 | 2,204.5 |
| 1,000개 | 1,860.1 | 5,359.8 | 40,273.9 |

40.3초는 인위적으로 넣은 delay를 순차 요청 구조가 증폭한 결과이며 실제 서버 예측/벤치마크가 아니다. 1,000개 case DOM은 13,129개, mock 초기 긴 task 최대 425ms였다. 목록에는 직접 입력 필드가 없어 입력 반응 수치를 만들어내지 않았다.

B/A와 조율할 다음 후보: 목록 DTO에 현재 표시하는 최소 metadata를 포함하고 cursor 단위 표시/추가 로딩. 모든 사건 접근과 owner 검사, 저장 경로, 필요한 정보를 보존해야 한다. 이번 PR에서 공유 API/화면 변경은 하지 않았다. 변호사 목록도 1,000개를 전부 가져오고 처음 20개를 표시했다(22 API); 검색 p95는 24ms, 입력 긴 task 0으로 이번 입력 병목은 아니었다.

### 3. 모든 페이지의 2,057,688-byte 폰트 전송

`/fonts/PretendardVariable.woff2`가 매 cold context에서 2.06MB, gzip JS보다 약 12~17배 컸다. 제한 network 3회에서 hydration 중앙값은 1.80~2.51초, load+ready는 11.95~12.40초였다. 한 login 반복의 폰트는 시작 479.1ms/완료 11,651.3ms였다.

| 제한 network 페이지 | hydration ms | load+ready ms |
| --- | ---: | ---: |
| 로그인 | 1,800.5 | 11,947.5 |
| 사건 20개 | 2,097.4 | 12,243.1 |
| Workspace 20개 | 2,103.4 | 12,399.2 |
| 리포트 | 2,100.8 | 12,328.9 |
| 변호사 편집 | 2,509.1 | 12,218.9 |
| 변호사 목록 | 2,432.9 | 12,165.7 |

`font-display: swap` 때문에 hydration은 폰트 완료보다 먼저다. 이를 12초간 입력 불능이라고 해석하지 않는다. A 소유 개선 후보는 전체 glyph coverage와 OFL 고지를 보존한 unicode-range 분할이며, 아직 전후 측정/patch를 만들지 않았다.

## 요청된 추가 조사

- **island:** 로그인 1개(AuthButtons), 고객 화면 3개(AppNavigation/domain/AnalyticsChoice), 변호사 화면 2개(navigation/domain). 중복 inactive island라는 증거는 없었다. navigation/session 권한 UI나 analytics 동의 UI를 제거하는 개선은 제외했다. visible/idle scheduling은 별도 측정이 필요한 제안이다.
- **사용하지 않는 domain mock:** Workspace 첫 domain 요청의 `initializeHttpMocks`가 workspace/files/reports/account를 함께 import했다. 화면이 reports/account를 호출하지 않아도 reports 6,243 + account 3,998 + report download/adapter 7,516 = **17,757 decoded bytes**가 로드됐다. 전체 mock/real JS 차이를 전부 이것으로 귀속하지 않는다. A 소유 lazy domain dispatcher가 다음 후보이며 공통 상태, account 삭제 cleanup, replay 동작을 유지해야 한다.
- **중복 fetch:** cold 초기 요청은 예상 개수였으며 임의로 중복이라고 세지 않았다. 별도 visible 문서에 focus/visibilitychange를 동시에 발생시키고 aggregate 응답을 200ms 지연시키는 probe에서는 같은 Workspace endpoint GET이 **2회** 발생했다. 자연 사용 빈도는 미측정이다. in-flight dedupe 후보를 A/C에 전달하며 owner/visibility 검사 제거는 금지한다.
- **사진/portfolio:** 실제 변호사 editor에 deterministic noise JPEG 2048×2048, **3,664,567 bytes**와 portfolio 링크 30개를 입력해 5회 측정했다. 기존 photoData 경로는 240×240/36,711문자(프로필 전체 39,441 UTF-8 bytes)로 변환했고 preview 중앙값 188.8ms, 이름 입력 p95 24ms, 입력 긴 task 0이었다. 저장/reload 후 사진이 모두 유지됐으며 portfolio 외부 자원 fetch는 0이었다. media 반복은 context 새로 생성/CPU 4×, network 무제한, 별도 CDP cache-disable 미설정이다. 승인된 R2 원본/파생 사진의 실제 전송은 미검증이다. directory의 `loading=lazy`는 img 디코딩을 늦추지만 JSON에 포함된 photoData 다운로드까지 줄인다고 주장하지 않는다.
- **반복 렌더:** 긴 채팅의 동일 날짜 포맷 30,000회가 직접 관찰된 반복 작업이다. 목록 가상화/메모화 전체 재작성은 이번 source ownership 범위에서 제외했다.

## 변경 경계, 조율과 검증

제품 화면, 공통 API, contracts/schema, package/lockfile, 공개 gate를 수정하지 않았다. PR에는 독립 Node/Playwright 도구, 결과, 적용하지 않은 한 파일 후보 patch만 포함한다. 런타임 제품에 Node/Bun API를 추가하지 않는다.

[#102 시작/고정/담당자 조율](https://github.com/creno-va/baro/issues/102)은 21:48 KST부터 기록했다. [후보 범위/고정 기준 전달](https://github.com/creno-va/baro/issues/102#issuecomment-6016965556), [A 소유 baseline lint 전달](https://github.com/creno-va/baro/issues/102#issuecomment-6017304495). 담당자 source 적용 승인이 없으므로 후보만 리뷰한다.

- `bun ci`, mock/real optimized `bun run build`, `bun run cf:dry-run`: 성공.
- 측정 source의 `bun run check`: 기존 A 소유 BaseLayout.astro formatter 1건에서 중단. docs/workgraph/boundaries는 성공. 동시 수정 금지에 따라 수정하지 않고 A에게 전달했다. 별도 typecheck: 0 errors (Astro 13 hints).
- profiling 도구 Biome, Node syntax, 후보 `git apply --check`: 성공. 후보 표기 동등/메시지 저장/reload/다른 owner reload 차단: 성공.
- main 통합 후 전체 check: docs/workgraph/boundaries/lint/typecheck 성공, 1,171 tests pass / 2 fail. 실패는 기존 scripts/development-checks.test.ts의 Windows Bun.Glob 역슬래시 경로가 POSIX regex/기대값에 불일치한 2건이다. 원본 단독 실행에서도 재현했고, ignored 진단 preload로 Glob 출력만 slash 정규화하면 4/4 통과했다. 해당 공유 CI 도구는 이번 profiling PR에서 수정하지 않는다. 별도 db:check(schema drift + fresh/upgrade 6 tests)는 통과했다. 원격 Linux CI 결과는 PR에 기록한다.

## 해석 제한

한 Windows 기기에서 합성 데이터, headless 브라우저와 CPU throttle로 얻은 작은 표본이다. mobile hardware, IME, 다른 브라우저, 실제 사건·사진·파일·API·AI 작업 및 공개 운영 성능은 추정하지 않는다. mock과 real HTTP fixture 결과를 서버 성능으로 합치지 않는다. 원시 상세는 ignored `test-results`에 보존하고, commit한 JSON에는 반복 수치/리소스 경로/원시 SHA256 digest와 후보 manifest가 있다. 모든 입력은 합성이고 토큰/실제 사건/stack/SQL을 기록하지 않았다.
