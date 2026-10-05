# P0.3 환경 readiness 기록

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
