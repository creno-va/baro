# v2 사용량·월 비용 운영

- Status: Implementation target — ledger·cloud cap이 구현되었다는 증거 아님
- 기준: 2026-10-06; 구현 #57, 저장/처리 #58/#59, 실제 검증 #71
- 참조: [파일 처리](./FILE-PROCESSING.md), [배포](./DEPLOYMENT-OPERATIONS.md), [관측성](./OBSERVABILITY.md)

논리 operation·quota 소비/반환·실제 invocation/attempt·publish와 삭제의 기술 정본은
[v2 사용량과 비용](../architecture/DOMAIN-LIFECYCLE.md#v2-사용량과-비용)이다. 아래 절차는
#57 독립 문서 계약이며 #55 선행 병합 전 제품 코드를 시작하거나 cloud 설정을 적용하지 않는다.

## 권한과 예산

월 기술 예산은 **1,000,000 KRW**이며 실제 cloud 리소스 생성과 처리 비용 사용을 사용자가
허용했다. 법률 검토 비용은 별도다. 새 결제수단·자동 충전·예산 확대·새 모델/공급자 도입은
이 승인에 포함되지 않는다. 기존 credit 잔액은 월 예산과 별개의 funding 상태이며 잔액 부족을
예산이 남았다는 이유로 자동 구매로 해결하지 않는다. 무료 플랜/credit을 사용하더라도 실제
metered usage와 원가를 기록한다. 공개 사용자는 누구나 가입할 수 있고 모두 같은 전역 budget을 공유한다.

Gateway 기존 credit $10/auto recharge OFF와 과거 probe의 예약1/완료 report 없음은 날짜별
관측이다. 후속 별도 candidate의 strict screening 성공은 [readiness 기록](./ENVIRONMENT-READINESS.md)에
있으며 과거 미확정 호출이나 실제 정확한 청구액을 대신 정산하지 않는다. 실제 계정 잔액·spend
limit·청구액은 실행 전 다시 확인한다. 실패했다고0원/미실행으로 기록하거나 같은 불명확 호출을
새 probe로 중복 실행하지 않는다. credit 잔액의 반올림 표시를 정확한 무과금 증거로 쓰지 않는다.

## 제품 제한

| 대상 | 한도 | 계산 경계 |
| --- | --- | --- |
| 계정·KST 일일 | 신규 사건 3개 | 동일 idempotency 재요청/재시도는 신규 사건 아님 |
| 계정·KST 일일 | AI 응답 30회 | 공개할 질문 묶음·요약·채팅·AI 자료 해석마다 예약; 내부 phase/교정은 추가 응답 아님 |
| 계정·KST 일일 | audio/video 처리 60분 | video audio와 frame 처리 하나의 media duration; 동일 작업 retry 중복 차감 없음 |
| 계정 저장 | 10,000,000,000 bytes | 사건/프로필 원본·파생·리포트·ZIP와 pending 예약 |
| 사건 원본·파일 수 | 원본 합계 5,000,000,000 bytes / 원본 100개 | pending 원본 예약 포함, 복제 원본도 별도 업로드이면 파일 1개. 파생물·리포트는 계정 10GB와 처리 제한에 포함 |
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
   carry-over storage·진행 중 exposure·기본 계획 요금을 새 달 admission에 반영한다. 과거
   attempt의 원래 월 정산과 새 달의 보수적 exposure reference를 구분해 실제 청구를 두 번
   합산하지 않는다. 달력 경계에서 비용을 지우거나 동시에 두 번 실행하지 않는다.

가격 근거는 공식 SKU/모델/지역·단위·확인일·URL을 기록하고 환율은 운영자가 지정한 검증
가능한 기관/실제 청구 환율과 확인일을 기록한다. 임의 고정 환율로 실행 비용을 확정하지 않는다.
계산은 정수 KRW minor 단위 또는 정확한 decimal로 하며 상한 예약은 위쪽으로 반올림한다.

## 검증된 quote와 funding

quote는 내부 가격 registry의 immutable 버전에서 서버가 계산한다. 기록할 입력은 공급자/SKU/
모델/지역·계정 plan·billing mode·단위와 단가·공식 근거 URL·확인일·유효 기한·환율의 기관/
기준일/확인일·세금/환전/수수료와 안전 여유다. operation의 고정 입력 hash/revision·최대 입력/
출력 token·ASR chunk duration/overlap·frame 수·Container instance type/CPU/실행/idle deadline·
physical 저장량과 요청 수·bounded retry를 연결한다. 공개 ledger의 pricing version 이름만으로
해당 단가/환율이 검증됐다고 주장하지 않는다. client quote를 신뢰하거나 누락값을0으로 채우지 않는다.

가격·환율·funding은 각각 검토 시각/validUntil이 있는 근거다. 실행 직전 canonical UTC
milliseconds로 유효성을 다시 확인한다. funding에는 실제 plan/capability·결제 경로·현재 credit/
이미 예약된 credit·auto recharge 상태·spend 설정 관측 시각을 포함한다. stale/미확인 funding은
예산이 남아도 paid fail-closed다. quote 갱신/증액은 기존 hold를 보존한 원자적 교체이며 만료
quote를 실행하거나 새 월/가격 버전이라는 이유로 예전 미확정 hold를 지우지 않는다.

USD/KRW는 검증 가능한 기관의 날짜 있는 값과 실제 청구 환율/수수료를 대조한다. 현재 문서에
검증된 환율값·실제 invoice/tax가 없으며 임의 고정 환율로 실행 비용을 확정하지 않는다.
주말/휴일 또는 갱신 실패도 최신 확인일과 명시한 freshness 정책으로 판단하고0원으로 처리하지
않는다. 사용량만 있어 계산한 금액은 근거가 있는 추정 정산이며 공급자 최종 청구 대조 전 상태를
구분한다. usage도 없으면 chargedKrw를0으로 채우지 않고 ambiguous 예약을 유지한다.

2026-10-06 공식 문서 조회에서 아래 단가를 확인했다. 변동 가능 reference 입력이며 계정에
Paid/Containers/R2/Whisper가 활성화됐거나 청구액이 확정됐다는 증거는 아니다. 새 quote 때
공식 가격을 재확인하고 무료 포함량은 account 전체와 billing 기간의 실제 잔여량을 대조한다.
환경마다 같은 free allowance를 중복 적용하지 않는다. 확인되지 않은 할인/캐시 hit를 예약에 적용하지 않는다.

| 서비스 | 확인된 가격 입력 | quote/정산 경계 |
| --- | --- | --- |
| [Workers](https://developers.cloudflare.com/workers/platform/pricing/) | Free100,000requests/day·10msCPU/invocation. Paid최소$5/month,10Mrequests·30MCPU-ms/month포함, 초과$0.30/Mrequests·$0.02/MCPU-ms | account 고정비는1회; CPU/요청·DO/Workflow/로그 등 별도 metered 비용 포함 |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/) | Free5Mrows read/day·100Kwrite/day·5GB. Paid25Bread·50Mwrite/month·5GB포함, 초과$0.001/Mread·$1/Mwrite·$0.75/GB-month | meta.rows_read/rows_written·index/삭제/DDL·DB storage; 무료일은00:00UTC, 월 포함량은 구독 갱신 기준 |
| [R2 Standard](https://developers.cloudflare.com/r2/pricing/) | $0.015/GB-month·A$4.50/M·B$0.36/M, 무료10GB-month·A1M·B10M/month | 일별 peak 평균과 다음 billing unit 올림, parts·복사본·cipher bytes 포함. Delete/AbortMultipartUpload 무료여도 Worker/D1은 별도 |
| [Containers](https://developers.cloudflare.com/containers/platform/pricing/) | Paid포함량25GiB-hours memory·375vCPU-minutes·200GB-hours disk/month; 초과$0.0000025/GiB-second·$0.000020/vCPU-second·$0.00000007/GB-second. Korea egress$0.05/GB | 10ms billing, provisioned memory/disk·activeCPU·idle/egress·Worker/DO/로그. 실제 배치 지역과 남은 포함량 확인 |
| [Whisper 모델](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/), [플랫폼 표](https://developers.cloudflare.com/workers-ai/platform/pricing/) | 모델페이지$0.000513/audio-minute, 플랫폼 표$0.0005와46.63neurons/minute | 표시 정밀도 차이를0비용으로 해석하지 않음. 더 높은 확인값·단위 올림·chunk overlap·retry를 예약하고 실제 neuron/billing 대조 |
| [gpt-6-sol](https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/) | short input/output$2/$10 per1Mtokens, long$4/$15 | short/long 경계·이미지/reasoning/token 계산과 실제 Gateway usage 확인. 현재 부족한 입력 근거는 추정/보류로 구분 |
| [AI Gateway](https://developers.cloudflare.com/ai-gateway/reference/pricing/), [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) | core 기능 무료, credit 구매 수수료5%, inference provider 가격 전달 | 기존 credit 원가/새 구매 수수료의 회계 범위를 분리해 중복 합산하지 않음. 실제 funding/로그 과금은 별도 확인 |

## 환경별 할당과 안전한 전환

preview와 production은 DB/자원을 분리하므로 각각 월100만원을 허용하지 않는다. 월별 immutable
allocation manifest에 month/version·각 환경 cap·account 공유 fixed/maintenance reserve·관측 시각/
유효 기한·검토 근거를 둔다. 항상 `sum(environment caps) + shared fixed + shared maintenance
<= 1,000,000 KRW`를 검증한다. 환경 cap 안에서도 settled+reserved+ambiguous+그 환경의 남은
필수 의무를 제외한 금액만 admission한다. global limit=100만원의 집계 계약과 local allowance를
별도로 표시하고, 고정비를 local/shared 두 곳에 중복 계산하지 않는다. manifest가 없거나 만료되면
paid 작업은 보류한다. shared reserve도 최초 manifest에 이미 배정된 범위 밖으로 사용하지 않는다.

일반 사용자 요청은 allocation 변경을 승인하지 않는다. 서로 다른 DB.batch를 전역 atomic으로
표현하지 않으며 중앙 authority를 구현한다면 durable hold/commit/release와 실패 복구를 별도로
검증한다. 아래 보수적 환경 할당 전환은 운영 제어 plane의 version/CAS·신뢰 가능한 DB 관측으로
확인하며 client boolean/오래된 배포 상태를 ack로 인정하지 않는다.

1. transition ID와 현재/목표 month/version, 각 환경 spent/hold/ambiguous/유지 의무의 snapshot을
   고정한다. 목표 합계 invariant와 감소 환경의 새 cap이 기존 의무보다 작지 않음을 확인한다.
   미확정 실제 초과액을 삭제/축소해 할당 여유를 만들지 않는다.
2. 감소할 환경의 새 paid admission을 먼저 닫고 기존 lease/queued job을 drain/취소한다. 취소해도
   외부 진행/unknown charge는 hold로 남긴다. 비용 정산·읽기·삭제는 유지한다. 실행 직전 admission도
   DB의 allocation version/freeze를 검사해 오래된 Worker가 이전 cap으로 새 호출을 만들지 못하게 한다.
3. 감소 cap/version을 해당 환경 D1에서 CAS commit한다. 적용된 version·release SHA·commit 후
   spent/hold/ambiguous·계속 유지할 의무와 drain 결과를 신뢰 가능한 receipt로 확인하고 manifest
   전환 정본에 ack를 남긴다. 환경에 접속할 수 없거나 ack/미확정 의무가 부족하면 이전 cap을
   계속 점유한 것으로 취급하고 다른 환경을 증가시키지 않는다.
4. 모든 필요한 감소 ack 뒤에만 목표 manifest를 활성화하고 증가 환경 cap을 적용한다. partial
   실패는 낮아진 cap/동결과 이전 hold를 유지한 채 멱등 재개한다. 먼저 recipient를 늘리고 donor를
   나중에 줄이거나 실패 rollback으로 양쪽 cap을 동시에 복원하지 않는다.
5. 다시 DB version/집계 invariant를 확인한 뒤 admission을 재개한다. 이미 사용한 비용·미확정
   attempt는 새 allocation에서도 남는다. 복구/배포 rollback도 최신 allocation 전환 journal과
   비용/hold를 먼저 적용하며 과거 높은 cap 설정으로 traffic을 열지 않는다. 월이 바뀌어도 외부
   미확정 liability를 새 여유로 환산하지 않는다.

## 실제 plan 관측과 provisioning gate

2026-10-06 KST 인증된 콘솔의 읽기 전용 관측은 Workers `Free / Current plan`, Paid
`$5 / month + usage`, Containers의 Paid upgrade 안내였다. subscription 변경·Containers
활성화/생성은 하지 않았다. 근거는 [#27 관측](https://github.com/creno-va/baro/issues/27#issuecomment-6002618673),
[#59 관측](https://github.com/creno-va/baro/issues/59#issuecomment-6002619099)과
[readiness](./ENVIRONMENT-READINESS.md)다. 로컬 원본은 ignored 운영 작업 기록이며 secret은 없다.

현재 Free의 request/CPU·D1/ASR 무료 한도와 필요한 cleanup 여유를 확인한다. Containers를
사용하려면 승인 범위의 실제 Paid 구독 고정비·최대 사용량·funding·allocation·maintenance를
검증해 #59 provisioning gate를 충족해야 한다. 허용된 리소스 비용 사용은 이 문서가 실제 plan
변경/paid 기능 성공을 증명한다는 뜻이 아니다. 새 결제수단·자동충전·예산확대는 수행하지 않는다.

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
설정하되 platform soft limit을 절대 지출 보장으로 표현하지 않는다. 공식 [spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)
계약은 eventual consistency와 동시 burst 초과·best-effort 비용 추정을 명시한다. Unified Billing은
드문 credit 음수 잔액을 기존 결제수단에 청구할 수 있으므로 auto recharge OFF나 credit 잔액을
절대 과금 상한으로 표현하지 않는다. 예약보다 실제 비용이
커지거나 unknown charge가 발생하면 circuit breaker로 새 job을 멈추고 reconcile한다.
기존 credit 충전·auto recharge ON·plan upgrade 버튼은 자동으로 실행하지 않는다.

Containers는 실행 중 memory/disk provision과 CPU 사용량뿐 아니라 network·Worker·DO·로그도
비용 대상이다. sleep과 instance limit을 설정하고 idle 인스턴스가 실제로 종료되는지 확인한다.
계속 활동하는 job은 idle timer를 갱신할 수 있어 별도 최대 실행 deadline·bounded output/disk·
lease 취소·stop/destroy 후 실제 상태 확인이 필요하다. [Container class](https://developers.cloudflare.com/containers/api/container-class/)
의 onActivityExpired를 override하면 실제 stop/destroy를 호출해야 한다. 영상/문서 probe는
bounded 비용으로 먼저 실행하고 duration/frame/page 계획을 고정한 뒤 다음 paid stage를 예약한다.
부분 coverage/예산 대기를 전체 처리 완료로 표시하지 않는다.
[Containers 가격](https://developers.cloudflare.com/containers/platform/pricing/)

대형 자료의 staging·manifest publication도 [실행 계약](../architecture/DOMAIN-LIFECYCLE.md#v2-사용량과-비용)의
bounded 단계다. Workers128MB/D1 row2MB·Free50/Paid1000 query 한도를 기준으로 작은
암호화 chunk/handoff를 계획하고 공유 최대 허용량을 조용히 절삭하지 않는다. stage별 실제
추출·암호화·R2 write/read·D1 metadata·retry·실패 정리 비용을 quote/receipt에 넣는다.
publication 전 crash는 미완성 자료를 공개하지 않으며 이미 발생한 비용은 보존한다.
정리 대기 parts/copy는 실제 삭제 전 보관 비용/예약에 남고 maintenance 범위에서 정리한다.
[D1 제한](https://developers.cloudflare.com/d1/platform/limits/), [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)

Gateway [내장 retries](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/)와
SDK/transport retry는 adapter 호출 수 밖에서 비용을 만들 수 있다. 실제 환경의 retry OFF/단일
시도를 확인하거나 최대 multiplier를 quote에 포함한다. 과거 preview retry OFF 관측은 다른
환경/새 설정 증거가 아니다. binding timeout이 원격 abort를 보장하지 않으면 즉시 겹치는
재시도를 하지 않고 같은 handle/비용 reservation을 대조한다.

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

추가 실패 검증은 fractional/nonfractional timestamp 만료 경계,0.5초media, 만료 key 재사용,
schema-invalid/refusal usage 정산, late receipt 중복, 삭제 뒤 정산·실제 객체 삭제 전 storage
반환 금지, 환경 allocation 감소 전 증가 거부·ack 유실·partial rollback·restore·월 전환이다.
문서/소스 경계 검사와 mandatory ci/check/build/cf:dry-run은 계약 PR의 검증이며, 실제 환경
meter·청구 대조·Containers/Paid 활성화·공개 정책 승인 증거는 별도로 남는다.
