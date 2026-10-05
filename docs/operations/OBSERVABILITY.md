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

## v2 구현 목표와 증거 경계

이 문서의 지표·alert가 구현되었다는 주장이 아니다. v1 제품 logger는 cleanup 실패를 위한
제한 로그만 허용하며 #19가 #27 이후 runtime 통합을 한다. #53은 새 파일/역할/비용 관측
계약을 정의하고 #71이 실제 환경·수신·복구를 증명한다. 기존 strict test alert와 fabricated
receipt 테스트를 실제 전달 성공으로 표현하지 않는다.

v2 추가 허용 field는 opaque `jobId`, `fileId`, `revision`, `imageDigest`, `phase`, `coverageCount`,
`reservedCostKrw`, `actualCostKrw`, `quotaOutcome`, `cleanupState`, `moderationOutcome`이다.
정해진 schema/enum·숫자·bounded 식별자만 저장하고 부정확한 free-form error body를 넣지 않는다.
원래 파일명·file hash·OCR/transcript/frame·포트폴리오/신분 자료 내용·export URL·signed
capability·회사명·주소·연락처·특정 사건의 검색어도 금지한다. file hash를 익명 metric으로 취급하지 않는다.

| 관측 대상 | aggregate 지표 | 사용자 내용 없는 실패 조건 |
| --- | --- | --- |
| Upload/R2 | 원본/예약 byte, 성공/중단, part·cleanup backlog | owner 거부·무결성/형식 오류·multipart 미정리 |
| Processing | queue/lease/실행 시간, duration/frame coverage 건수, 종료 상태 | timeout/OOM/고립 lease·late commit·취소 실패 |
| AI/ASR/source | operation별 요청/토큰/duration·latency·검증 코드 | strict schema·citation·허구 사실·금지 행동·실제 지원 미확인 |
| Profiles | 심사 대기/승인/반려 건수·대기 시간 | pending revision 노출·role 우회·공개 pointer/cache 불일치 |
| Reports | 생성/download 완료·건수·quota·version | stale report·한글/font·ZIP 누락·owner 거부 |
| Deletion | private/public/job/cache 단계 완료/재시도/미완료 age | 원격 삭제 실패·복구 재등장·사용자 세션 잔존 |
| Budget | actual/reserved/unknown/projected/funding | 한도 접근·예약 누수·중복 실제 과금·metering 차이 |

알람 정책은 [비용 통제](./COST-CONTROLS.md)와 [drill](./BETA-DRILLS.md)을 따른다. P0는
내용 누출/권한 우회·삭제 부활·원격 삭제 영구 실패·budget 초과 가능성이다. runtime event/code
조합·UUID·environment·release를 schema로 검사하고 receiver별 dedup key·bounded retry와 ack
기준을 정한다. 알림에 사용자 email/IP·원문·signed URL을 붙이지 않는다. 테스트 수신처 지정과
외부 발송 권한 없는 상태에서 email/Slack으로 자동 전송하지 않는다.

운영 화면은 aggregate health와 opaque job 상태만 보여준다. 프로필 심사 권한은 credential/
프로필 자료에만 한정하고 사건 내용 열람 UI·DB decrypt endpoint를 만들지 않는다. 운영자
본인의 test 사건과 일반 사용자 사건 접근 권한을 혼동하지 않는다.

배포마다 application allowlist 테스트와 Worker/Container stdout/stderr·platform exceptions·tail/
Gateway cache/log·provider retention drift를 확인한다. Container observability 활성화가 process
로그를 수집할 수 있으므로 parser 원문/stdout dump를 금지한다. 30일 목표는 실제 platform
설정·plan·계약 확인 전 확정 보존 기간이 아니다. 실제 수신/ack/run URL·retention/접근 권한을
#71에 기록하며 confidential raw platform 응답은 artifact에 업로드하지 않는다.
