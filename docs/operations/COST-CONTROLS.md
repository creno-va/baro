# 사용량·실제 비용 운영

- Reviewed: 2026-10-14 KST; 담당 #57 비용 모듈 / 총괄 hyunhomon.
- 현재 결정: [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), 실행: [비용 갱신·재개](./COST-REFRESH.md).

## 권한과 현재 상태

AI는 KST 하루200회, 질문 최대2×3이며 애플리케이션 월 예산 차단은 해제한다.
기존 모델·공급자·결제 경로·사용자 설정 자동충전($10/$30)은 유지한다. 과거 100만원
allocation 금액과 원장은 보존하며 cap-off 모드에서 월 소비 차단 한도로 사용하지 않는다.
유효한 가격·최신 재원·물리 용량·새 요청의 전체 비용 상한은 계속 확인한다. 월 cap 해제가
무한 재원, 실제 0원 과금, 미정산 삭제나 새 결제·자동충전 변경 승인을 의미하지 않는다.

2026-10-14 인증된 콘솔에서 Workers Paid/R2 Paid, Gateway 기존 크레딧 $39.54,
자동충전 ON/$10/$30을 읽기 전용으로 확인했다. 두 Gateway의 retry/logging/cache/spend-limit은
OFF, 인증/ZDR은 ON이었다. 결제·충전 설정은 변경하지 않았다. 이는 실제 입력을 준비하기
위한 시점 관측이며 개별 attempt 청구 증거나 만료 없는 실행 권한은 아니다.

실제 status run38522585343은 양 환경 schema0009·기존 allocation1·projection 없음과
미정산 preview21,895원/production44,104원을 반환했다. 이 금액을 지우지 않고 최종 후보
migration·실제 inventory/projection·최신 관측을 적용해야 한다. 당시 과거 funding의 최대정수
허용액을 새 실제 재원으로 재사용하지 않는다. credit만으로 기존 노출과 새 상한을 보장하지
못하면 승인된 결제 경로의 재원 근거를 추가 확인하거나 차단을 유지한다.

## 제품 제한

| 대상 | 한도 | 계산 경계 |
| --- | --- | --- |
| 계정·KST 일일 | 신규 사건 3개 | 동일 idempotency 재요청/재시도는 신규 사건 아님 |
| 계정·KST 일일 | AI 응답 200회 | 공개할 질문 묶음·요약·채팅·AI 자료 해석마다 예약; 내부 phase/교정은 추가 응답 아님 |
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

2026-10-14 공식 문서 재확인에서 아래 단가를 확인했다. 변동 가능 reference 입력이며 계정에
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
| [gpt-6-sol](https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/) | per1Mtokens short 일반/cache-read/cache-write 입력$2/$0.20/$2.50·출력$10, long$4/$0.40/$5·출력$15 | 전체 입력272,000tokens 초과 시 long. cache-write는 일반 입력에 중복 합산하지 않음; 실제 context/cache/tier/지역과 Gateway usage 확인 |
| [AI Gateway](https://developers.cloudflare.com/ai-gateway/reference/pricing/), [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) | core 기능 무료, credit 구매 수수료5%, inference provider 가격 전달 | 기존 credit 원가/새 구매 수수료의 회계 범위를 분리해 중복 합산하지 않음. 실제 funding/로그 과금은 별도 확인 |


## 같은 할당 갱신과 할당 변경

운영 도구는 status(읽기 전용), observe(관측 설치), refresh(같은 할당 재개), reallocate
(할당 변경)를 구분한다. 사용자 API는 가격·재원 근거나 재개 권한을 받지 않는다.
refresh는 동일 allocation/manifest·현재 control revision을 검사하며 hold·실행 중 job·quota·
원래 호출의 가격을 보존한다. 새 권한·추가 유지비·projection 갱신과 활성화는 같은 batch다.
응답 유실은 동일 관측과 operation key로 재시도하고 완료 receipt를 재사용한다.
최신 재원이 unavailable/만료면 과거 funded proof로 돌아가지 않는다.

환경별 DB.batch는 전역 atomic이 아니다. allocation 금액·version 변경은 기존 양 환경
freeze/drain·상호 receipt 조율을 유지하고 미정산 hold를 지워 drain을 통과시키지 않는다.
새 달은 이월 노출과 새 달의 실제 권한을 확인한다. 자세한 운영 입력·초기 projection과
경합/응답 유실/월 경계 검사는 [비용 갱신·재개](./COST-REFRESH.md)를 따른다.

## 실행 상한과 정산

Gateway retry는 실제 환경에서 OFF를 확인하며 SDK/transport 숨은 retry도 예약 상한에
포함한다. timeout은 원격 abort 증거가 아니며 같은 불명확 작업을 새 호출로 반복하지 않는다.
원본 PUT·변호사 자산·공개 복사는 인증부터 GET/PUT·writer 종료·실패 cleanup·원장 통지를
포함한다. 물리 용량과 저장 유지비/IO는 별도로 예약한다. exact-token 종료 증거가 없는
writer는 running/held, 공급자 계측이 없는 비용은 reserved/ambiguous로 유지한다.

Containers는 CPU·provisioned memory/disk·idle·network·Worker/DO/로그를 고려하고
독립 deadline과 실제 stop/destroy 상태를 검증한다. media·vision 등 필요한 SKU/capability의
유효 근거가 없으면 해당 경로만 unavailable로 남기며 임의 무료 처리하지 않는다.
무료 포함량은 계정 전체·실제 billing 기간의 남은 양을 확인한 경우만 적용한다.

## 검증과 이력

변경별 SQL/native/실패 검증과 최종 후보 수동 full을 수행한다. 같은 SHA preview/production
제한 실제 smoke·자료 정리·공급자 청구 대조는 #57/#58/#71의 실제 인수다. 로컬 D1 사용량은
호출 상한 검증이며 실제 청구액이 아니다. 이전 plan/credit/월 cap·전환 계약과 실패 관측은
[비용 운영 이력](../development/COST-CONTROLS-HISTORY.md)에 보존한다.
