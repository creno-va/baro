# P0.3 환경 readiness 기록

## v2 목표와 현재 증거 경계 (#53)

아래 P0.3 관측은 날짜/환경별 역사적 증거다. #53의 설계 승인으로 실제 OAuth·법률·AI·키 복구
성공이나 정책 승인으로 바뀌지 않는다. v2 목표는 [파일 처리](./FILE-PROCESSING.md),
[월 비용](./COST-CONTROLS.md), [배포](./DEPLOYMENT-OPERATIONS.md)를 따르며 아래 자원은
아직 제품에 구성/검증됐다고 표시하지 않는다.

| v2 항목 | 현재 상태 | 완료에 필요한 행동/증거 |
| --- | --- | --- |
| Private/public R2 | 제품 binding/버킷/원격 삭제 미검증 | #58 환경별 분리·private공개OFF·승인 revision copy·owner download·quota·실제 upload/delete |
| Containers/DO | 제품 파일 처리 미구현, 실제 Workers Free plan에서 Paid upgrade 안내 관측 | #59 실제 plan/funding/allocation 확인 뒤 provisioning·image digest/resource/idle/network/job capability·문서/media 처리·취소·temporary disk 정리 |
| Whisper/vision | 문서상 지원과 계정 호출 미분리 | #59/#71 실제 계정/모델 경로·합성 audio/video full구간 및 sampled frame coverage/gaps |
| 지속 workspace/roles | v2 미구현 | #60~#67 actual DB/UI·relogin/resume·moderation revision·private/public 분리·PDF/ZIP·삭제 |
| 전역 비용/제품 quota | v1 제한과 다름; #57 독립 문서 계약 준비, runtime 미검증 | #55/#57 원자적 day3/30/60min·10GB계정·100files/5GB사건·환경 allocation/가격/환율/funding·100만 원 ledger/실제 meter reconciliation |
| 공식 출처 확장 | 승인 OC local HTTP200upstream-error 유지 | #63/#71 승인 credential/요청 조건 해결·Worker 실제 법령/판례/기관 guide type별검증 |
| 운영/공개 | foundation 배포 권한 있음, 정책 승인 없음 | #70 human/business/provider근거, #71 sameSHA UI/live/drill·Environment승인·공개gate |

## 2026-10-06 읽기 전용 plan·비용 관측

인증된 Cloudflare 콘솔에서 Workers는 `Free / Current plan`, Paid 옵션은 `$5 / month + usage`였다.
Containers 화면은 `Enable Containers`와 Workers Paid upgrade 필요 안내를 표시했다.
subscription 변경·Containers 활성화/생성은 하지 않았다. 당시 기록은
[#27 관측](https://github.com/creno-va/baro/issues/27#issuecomment-6002618673),
[#59 관측](https://github.com/creno-va/baro/issues/59#issuecomment-6002619099)이며 로컬 원본은
ignored `.wrangler/goal/workers-plan-readiness.md`다. 실제 계정 plan 관측과 공식 가격표는
다른 증거다. 문서상의 Containers/Paid 가격·허용된 예산은 실제 활성화/호출 성공을 뜻하지 않는다.

[사용량·비용 실행 정본](../architecture/DOMAIN-LIFECYCLE.md#v2-사용량과-비용)과
[quote/환경 할당 전환](./COST-CONTROLS.md)은 #57의 독립 구현 목표다. 아직 검증된 USD/KRW
환율·최종 청구/세금·신선한 funding·환경별 immutable allocation 배포/감소 ack·실제 meter 대조
증거가 없다. 이 값들을 임의/0원으로 채워 paid admission을 열지 않는다. #55 선행 schema/저장
계약과 #57 runtime·동시성·복구 검증 뒤 실제 단계별 증거를 연결한다.

Workers Free의 CPU/D1 쿼리·row 한도는 큰 입력을 한 번에 처리할 수 있다는 증거가 아니다.
대형 자료는 bounded staging·고정 revision manifest·원자적 publication·멱등 cleanup으로
검증하며, 실제 retry/추출/보관 비용은 유지한다. R2 원격 삭제/복구·Whisper full coverage·
Containers deadline/종료는 #58/#59/#71의 실제 환경 증거가 필요하다. 이 plan 관측은
공개 법률/정책 승인이나 production 공개 전환을 승인하지 않는다.

## 이전 probe의 미확정 예약 관측

2026-10-06 후속 읽기 전용 콘솔 관측: 임시 AI probe main Worker invocations27/errors0,
logs/traces 비활성; probe DO HTTP3 중 success2/error1이며 `Worker threw exception` 1이었다.
CPU/memory/client-disconnect/internal error counter는0, 당시 activeversion
`8b9e5ad6`은0requests/sec였다. 완료 report는 없고 durable 예약1이 남는다. 이는 이전 POST가
terminal 예외였음을 확인하지만 모델 실제 실행/청구/strict 응답·품질 성공을 증명하지 않는다.
새 요청을 자동으로 재시작하거나0비용으로 처리하지 않고 reservation/billing과 같은 handle을
대조한다. logs를 켜거나 실제 payload를 수집한 증거가 아니며 제품 full-readiness와 분리한다.

후속 관측에서는 authenticated probe가 HTTP200 완료 report를 반환했으나 candidate SHA와
`probeSourceSha256`가 기대값과 달라 같은 코드의 성공 증거로 거부했다. Gateway overview에는
request1/token347/error0과 반올림된 Cost$0.00이 관측됐다. 이는 계정 트래픽이 있었음을
증명하지만 정확히 무료였다거나 모델 품질/현재 release 검증이 통과했다는 뜻은 아니다.
기존 `345c085` 예약1의 결과를 이 다른 candidate report로 성공 처리하지 않는다. 실제 billing,
배포 version/vars/source digest를 대조한 뒤 동일 candidate의 새 증거를 확보해야 한다.

## 2026-10-06 후속 검증: 동일 코드의 격리 AI 호출

이전 candidate의 예약·누락·잘못된 provenance 보고서는 보존하며 아래 결과로 성공 처리하지 않는다.
수정한 protocol2 도구는 clean HEAD와 source manifest SHA256, 활성 DO의 candidate/hash를
GET으로 확인한 뒤에만 POST한다. DO는 요청 provenance를 acquire/과금 예약 전에 확인한다.
Wrangler immediate code update를 사용하고 불명확한 POST는 자동 재시도하지 않는다.
실제 예약과 관측 지표의 누락은 `metricCoverage`로 구분한다.

- 실제 검증 시각: `2026-10-05T19:59:27.054Z` (2026-10-06 KST).
- clean candidate: `e9dee3b201ec7b08c8a7b2a46cb16c1f46b60e56`.
- probe source manifest digest: `1defc000ba080376da14e13ee642952d6672079b052286c24d0b66885eb9ca58`.
- 환경: application DB/OAuth가 없는 `isolated-synthetic-worker`, 고정 합성 대여 진술만 사용.
- 실제 `openai/gpt-6-sol` screening strict 결과와 기대값 통과, durable 예약1/관측1,
  latency4923ms/input287tokens/output56tokens, `metricCoverage:complete`.
- unauthenticated POST403, authenticated active SHA/hash 일치, 완료 후 replay409
  `already-attempted` 및 GET의 동일 report/call count를 확인했다.
- 실행 전 콘솔의 기존 credit `$10.00`와 auto recharge OFF를 다시 확인했다.
  반올림된 금액은 정확한 실제 청구액이나 무료 증거가 아니며 비용 정산은 남는다.
- metadata report/source manifest는 ignored `.wrangler/goal/ai-e9dee3b-verified.json`에
  보존했다. secret·원문 응답·사건·stack은 report에 없다.

이는 한 합성 screening의 실제 Worker binding/strict schema/provenance/replay 성공이다.
full-product smoke, 전체 live corpus eval, OAuth, 법률 API, 공개 정책 승인은 미검증이다.
이 isolated SHA는 preview/production 제품 릴리스 SHA가 아니며 release gate의 성공 receipt로 쓰지 않는다.

## 2026-10-06 추가 진행 (이전 관측 포함)

- Goal 세션이 이전 작업을 인계받았다. 이전 checkout은 clean `345c085`이며 실행 중인
  프로세스나 미병합 변경은 없었다. [main CI](https://github.com/creno-va/baro/actions/runs/37357253307)와
  [preview 배포](https://github.com/creno-va/baro/actions/runs/37357603021)는 같은
  `345c08565fdc0bb5157f9aaf9bdc69912702ace5`에서 성공했다. foundation 성공이며 외부 전체 흐름 성공은 아니다.
- 사용자 목표는 월 기술 예산 100만 원 내 합의한 리소스 생성과 실제 처리 비용을 승인한다.
  새 결제수단·자동 충전·예산 확대는 승인 범위 밖이다. 기존 `$1` smoke 승인 대기는 이 승인으로
  대체되지만 계정의 실제 credit/spend limit과 호출 결과는 별도 검증한다.
- 현재 승인 정보 OC의 로컬 합성 adapter 재검증은 request 1개에서 HTTP 200
  `upstream-error`로 실패했다. 안전한 진단 enum만 기록했으며 원문·인증 URL·OC는 기록하지 않았다.
  이는 upstream 오류의 존재를 확인하며 등록/IP/자격 중 어느 원인인지 확정하지 않는다.
  담당자는 공동활용 신청의 승인 상태·요청 조건을 확인한 뒤 같은 parser/date/hash 검증을 다시 수행해야 한다.
- 실제 AI binding 검증은 별도 합성 전용 Worker와 durable 최대 3회 호출 예약으로 준비했다.
  secret 배포 직후 authenticated GET은 HTTP 403이었으며 bounded GET polling으로 인증 전파를 확인했다.
  이후 POST는 transport 실패했고 현재 durable GET은 started=true·예약 1회·완료 report 없음이다.
  이미 예약된 호출의 결과와 실제 비용은 미확인이다. 자동 재호출하지 않으며 strict 응답·모델 품질
  성공으로 취급하지 않는다. GET 상태 확인은 비용을 사용하지 않는다. 이 임시 도구 실행은 product release 증거가 아니다.
- 사용자 승인에 따라 preview 전용 `BETTER_AUTH_SECRET`, `CASE_DATA_KEY_V1`(키 ID `1`),
  승인된 `LAW_API_OC`, 새 `TURNSTILE_SECRET_KEY`를 GitHub `preview` 환경과 Cloudflare
  `baro-preview` secret에 등록했다. 값은 출력하거나 artifact/Git에 저장하지 않았다.
  로컬 전달/복구 파일은 ignored 경로에 있고 현재 사용자와 SYSTEM만 읽도록 제한했다.
  GitHub encrypted secret은 승인된 복구 보관 위치이나 별도 복구 담당자와 실제 drill은 미확정이다.
- `BARO preview` Turnstile widget: `preview.baro.site`만 허용, Managed, pre-clearance 없음.
  공개 site key는 GitHub preview 변수 `PUBLIC_TURNSTILE_SITE_KEY`에 등록했다.
  preview 빌드가 해당 변수를 읽도록 연결한다. 실제 성공·만료·재사용/action 검증은 아직 남았다.
- `baro-preview` AI Gateway를 생성했다. 인증 필수, payload logging/cache/retry 비활성화,
  Unified Billing을 선택했다. preview Worker 설정에 Gateway ID를 연결한다.
  콘솔에서 기존 credit `$10.00`, auto recharge OFF, 사용량 0을 확인했다. 새 구매나 자동 충전은
  수행하지 않았다. 현재 Goal의 월 기술 예산 승인 아래 실제 합성 검증을 준비한다.
- 로컬 Wrangler OAuth로 Gateway 목록 조회는 HTTP 403이었다. 자원 부재로 해석하지 않는다.
  아래 수동 workflow는 기존 preview API token의 조회 가능 여부를 별도 기록한다.
- 실제 공식 법령 adapter smoke: `/DRF/lawSearch.do` HTTP 200 JSON이었으나 `LawSearch`
  대신 `result`/`msg` 오류 envelope를 반환해 실패했다. 원문·OC·요청 URL은 기록하지 않았다.
  요청/승인 진단과 Worker에서의 실제 성공 증거가 필요하다. HTTP 200을 법령 검증 통과로 취급하지 않는다.
- Google Cloud 콘솔은 로그인 화면에 도달했다. preview OAuth 앱 생성·callback·테스터 승인과
  성공/취소 검증은 아직 미완료이며 production 값을 복제하지 않았다.
- production foundation: [배포 run](https://github.com/creno-va/baro/actions/runs/37349619316),
  release `1f755a1bfeef8e2ff67a61677e067aff33b0124d`, health/ready/schema `0005` 통과.
  정상 GitHub Environment 승인 절차를 사용했다. 공개 베타 API는 `BETA_NOT_OPEN`으로 닫혀 있다.
- 후속 foundation `b41c00ce8d9955c5922b1e65d95d0c59cdc7b90b`의
  [main CI](https://github.com/creno-va/baro/actions/runs/37362678080),
  [preview](https://github.com/creno-va/baro/actions/runs/37363116441),
  [production](https://github.com/creno-va/baro/actions/runs/37365800076)가 성공했다.
  두 실제 도메인의 live/ready를 같은 SHA로 재확인했으며 production 사건 API는
  HTTP503/`BETA_NOT_OPEN`이다. 지정 reviewer의 정상 Environment 승인을 사용했다.
- 실제 랜딩 수정은 [PR 1](https://github.com/creno-va/baro-landing/pull/1)로 병합했고
  [Pages 배포](https://github.com/creno-va/baro-landing/actions/runs/37354136276)가 성공했다.
  공개 문구 감사 증거는 [콘텐츠 감사](../product/PUBLIC-CONTENT-AUDIT.md)를 따른다.

## 수동 읽기 전용 관측

### 2026-10-06 현재 브라우저 도구 접근 경계

이번 읽기 전용 재점검에서 `cua.getState()`는 apps/browsers 모두 빈 목록을 반환했고 IAB
선택도 `Browser is not available: iab`이었다. 따라서 기존 콘솔의 로그인·권한·preview client/
tester 상태와 현재 결제/plan을 브라우저로 재확인하지 못했다. 이는 사용자 로그아웃이나
계정 권한 부족의 증거가 아니며, 위 CLI/이전 provisioning 증거를 취소하지 않는다.
설정·credential·결제·클라우드 변경과 실제 OAuth·모델 호출은 수행하지 않았다.

다음 콘솔 확인에는 연결된 Chrome/Edge/IAB와 기존 로그인 탭 접근이 필요하다. 확인할 항목은
[Cloudflare](https://dash.cloudflare.com/)의 preview/현재 plan·funding,
[Google Cloud](https://console.cloud.google.com/)의 preview Web client·Audience test users,
[NAVER Developers](https://developers.naver.com/)의 preview 앱·등록 tester/admin·검수 상태,
[Kakao Developers](https://developers.kakao.com/)의 preview 앱·테스트 앱 멤버·동의항목이다.
callback은 `https://preview.baro.site/api/auth/callback/{google|naver|kakao}`와 정확히 일치해야 한다.
production credential을 복제하지 않으며 실제 callback 성공/취소는 별도 검증한다.

Google redirect 일치/test users, NAVER 검수 전 tester/admin, Kakao 테스트 앱 멤버 제약은
[Google 공식 문서](https://developers.google.com/identity/protocols/oauth2/web-server),
[NAVER 공식 문서](https://developers.naver.com/docs/login/verify/verify.md),
[Kakao 공식 문서](https://developers.kakao.com/docs/ko/app-setting/app)를 따른다. 문서 확인은
현재 계정의 실제 client/tester 승인 증거가 아니다. 독립 코드·preview foundation 작업은 계속한다.

`gh workflow run environment-readiness.yml --repo creno-va/baro --ref main`은 기존 GitHub
preview API token으로 Worker settings, 지정 Gateway, Turnstile 목록을 **GET**으로만 조회한다.
main에서만 실행되고 `deployment: false`로 실제 preview 배포 증거를 만들지 않는다.
관측 artifact에는 candidate/deployed SHA, 허용된 secret 이름의 존재 여부, origin/Gateway 일치,
로그/cache/auth boolean, preview hostname widget 건수 및 조회 실패 status만 포함한다.
site key/secret, 원문 응답, 오류 body/stack은 제외한다. 잘못된 응답이나 권한 부족은
`parsed: false`/`forbidden`/`unavailable`이며 존재 여부는 `null`(미확인)이다. 목록 건수는
관측된 첫 페이지에 한정하고 100개 이상이면 truncation 가능성을 표시한다. live gate 통과가 아니다. artifact의 `unverified`
항목은 이 workflow의 성공 여부와 무관하게 남는다.

같은 run의 법령 단계는 승인된 preview OC와 합성 `loan`/`interest`/`repayment` 개념으로
실제 `legal-retrieval` parser/date/hash 검증을 최대 4개 request 예약 안에서 수행한다.
cache는 메모리 대역이며 D1에 쓰지 않는다. 성공/실패와 시행일/hash만 별도 artifact로 남긴다.
이 단계는 CI runner의 adapter 증거이며 Worker 전체 smoke를 대신하지 않는다. 법령 검증이
실패하면 workflow도 실패하고 관측 artifact는 보존한다.

조회 범위는 [Gateway 목록 API](https://developers.cloudflare.com/api/resources/ai_gateway/methods/list/),
[Turnstile 목록 API](https://developers.cloudflare.com/api/resources/turnstile/subresources/widgets/methods/list/),
배포 기록 분리는 [GitHub deployment 제어](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)를 따른다.

## 이전 관측 (아래 표는 provisioning 전 상태)

- 점검: 2026-10-06 KST (2026-10-05T17:19:57.603Z), 읽기 전용 Cloudflare Worker settings/secret 이름 조회
- 대상: 기존 `baro-preview`. production secret 값은 읽거나 preview/local에 복제하지 않았다.
- 점검 release: `a95ae916f5309d8318776d2553ed783207060e5a`
- [Preview 배포](https://github.com/creno-va/baro/actions/runs/37347125241), foundation health/ready smoke 통과, schema `0005_deletion_cleanup`.
- 배포 뒤 홈/로그인/settings HTTP 200, hash CSP/unsafe-inline·eval 없음/frame-ancestors none/nosniff 확인.
- `GET /`, `/login`, `/settings`는 200. 인증 구성이 없는 `/api/cases`는 500으로 full-product 통과가 아니다. #18에서 CSP 누락을 수정했다.

| 항목 | 실제 확인 | 완료에 필요한 필드·행동 |
| --- | --- | --- |
| Preview OAuth | secret 0개. `BETTER_AUTH_URL`은 preview origin과 일치 | 별도 `BETTER_AUTH_SECRET`, Google/Naver/Kakao client ID·secret을 preview 전용으로 등록. 각 callback `/api/auth/callback/{google,naver,kakao}`와 허용 origin을 공급자 콘솔에 등록하고 tester·앱 승인 담당자가 성공/취소 callback을 검증 |
| Production OAuth | auth secret 이름 7개 등록. 실제 callback 미검증 | production 설정을 preview/local에 복제하지 않고 환경별 앱·테스터 명단 및 승인 책임자 기록 |
| AI | AI binding 존재, `AI_GATEWAY_ID` 없음 | 동일 account Gateway ID, 기존 승인된 credit/spend limit·자동 충전 상태·예산 책임자 확인. 구매·한도 확대·자동 충전 변경은 하지 않음 |
| 법령 | 승인 정보 인계는 존재하나 preview credential secret 없음 | 승인된 `LAW_API_OC`를 secret으로 등록하고 URL/body를 기록하지 않는 live schema/date/hash smoke. 환경·기존 비용 승인 후 실행 |
| Turnstile | preview site key/secret 미등록 | preview hostname과 `case_create` action, site key·`TURNSTILE_SECRET_KEY` 및 소유자 확인. 성공·만료·재사용·hostname/action mismatch 검증 |
| 암호화 | preview `CASE_DATA_KEY_V1` 없음 | preview 전용 키를 secret으로 provisioning하고 키 관리자·복구 관리자·접근 통제·복구 증거 기록. 현재 제품 wrapper는 active key `1`/V1만 연결됨. 일반 cipher의 다중 read-key 테스트를 환경 rotation 완료로 취급하지 않음. V2 전환·재암호화·구키 보관 통합과 live 검증 필요 |
| Worker logging | 17:19:57Z 기준 observability enabled, sampling 1, invocationLogs false, tail consumers 0 | application allowlist 외 플랫폼 예외/body 수집·보존·접근 권한을 콘솔 및 계약과 대조. invocationLogs false만으로 모든 payload 보존이 없다고 판단하지 않음 |
| Gateway/provider | 호출 옵션은 `collectLog:false`, `skipCache:true`, `store:false`; 계정 설정 미확인 | Gateway logging/cache 및 공급자 ZDR/처리 국가·보존 계약은 별도 확인. Gateway 로그 옵션은 공급자 ZDR 승인 증거가 아님 |
| 백업 | 실제 plan·retention·격리 restore 자원 미확정 | plan 담당자 확인 및 합성 전용 D1/Worker/Workflow 자원 지정. journal 35일 목표와 실제 backup 기간·법률 보존을 대조 |
| 경보 | 지정 테스트 수신처·발송 권한 없음 | 수신처, 담당자, 발송 권한과 ack 기준 지정. 그 전에는 strict test payload 검증만 수행 |
| 정책/랜딩 | Draft blocker, 실제 랜딩의 범위 밖 주장 6종 유지 | 사업자 사실·법률 검토·게시 승인·동의 버전 확정 및 별도 랜딩 소유자 수정·배포 |

## Accepted 모델과 실제 계정 검증의 경계

공식 문서는 Accepted `openai/gpt-6-sol`의 Chat Completions/Responses와 structured output, reasoning 지원을 설명한다. 모델이나 공급자를 변경하지 않았다. Workers binding의 Gateway ID는 같은 account에 존재해야 한다. 문서상 지원은 이 account의 Unified Billing 활성·credit·strict schema wire 응답·실제 critical-zero eval 성공을 증명하지 않는다. 현재 예산 승인을 사용하되 호출별 제한과 안전한 합성 입력으로 #27의 live 검증을 수행한다.

재현: `bunx wrangler secret list --env preview`는 이름만 확인한다. Worker settings 조회도 binding 이름/type, origin 일치 여부, release, logging boolean만 출력한다. credential·token·cookie·인증 URL·원문 응답을 artifact로 보내지 않는다. 전체 제품 smoke/eval의 성공 run URL은 현재 없다. readiness가 확보되면 #27 완료 후 #19 통합을 시작한다.

공식 근거: [모델](https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/), [OpenAI 모델](https://developers.openai.com/api/docs/models/gpt-6-sol), [binding](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/), [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/), [Turnstile 검증](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
