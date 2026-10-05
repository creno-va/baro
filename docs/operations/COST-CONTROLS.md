# v2 사용량·월 비용 운영

- Status: Implementation target — ledger·cloud cap이 구현되었다는 증거 아님
- 기준: 2026-10-06; 구현 #57, 저장/처리 #58/#59, 실제 검증 #71
- 참조: [파일 처리](./FILE-PROCESSING.md), [배포](./DEPLOYMENT-OPERATIONS.md), [관측성](./OBSERVABILITY.md)

## 권한과 예산

월 기술 예산은 **1,000,000 KRW**이며 실제 cloud 리소스 생성과 처리 비용 사용을 사용자가
허용했다. 법률 검토 비용은 별도다. 새 결제수단·자동 충전·예산 확대·새 모델/공급자 도입은
이 승인에 포함되지 않는다. 기존 credit 잔액은 월 예산과 별개의 funding 상태이며 잔액 부족을
예산이 남았다는 이유로 자동 구매로 해결하지 않는다. 무료 플랜/credit을 사용하더라도 실제
metered usage와 원가를 기록한다. 공개 사용자는 누구나 가입할 수 있고 모두 같은 전역 budget을 공유한다.

현재 Gateway 기존 credit $10/auto recharge OFF 확인은 과거 관측이다. 실제 계정 잔액·spend
limit·청구액은 실행 전 다시 확인한다. 임시 AI probe의 예약1/완료 report 없음은 결과와 비용
미확인 상태다. 호출이 실패했다고 0원이나 미실행으로 기록하거나 새 probe로 중복 호출하지 않는다.

## 제품 제한

| 대상 | 한도 | 계산 경계 |
| --- | --- | --- |
| 계정·KST 일일 | 신규 사건 3개 | 동일 idempotency 재요청/재시도는 신규 사건 아님 |
| 계정·KST 일일 | AI 응답 30회 | 질문 생성·요약·채팅·행동 생성 등 모델 작업을 사용자 논리 작업 단위로 예약 |
| 계정·KST 일일 | audio/video 처리 60분 | video audio와 frame 처리 하나의 media duration; 동일 작업 retry 중복 차감 없음 |
| 계정 저장 | 10,000,000,000 bytes | 사건/프로필 원본·파생·리포트·ZIP와 pending 예약 |
| 사건 저장·파일 수 | 5,000,000,000 bytes / 원본 100개 | 파생·리포트·예약 저장량 포함, 복제 원본도 별도 업로드이면 파일 1개 |
| 문서·이미지 | 파일당 100,000,000 bytes | 업로드 실측 원본 bytes |
| audio/video | 파일당 1,000,000,000 bytes / 60분 | bytes와 duration 모두 통과 |
| PDF | 파일당 500 pages | 파싱 후 page 상한 검사; byte 한도도 적용 |

KST day는 서버가 정하고 병렬 작업의 예약은 D1 atomic/CAS로 처리한다. 클라이언트 시간,
rate-limit binding이나 화면 counter를 정본 quota로 사용하지 않는다. audio+video가 일일
60분이더라도 file CPU/frame/token/storage cost는 전역 ledger에서 따로 제한한다.

## Ledger와 reservation

user quota와 실제 비용 ledger는 분리한다. 각각 operation/idempotency/candidate/환경/attempt와
provider request 상관관계를 갖되 prompt·파일명·원본·결과·이메일·토큰을 저장하지 않는다.
일일 counter/잔여량은 owner에게만 노출하고 전역 원가는 운영자의 비민감 집계로 제공한다.

1. admission 전에 resource 타입·최대 입력/출력·media duration/frame 수·instance type/실행 시간·
   storage 예상량·retry 상한으로 최대 비용을 예약한다. 필요한 가격/환율/funding 정보가 없거나
   현재 budget과 outstanding reservation에 들어오지 않으면 실행을 보류한다.
2. 원격 호출 직전 attempt 예약을 durable하게 기록한다. unknown timeout/crash는 예약을 임의
   해제하지 않고 remote request/DO/job handle과 billing을 대조한다. 사용자 논리 작업 재시도는
   동일 user reservation을 쓰고 원격 attempt마다 실제 비용을 추가한다.
3. 실제 model token·ASR duration·Container CPU/memory/disk/시간·R2 storage/A/B ops·Worker/
   DO/Workflow/D1/로그·network 비용을 reconcile한다. rounding·최소 청구·부가세·환전 비용과
   실제 invoice 금액을 보수적으로 포함한다. 한 서비스의 free egress를 다른 서비스에 일반화하지 않는다.
4. 월 rollover는 KST를 제품 기준으로 하되 공급자의 billing 기간과 겹치는 사용량을 대조한다.
   carry-over storage·진행 중 reservation·기본 계획 요금을 새 달에 재예약한다. 작업이 끝나지
   않았다고 달력 경계에서 비용을 지우거나 동시에 두 번 실행하지 않는다.

가격 근거는 공식 SKU/모델/지역·단위·확인일·URL을 기록하고 환율은 운영자가 지정한 검증
가능한 기관/실제 청구 환율과 확인일을 기록한다. 임의 고정 환율로 실행 비용을 확정하지 않는다.
계산은 정수 KRW minor 단위 또는 정확한 decimal로 하며 상한 예약은 위쪽으로 반올림한다.

## 과금 항목과 cap

초기 운영 임계치는 전체 월 한도의 70% 관측 경고, 85% 보수적 admission 축소, 90% 신규
고비용 작업 보류다. 절대 조건은 actual + outstanding + 남은 필수 운영/보존 예상 비용이
1,000,000 KRW를 초과하는 새 비용 예약을 거부하는 것이다. 이 임계치는 새로운 금액 승인이나
서비스 공급자의 hard cap 기능이 아니며 구현/실측으로 튜닝한다. 무료 가입이 무제한 처리를 뜻하지 않는다.

예산 보류 때 조회·download·삭제·프로필 철회·보안 복구는 유지할 reserve를 사전에 배정한다.
보존 중인 파일의 다음 월 storage 비용까지 예측하고, 자동 삭제로 비용 문제를 숨기지 않는다.
필수 운영 비용조차 예산에 맞지 않을 것으로 예상되면 신규 업로드/AI를 일찍 닫고 운영자에게
보관량·예상액·필요 행동을 알린다. funding/payment/한도 변화는 사용자 결정으로 남긴다.

Gateway per-user/model spend controls·rate limit·Container max instances와 timeout을 함께
설정하되 platform soft limit을 절대 지출 보장으로 표현하지 않는다. 예약보다 실제 비용이
커지거나 unknown charge가 발생하면 circuit breaker로 새 job을 멈추고 reconcile한다.
기존 credit 충전·auto recharge ON·plan upgrade 버튼은 자동으로 실행하지 않는다.

Containers는 실행 중 memory/disk provision과 CPU 사용량뿐 아니라 network·Worker·DO·로그도
비용 대상이다. sleep과 instance limit을 설정하고 idle 인스턴스가 실제로 종료되는지 확인한다.
[Containers 가격](https://developers.cloudflare.com/containers/platform/pricing/)

R2는 storage와 Class A/B operations를 계산한다. egress 무료여도 연결된 다른 metered service
비용은 별도이며 Infrequent Access의 최소 보관/회수 요금은 삭제 비용 예측에 포함한다. 초기에는
명세와 실측을 우선하고 임의 storage class 전환으로 비용을 숨기지 않는다.
[R2 가격](https://developers.cloudflare.com/r2/pricing/)

## 운영 확인과 실제 완료 증거

일별 actual·reserved·unknown·projected month-end와 funding 상태를 집계하고 가격/환율 갱신,
이상 증가·dupe operation·예약 누수·부분 실패를 확인한다. metrics에 원문/사용자 파일 hash를 쓰지 않는다.
retry·timeout·삭제·고립 job·KST midnight·월 경계·병렬 admission·한도 직전 N+1 작업 테스트를
통과시키고 #71에서 실제 metering/console/invoice와 ledger를 대조한다. 합성 ledger 테스트를
실제 hard cap 증거로 대체하지 않는다. 보고서에는 확인된 금액/단위/시각과 실제 비용 미확인을 구분한다.
