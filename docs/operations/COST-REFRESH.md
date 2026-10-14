# 비용 관측 기록 갱신

- 기준: [프리베타 비용 관측 전용 정책](./PREBETA-COST-POLICY.md), [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), #57/#58.
- 관측 관리와 실제 물리 저장 연결을 구분한다. 비용 갱신은 제품 실행·배포의 선행 조건이 아니다.
- 아래 현재 계약의 구현은 `codex/57-prebeta-cost-observation-only`에서 진행 중이다. 배포 적용은 별도 receipt로 확인한다.

## 관측 입력의 의미

`APPLICATION_COST_LIMITS_ENABLED=false`에서 가격/FX/funding 누락·만료·금액·월할당·
유지비·수동 refresh 대기로 기능을 막지 않는다. 관측값을 사실대로 보존하고 stale/unknown을
현재 유효한 근거로 바꾸지 않는다. 사용자 재지시 전 비용 승인 경로를 재도입하지 않는다.

운영 도구만 비용 관측 JSON을 받는다. 사용자 API에는 가격·재원 증거나 재개 권한을 받지 않는다.
`scripts/provision-ai-budget.ts <sha> <status|observe|refresh|reallocate> <preview|production|both>`와
수동 Cost operations workflow는 관측/과거 원장 관리용이다. 입력은 환경변수로 전달하며
shell 코드나 공개 artifact에 삽입하지 않는다.

- `checkedAt`, `validUntil`: 실제 관측의 시각·유효기간. 만료 원본은 stale로 보고하며 날짜를
  바꿔 유효 관측으로 저장하지 않는다. 관측 형식/출처 오류를 거절해도 제품 실행을 중단하지 않는다.
- `creditUsd`, `fx`, `pricing`: 실제 잔액·환율·출처·SKU/단위·단가·확인일을 보존한다.
  누락값을0이나 임의 고정환율로 채우지 않는다.
- `spendAllowanceKrw`, `fundingState`: 당시 누적 재원과 funded/trial_credit/unavailable 관측이다.
  현재 앱의 지출 허가액이나 공급자 실제 요청 성공 여부가 아니다. 이전 funded proof로
  최신 unavailable을 덮지 않으며 그 관측만으로 실행을 거절하지 않는다.
- 기존 결제 경로·사용자 설정 자동충전ON/$10/$30은 유지한다. 이 도구로 결제 설정을 바꾸지 않는다.

기존 AI-RUNTIME-OBSERVATION.json은 2026-10-06 기록이다. 54,068원은 당시
$40×1351.70의 환산 근거이며 현재 재원이나 새 관측이 아니다.

## 도구와 배포의 분리

`status`는 schema/control/비용 원장/최신 관측/저장 projection을 읽는다.
`observe`와 `refresh`는 근거와 receipt를 보존하는 비용 관측 작업이며 새 모델 실행 권한을
만들지 않는다. 과거 allocation·refresh의 immutable 기록과 hold를 삭제하지 않는다.
과거 할당 변경의 freeze/drain·월별 승인·projection 유지비 계산을 현재 배포나 제품 기능의
필수 단계로 요구하지 않는다.

배포의 공용 action은 `scripts/configure-ai-runtime.ts`로 대상 환경 모델 capability를 설정한다.
기존 `--configure-ai`/`configure_ai` 입력은 호환용이며 비용 refresh/reallocate를 호출하지 않는다.
모델 bounds의 기존 checkedAt/validUntil은 보존한다. 비용 관측 만료를 통과시키려 시각을
늘리지 않으며 context/output/vision 등 실제 기술 제한을 유지한다. 비용 관측 도구는
모델 secret을 갱신하지 않는다.

preflight에서 비용 월·가격 SKU·FX/funding/allocation의 누락·만료는 관측 경고다.
실제 binding/credential·schema·crypto·모델 token/지원 형식의 기술 오류는 별도 실패다.
가격 metadata의 상태와 실제 provider 요청 실패를 혼동하지 않는다.

## 저장 용량 연결

물리 저장 연결은 실제 inventory·writer·진행 job을 다룬다. 초기화 입력의 serving SHA,
control revision, 실제 객체 수와 관측 시각·요청 digest·CAS/멱등 receipt는 보존한다.
비어 있지 않은 환경을 빈 환경으로 표시하거나 미확인 writer를 stopped로 추정하지 않는다.
서명·소유권·tombstone·lease·fencing·실제 byte 상한은 계속 적용한다.

비용 가격/재원/월 projection의 만료, 유지비 예약, 과거 GET/HEAD/DELETE 각50회 예약을
물리 용량이나 읽기·삭제 실행 권한으로 사용하지 않는다. 별도 비용 refresh 완료를 기다려
업로드·리포트·다운로드·삭제를 활성화하는 절차를 추가하지 않는다.
기술적 초기화 실패와 비용 관측 실패를 별도로 보고한다.

## 이력과 실제 인수

2026-10-14 21:30:58 KST production 저장 초기화와 21:31:57 KST 같은 할당 refresh는
당시 04f25f8 배포에서 실행한 역사적 절차다. 이후 채팅과 PDF/HTML 실제 성공 범위는
[현재 receipt](./PREBETA-COST-POLICY.md#현재-실제-증거와-이번-변경의-경계)를 따른다.
향후 수동 refresh가 기능 사용 조건이라는 뜻이 아니다.

0010~0014 migration, 원장·hold·미정산·기존 proof와 실패 rollback 증거를 보존한다.
관측 분리를 위한0015와 코드 변경의 병합·배포 상태는 [실행 기준](../development/EXECUTION.md)에
별도 기록한다. 이전 갱신 계약·로컬 SQL 수치·가격표는
[비용 운영 이력](../development/COST-CONTROLS-HISTORY.md)에 남긴다.
