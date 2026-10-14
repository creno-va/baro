# 사용량·실제 비용 운영

- Reviewed: 2026-10-14 KST; 담당 #57 비용 모듈 / 총괄 hyunhomon.
- 현행 정본: [프리베타 비용 관측 전용 정책](./PREBETA-COST-POLICY.md), [ADR-0015](../adr/0015-maintenance-and-operating-policy.md).
- 관측 도구: [비용 기록 갱신](./COST-REFRESH.md). 전체 관측 분리 구현·배포 상태는 현행 정본에 기록한다.

## 비용 관측과 실행의 분리

`APPLICATION_COST_LIMITS_ENABLED=false`에서 월 예산·재원·요청 금액과 예약 초과뿐 아니라
가격/FX/funding의 누락·만료, 월별 allocation/control, 비용 승인·수동 refresh, 유지비,
비용 예약 GET/HEAD/DELETE 횟수로 기능이나 배포를 거절·대기·동결하지 않는다.
과거 각50회 IO 예약은 다운로드·삭제 quota가 아니다. 사용자 재지시 전 비용 차단을 재도입하지 않는다.
`MONTHLY_BUDGET_CAP_ENABLED=false`만으로는 이 정책을 충족하지 않는다.

기존 모델·공급자·결제 경로·사용자 설정 자동충전($10/$30)을 유지한다. 관측 원본과
실제·추정·예약·미정산 비용은 보존하며 확인되지 않은 가격/재원을0원이나 무한 재원으로
만들지 않는다. 관측 시각·validUntil·spendAllowanceKrw를 실행 허용 목적으로 늘리지 않는다.
비용 기록 실패는 별도 운영 관측으로 남기며 정상 제품 작업의 실패로 전파하지 않는다.

실제 binding/credential·공급자 API 오류, 인증/권한/무결성, 물리 저장 용량, 처리 시간·메모리·
query·모델 context/output·재시도 상한은 별도다. 비용 metadata의 stale 상태를 실제 공급자
장애나 credential 부재로 표시하지 않는다. 신규 모델/결제 설정 변경 권한은 추가하지 않는다.

## 제품 제한

| 대상 | 한도 | 계산 경계 |
| --- | --- | --- |
| 계정·KST 일일 | 신규 사건 3개 | 동일 idempotency 재요청/재시도는 신규 사건 아님 |
| 계정·KST 일일 | AI 응답 200회 | 공개할 질문 묶음·요약·채팅·AI 자료 해석마다 예약; 내부 phase/교정은 추가 응답 아님 |
| 계정·KST 일일 | audio/video 처리 60분 | video audio와 frame 처리 하나의 media duration; 동일 작업 retry 중복 차감 없음 |
| 계정 저장 | 10,000,000,000 bytes | 사건/프로필 원본·파생·리포트·ZIP와 pending 예약 |
| 사건 원본·파일 수 | 원본 합계 5,000,000,000 bytes / 원본 100개 | pending 원본 예약 포함; 파생물·리포트는 계정 10GB와 처리 제한에 포함 |
| 문서·이미지 | 파일당 100,000,000 bytes | 업로드 실측 원본 bytes |
| audio/video | 파일당 1,000,000,000 bytes / 60분 | bytes와 duration 모두 통과 |
| PDF | 파일당 500 pages | 파싱 후 page 상한 검사; byte 한도도 적용 |

KST day는 서버가 정하며 사용자 quota·실제 물리 예약의 병렬 처리는 D1 atomic/CAS로 보호한다.
클라이언트 시간이나 화면 counter를 정본 quota로 사용하지 않는다. 비용 예약의 IO 횟수와
제품/기술 한도를 혼용하지 않는다.

## Ledger와 관측

사용자 quota와 비용 원장은 분리한다. operation/idempotency/candidate/환경/attempt와 provider
request 상관관계를 남기되 prompt·파일명·원본·결과·이메일·토큰은 기록하지 않는다.
일일 counter는 owner에게만, 전역 원가는 운영자에게 비민감 집계로 제공한다.

확인 가능한 가격·FX·사용량·receipt로 예상/실제 비용을 기록한다. 공식 SKU/모델/지역·단위·
확인일·URL과 실제 청구 환율/수수료의 근거를 유지한다. 정수 KRW 또는 정확한 decimal로
계산하고 추정치와 최종 청구를 구분한다. 누락·만료 정보는 unknown/stale로 표시한다.
무료 포함량이나 할인은 계정 전체와 billing 기간의 실제 잔여 근거가 있을 때만 산정에 사용한다.
근거 부족은 비용의 불확실성이며 실행 거절 사유가 아니다.

unknown timeout/crash의 hold는 임의 해제하지 않는다. remote request/DO/job handle과
billing을 사후 대조한다. 원래 호출의 가격과 실제 receipt를 연결하고 이전 월 비용·이월을
지우거나 이중 정산하지 않는다. 비용 기록/정산 오류가 나더라도 이미 완료한 제품 결과를
실패로 바꾸지 않는다. 사후 대조가 가능한 비민감 상태를 보존한다.

## 운영과 기술 경계

배포는 필수 모델 capability와 binding을 구성하며 비용 refresh/reallocate를 선행 조건으로
요구하지 않는다. 모델 context/output·vision 지원의 실제 기술 근거는 유지한다.
과거 billing 관측과 묶인 모델 bounds의 비용 유효기간은 실행 승인 조건이 아니다.
관측의 checkedAt/validUntil을 그대로 보존하며 현재 관측처럼 다시 쓰지 않는다.

물리 용량 초기 연결은 실제 inventory·writer·객체 상태를 확인한다. 비용 projection의
없음/월 전환/만료를 물리 용량 부족으로 간주하지 않는다. 서명·소유권·tombstone·lease·
fencing 검사는 유지한다. 확인되지 않은 writer는 running/held, 미확정 비용은 ambiguous로
보존한다. 실제 공급자의 거절·timeout이나 처리 OOM은 비용 정책 해제로 숨기지 않는다.

## 실제 증거와 이력

04f25f8의 채팅·PDF/HTML 실제 성공과 외부 설정 관측은
[현행 정책의 증거](./PREBETA-COST-POLICY.md#현재-실제-증거와-이번-변경의-경계)를 따른다.
이 기록은 관측 분리 변경 전체의 적용 완료나 모든 외부 인수의 완료를 뜻하지 않는다.
이전 SKU 가격표, 비용 만료 차단·refresh·할당 전환 계약과 실패 관측은
[비용 운영 이력](../development/COST-CONTROLS-HISTORY.md)에 보존한다.
