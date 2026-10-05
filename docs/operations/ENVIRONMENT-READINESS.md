# P0.3 환경 readiness 기록

## 2026-10-06 추가 진행

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
  수행하지 않았다. 실제 호출은 별도 비용 한도 승인과 검증 뒤에만 실행한다.
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
- 실제 랜딩 수정은 [PR 1](https://github.com/creno-va/baro-landing/pull/1)로 병합했고
  [Pages 배포](https://github.com/creno-va/baro-landing/actions/runs/37354136276)가 성공했다.
  공개 문구 감사 증거는 [콘텐츠 감사](../product/PUBLIC-CONTENT-AUDIT.md)를 따른다.

## 수동 읽기 전용 관측

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

공식 문서는 Accepted `openai/gpt-6-sol`의 Chat Completions/Responses와 structured output, reasoning 지원을 설명한다. 모델이나 공급자를 변경하지 않았다. Workers binding의 Gateway ID는 같은 account에 존재해야 한다. 문서상 지원은 이 account의 Unified Billing 활성·credit·strict schema wire 응답·실제 critical-zero eval 성공을 증명하지 않는다. 등록된 preview 전용 설정과 기존 승인된 비용 한도 확인 후에만 합성 입력으로 #27의 live 검증을 시작한다.

재현: `bunx wrangler secret list --env preview`는 이름만 확인한다. Worker settings 조회도 binding 이름/type, origin 일치 여부, release, logging boolean만 출력한다. credential·token·cookie·인증 URL·원문 응답을 artifact로 보내지 않는다. 전체 제품 smoke/eval의 성공 run URL은 현재 없다. readiness가 확보되면 #27 완료 후 #19 통합을 시작한다.

공식 근거: [모델](https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/), [OpenAI 모델](https://developers.openai.com/api/docs/models/gpt-6-sol), [binding](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/), [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/), [Turnstile 검증](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
