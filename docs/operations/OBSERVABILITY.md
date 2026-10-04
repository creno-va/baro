# 관측성

## 목표

사용자 사건 내용을 수집하지 않고도 요청, Workflow, 외부 의존성, 안전 검사의 건강성을
판단한다. request ID, case ID, analysis ID, workflow ID는 내부 상관관계에 쓰되 사용자에게
노출되는 오류에는 request ID만 포함한다.

## 구조화 로그

허용 필드:

```text
timestamp, environment, release, requestId, routeTemplate, method,
statusCode, latencyMs, userHash, caseId, analysisId, workflowId,
step, attempt, dependency, modelId, tokenInput, tokenOutput,
errorCode, policyFindingCode, citationCount
```

`userHash`는 환경별·주기적 salt의 비가역 값이다. raw path에 ID가 있으면 route template로
치환한다. 사건 원문·답변·결과·검색어·prompt·이메일·IP·cookie·token·외부 응답 body는
로그하지 않는다. 예상하지 못한 Error 객체도 sanitize한 allowlist만 serialize한다.

## 핵심 지표

- HTTP: request count, 4xx/5xx, p50/p95/p99 latency by route template
- 분석: started/completed/failed, completion latency, clarification ratio, retry count
- 외부 의존성: latency, timeout, 429, 5xx by provider/operation
- AI: token count, schema failure, policy failure, citation failure by version
- 법률 검색: cache hit, empty result, schema mismatch, stale/hash change
- 보안: Turnstile failure, rate-limit, auth failure, IDOR probe code
- 데이터: deletion completion/failure, migration status, Workflow orphan count

## SLO와 경보

공개 베타 첫 2주에 baseline을 수집하고 수치 SLO는 별도 운영 변경으로 확정한다. 그 전에도
다음 사건은 즉시 경보한다.

- 삭제 실패, 암호화 실패 급증, 권한 우회 의심
- 허구 사실·미검증 citation·금지 출력 운영 신고
- production 법률 fixture 사용 또는 payload logging 활성 감지
- Workflow가 종료 상태 없이 정책 시간 이상 고립
- OAuth callback 실패·모델/법률 API 5xx가 5분간 유의하게 증가
- 새 release 직후 전체 오류율이 직전 안정 release의 2배 이상

경보는 공개 원문 없이 environment, release, error code, request/workflow ID와 runbook 링크를
담는다.

## 대시보드

1. 사용자 흐름: case submitted -> clarification -> completed -> result viewed
2. 신뢰·안전: schema/policy/citation finding과 버전별 회귀
3. 의존성: OAuth, Turnstile, D1, Workflow, AI Gateway/Unified Billing, 법률 API
4. 개인정보 운영: 삭제, 로그 보존, 키 버전 분포
5. release: 배포 marker 전후 오류·latency 비교

## 보존과 접근

운영·보안 로그는 기본 30일 이내 자동 만료한다. 대시보드는 집계 데이터만 장기 추세로
남기고 희소 차원으로 개인을 재식별할 수 없게 한다. 로그 접근은 최소 운영자와 개별
계정/MFA로 제한하고 정기 검토한다.

## 구현 검증

- CI는 금지 field 이름과 민감 fixture가 logger 호출에 전달되는지 정적 검사한다.
- 통합 테스트는 오류·외부 실패에서도 body가 로그에 없는지 capture logger로 확인한다.
- 배포 smoke는 release marker와 합성 workflow가 대시보드에 연결되는지 확인한다.
- Cloudflare 설정 drift 점검으로 payload logging, tail consumer, 보존 기간을 확인한다.

## 참고

- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
