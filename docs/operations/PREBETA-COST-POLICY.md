# 프리베타 비용 관측 전용 정책

- 결정: 2026-10-14 사용자 직접 지시. [ADR-0015](../adr/0015-maintenance-and-operating-policy.md)의 후속 범위.
- 적용: `APPLICATION_COST_LIMITS_ENABLED=false`인 preview/production과 해당 배포·운영 도구.
- 구현 상태: [PR247](https://github.com/creno-va/baro/pull/247)에서 기존 운영 환경의 비용 관측과
  실행 분리를 병합했다. 배포와 실제 기능 결과는 #71의 동일 SHA receipt를 따르며 전체 MVP 완료와 구분한다.
- 이번 변경 범위는 실제 가격/funding proof·물리 capacity가 이미 있는 운영 환경의 만료·월·비용 IO 병목 분리다.
  **가격 proof 자체가 없는 신규 환경 bootstrap에는 비용 증거 결합이 아직 남는다.** 가짜 가격을 만들지 않고
  nullable 관측 원장으로 분리하는 후속 구현이 필요하다. 이 잔여는 정책의 예외 승인이나 새 비용 gate의 근거가 아니다.
  preflight `configuration_ready`는 구성 검사 결과이며 실제 기능 성공 보장이 아니다.

## 실행을 막지 않는 비용 정보

프리베타에서는 비용을 기록하고 관측하지만 비용 정보가 제품 기능이나 배포의 승인권자가 되지 않는다.
다음 항목 때문에 admission, dispatch, 재시도, 업로드, 처리, 리포트/PDF/ZIP, 기존 파일 읽기,
삭제·정리, preflight 또는 배포를 거절·대기·동결하지 않는다.

- 월 예산, 누적 재원, 요청 금액, 과거 추정액 초과, 미정산 hold 또는 유지비 예약 합계.
- 가격·환율·billing/funding 관측의 누락·만료·stale 상태 및 과거 관측의 unavailable 표시.
- 월별 allocation/control/projection의 비용 승인, KST 월 전환, 수동 observe/refresh/drain 완료 대기.
- 비용 견적을 위한 모델 bounds의 관측 만료. 모델 context/output/지원 형식의 실제 기술 제한은 별개다.
- 비용 예약으로 정한 GET/HEAD/DELETE 횟수. 과거 각50회 IO 예약을 다운로드·삭제 quota로 사용하지 않는다.
- 무료 tier·포함량·metered 여부를 비용 산정용으로 확인하지 못한 경우, 비용 기록·정산 단계의 실패.

`MONTHLY_BUDGET_CAP_ENABLED=false`만으로 이 정책을 충족하지 않는다. 비용 금액 비교를 끈 뒤
가격 증거·만료·refresh·비용 IO 수량으로 같은 병목을 다시 만드는 것도 허용하지 않는다.
**사용자가 다시 명시적으로 요청하기 전까지 비용 차단을 재도입하지 않는다.** 과거 이슈·ADR·
테스트·운영 runbook의 fail-closed 지시는 비용 영역에 한해 이 결정으로 대체한다.

0015는 DB의 `v2_cost_execution_policy`와 독립 `v2_storage_io_counters`를 추가한다. 향후 사용자가
비용 차단을 새로 명시 승인하더라도 런타임 flag만 true로 바꾸면 안 된다. 환경별 DB policy의
`limits_enabled`와 런타임 설정을 명시적으로 동기화해야 하며 현재는 재활성화하지 않는다.

## 보존하는 경계

다음은 비용 제한이 아니며 계속 검사한다.

- 로그인·세션·서명·소유권·역할·동의·origin/CSRF·암호화·출처 및 원문 무결성.
- 삭제 tombstone·revision·CAS·lease·멱등성·writer 수명과 실제 객체/작업의 물리 상태.
- AI200회/일 등 사용자 사용량, 파일 수/크기·계정/사건 저장 용량, 실제 처리 메모리·시간·
  query 수·모델 context/output·지원 capability·재시도 횟수와 남용 방지.
- 필수 runtime binding/credential의 실제 부재, 실제 공급자 API가 반환한 오류·거절·timeout.
- 배포의 소스 SHA·schema·보안·환경·운영자 승인과 공개/정책 인수 조건.

물리 저장 용량 검사는 실제 byte/inventory를 기준으로 한다. 월별 비용 projection의 유무나 만료를
물리 용량 부족으로 표시하지 않는다. 과거 billing 관측의 unavailable은 실제 공급자 요청 실패의
증거가 아니며, 비용 metadata를 인증·보안 credential과 같은 이유로 거절하지 않는다.

## 관측·정산과 이력

실제 가격·환율·관측 시각·사용량·추정액·미정산·정산·hold·공급자 receipt는 보존한다.
정보가 없거나 만료됐으면 그대로 unknown/stale로 기록하며 성공·0원·최신 관측으로 꾸미지 않는다.
관측 시각이나 validUntil을 미래로 늘리거나 spendAllowanceKrw를 큰 값으로 조작하지 않는다.
기존 원장과 삭제 journal을 지우지 않으며, 사후 정산은 실제 근거와 당시 가격을 연결한다.
비용 기록 실패는 별도 운영 경보·후속 대조 대상으로 남기고 정상 제품 작업의 실패로 전파하지 않는다.

observe/refresh/과거 allocation 운영 도구는 관측 자료를 관리할 수 있지만 제품 실행의 선행 조건이
아니다. 실제 물리 자원 초기화와 비용 기록 갱신은 구분한다. 기존 공급자·모델·결제수단과
사용자 설정 자동충전($10/$30)은 유지하며 이 정책으로 새 결제 설정을 만들지 않는다.

## 현재 실제 증거와 이번 변경의 경계

PR247/248 통합 소스는 `1059887ae8ad1998b6e5432c6ba2da4d5ed4679e`다.
[main CI](https://github.com/creno-va/baro/actions/runs/38569017779)와
[preview](https://github.com/creno-va/baro/actions/runs/38569246700)는 성공했다.
[production 실행](https://github.com/creno-va/baro/actions/runs/38569688687)의 최종 결과와
실제 채팅/리포트 결과는 [#71](https://github.com/creno-va/baro/issues/71)에서 확인한다.
[실행 승인 기록](https://github.com/creno-va/baro/issues/71#issuecomment-6169091362)은 이미 받은
직접 사용자 지시를 해당 SHA에 적용한 기록이며 새로운 인간 승인이나 독립 외부 인수가 아니다.

`04f25f804f02e0f221f4b34be0f03edc3d0afd00`에서 [CI](https://github.com/creno-va/baro/actions/runs/38563034585),
[preview](https://github.com/creno-va/baro/actions/runs/38563613354),
[production](https://github.com/creno-va/baro/actions/runs/38563979183) 배포가 성공했다.
2026-10-14 21:30:58 KST의 [production 저장 초기화](https://github.com/creno-va/baro/actions/runs/38564333321)와
21:31:57 KST의 [같은 할당 refresh](https://github.com/creno-va/baro/actions/runs/38564475420)는 당시 실행 기록이다.
현재 정책이 향후 수동 refresh를 기능 사용 조건으로 요구한다는 뜻이 아니다.

21:32:46 KST에 새 일반 채팅을 요청해 21:33 KST에 실제 assistant 본문을 확인했다.
21:34:37 KST에 리포트 v3를 생성했고 PDF 3페이지·3,144,078 bytes의 실제 다운로드와 한글 렌더,
HTML 14,572 bytes의 실제 파일 수신을 확인했다. 업로드와 선택 원본 ZIP은 이 증거에 포함하지 않는다.
법률 질의의 `POLICY_REJECTED`는 별도 정책 결과다.
[종합 receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6168531808)를 따른다.
이 성공은 이번 비용 관측 분리 변경이나 전체 MVP 인수의 완료 증거가 아니다.
후속 법률 채팅은 60초 timeout 뒤 약69초에 실제 모델 응답/정산이 도착한 것으로 확인됐다.
[PR248](https://github.com/creno-va/baro/pull/248)은 작업 공간 모델 대기를120초로 늘리고
`provider_timeout` 진단을 분리한다. 이전 `POLICY_REJECTED`나 다른 공급자 오류까지 같은 원인으로 단정하지 않는다.

## 외부 설정 관측 범위

2026-10-14 22시경 KST 인증된 Cloudflare 화면에서 Workers Paid($5 + usage)가 Current Plan이며,
baro-production과 baro-preview Gateway 모두 Spend Limits OFF·Rate Limit Requests OFF임을
확인했다. production에는 Dynamic Routes가 없었다. Unified Billing credit는$39.21,
기존 자동충전은 ON·threshold$10/add$30이며 설정을 변경하지 않았다. 이전$39.54 관측은
이전 시점 기록으로 남기고 최신 잔액과 섞지 않는다. 이 화면 관측은 미래 공급자 가용성이나
모든 개별 호출의 청구 완료를 보장하지 않는다.

GitHub 저장소는 PUBLIC이며 확인한 모든 workflow는 표준 `ubuntu-latest` runner다.
공개 저장소의 표준 GitHub-hosted runner 사용은 [GitHub Actions 공식 과금 안내](https://docs.github.com/en/billing/concepts/product-billing/github-actions)의
무료 범위에 해당한다. 관측된 CI/배포는 정상 완료됐다. CLI 조직 budget 조회는404였고
`admin:org` scope가 없었다. 인증된 웹 계정은 해당 조직의 outside collaborator(저장소2개)로
표시됐으며 조직 budget 화면도404였다. 따라서 **조직 budget 전체가 없다고 확인한 것은 아니다.**
접근 가능한 실행 상태와 조직 전체 설정의 미확인 범위를 구분한다. 이404는 현재 배포 blocker가
아니며 추가 로그인을 요구하지 않는다. 개인 이메일·invoice는 기록하지 않는다.
