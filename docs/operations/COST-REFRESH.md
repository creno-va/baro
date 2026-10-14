# 비용 설정 갱신과 같은 할당 재개

- 기준: [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), #57/#58.
- 담당: hyunhomon / 이 채팅. 모듈 소유권과 기존 할당 변경 조율은 유지한다.

## 운영 입력

운영 도구만 가격·재원 관측을 받는다. 사용자 API에는 이 입력이나 재개 권한이 없다.
`scripts/provision-ai-budget.ts <sha> <status|observe|refresh|reallocate> <preview|production|both>`를
사용한다. 기본은 `refresh`, reallocate는 both가 필수다. 수동 Cost operations workflow는
main에서 두 지정 운영자만 실행한다. 관측 JSON은 환경변수로 전달하며 shell 코드에 삽입하지 않는다.

- `checkedAt`, `validUntil`: 실제 관측 시각과 만료. 미래 관측, 만료, 24시간보다 오래된
  billing 관측은 거부한다. 파일 날짜를 현재로 바꾸는 행위가 실제 관측을 대신하지 않는다.
- `creditUsd`, `fx`: 새 잔액·환율·출처·기준 시각을 입력한다. 과거 수치는 코드 상수가 아니다.
- `pricing`: SKU별 승인 공급자·모델·단위·단가·rate matrix·FX·세금/수수료/여유와 유효기간.
  기존 모델과 Cloudflare Whisper 식별자·공식 출처 계약은 그대로 검사한다.
- `spendAllowanceKrw`: 원장이 사용하는 **누적 지출 허용 상한**이다. 현재 추가 재원에 이미
  정산된 금액을 더한 기준 등 산정 근거를 확인한다. 원장의 정산·미정산·유지비·이월과 새
  최대 비용이 이 상한 안에 있어야 한다. 현재 잔액을 무한 재원으로 해석하지 않는다.
- `fundingState`: funded / trial_credit / unavailable. 중단 관측은 observe로 최신 head에
  설치한다. 최신 head가 중단·만료되면 과거 funded 값으로 돌아가지 않는다.
- 기존 결제 경로·자동충전 true·$10/$30·월 cap false는 유지한다. 이 도구는 결제수단이나
  자동충전 설정을 바꾸는 API를 호출하지 않는다.

기존 AI-RUNTIME-OBSERVATION.json은 2026-10-06 기록이다. 새 입력 형식으로 당시 단가를
명시했으며, 54,068원은 당시 $40×1351.70의 보수적 환산 기준이다. 새 관측이나 현재 재원
증거가 아니며 stale 검사로 적용되지 않는다. 실제 새 근거는 운영자가 확인해 별도로 입력한다.

## 세 작업의 차이

`status`는 관측 입력 없이 현재 schema, control revision, 원장 노출액, 최신 재원 head,
저장 projection과 이월만 읽는다. 비공개 payload·계정·증거 reference는 반환하지 않는다.
0010 이전 DB의 재원 기록은 legacy observation으로 표시하며 현재 실행 권한으로 해석하지 않는다.

`observe`는 안정적인 관측 digest로 immutable pricing/funding proof를 설치한다. control을
활성화하거나 AI bounds secret을 바꾸지 않는다. 최신 중단 재원은 즉시 다음 처리를 막는다.

`refresh`는 같은 할당 version·manifest·금액·현재 control revision을 확인한다. 원본 할당과
proof를 고치지 않고 `v2_runtime_refreshes`에 새 유효 권한을 기록한다. 기존 비용 hold,
실행 job/lease, 사용자 quota와 원래 호출의 정산 가격은 보존한다. 저장 projection이 있으면
새 가격으로 전체 보수적 유지비를 추가 예약하며 이전 유지비를 환불하지 않는다. 용량과 IO
한도·사용 카운터를 바꾸거나 초기화하지 않는다. 근거·금액·projection·권한 기록·활성화는
동일 batch다. freeze 또는 할당 변경으로 revision이 바뀌면 갱신 권한을 다시 받아야 한다.

동일 관측의 응답 유실은 같은 입력·operation_key로 재시도한다. 기본 키는 default이며,
새 projection 연결 등 별도 설정 작업은 새 키를 사용한다. 관측 시각을 바꿔 요청 키를 대신하지 않는다. 완료된 요청의 receipt를 반환하며
추가 유지비를 다시 예약하지 않는다. 그 receipt는 과거 요청 완료의 증거이며 현재 재원과
control이 여전히 사용 가능하다는 보장은 아니다. 새 달의 작업은 새 달 할당·이월 검사를
받으며, 지난달 완료 receipt 재조회가 새 달을 활성화하지 않는다.

`reallocate`는 기존 양 환경 freeze/drain/상호 증거 확인을 사용한다. outstanding hold가
있으면 실패한다. 이 실패를 해결하기 위해 hold를 지우지 않는다. 월 최초 설정은 해당 월의
zero-state를 검사하며 과거 달 원장은 보존한다. 같은 할당 갱신에는 이 경로를 사용하지 않는다.

환경별 갱신은 독립적이다. 한 환경이 이미 완료되고 다른 환경이 실패했다면 완료된 원장을
되돌리지 않고 같은 관측으로 재시도하거나 실패 환경만 새 근거로 갱신한다. 새 모델이나
가격이 없는 SKU는 임의 무료 처리로 대체하지 않는다.

## 저장 projection 초기 연결

수동 Cost operations의 `initialize-storage`는 **기록된 객체·저장 실행·진행 job이 없는 초기
환경**만 지원한다. target은 한 환경이며 `storage_initialization_json`에 현재 serving SHA,
현재 control revision, capacity/IO 상한, 인증 콘솔에서 실제 확인한 두 R2 버킷의 객체0개와
5분 이내 관측 시각을 받는다. CLI는 해당 환경 health의 실제 SHA를 먼저 대조한다.
그 JSON은 사용자 API 입력이 아니며 관측 시각 갱신만으로 실제 inventory 확인을 대신하지 않는다.

최신 가격·재원 observe 후 exact revision의 freeze와 요청 digest receipt를 같은 batch로
기록한다. receipt는 비민감 `app_metadata` 운영 키에 보존한다. projection/유지비 예약은
기존 coordinator를 사용하며 아직 활성화하지 않는다. 같은 관측과 operation key의 유실
응답은 freeze/projection을 다시 만들지 않고 복구한다. 별도 `refresh`가 같은 할당을 재개한다.
후속 refresh 뒤 초기 연결의 동일 요청을 재조회해도 추가 유지비·동결을 만들지 않는다.

비어 있지 않은 환경·이전 저장 실행·미완료 job은 초기 연결로 우회하지 않는다. 입력이
부족하거나 CAS/가격/재원 검사가 실패하면 실행 권한을 만들지 않고 기존 데이터·hold·job을
보존한다. 이미 freeze가 commit된 실패는 frozen과 receipt를 유지하며 원인 수정 후 재시도한다.

기존 reserveProjection/bindInventory coordinator 경계를 사용한다. 실제 opaque inventory를
확인한 뒤 용량·유지비·IO 상한을 예약한다. 첫 projection은 active/frozen/drained의 정확한
revision에서 예약할 수 있고 같은 batch에서 control을 frozen으로 만든다. 이어 같은 할당
refresh로 활성화한다. 기존 blob의 미확인 writer를 stopped로 추정하지 않는다.

전체 월의 물리 용량/IO 비용을 보수적으로 예약하되 실행 허가는 가장 짧은 가격·재원·할당
근거의 만료까지만 유효하다. 월말까지의 잔액 유효기간을 만들어 내지 않는다. 재개 뒤에도
projection이 없거나 새 요청의 전체 상한이 보장되지 않으면 PUT은 계속 거부한다.

## 검증과 남은 실제 인수

합성 원장·업로드 hold·running lease·만료된 allocation·최신 재원 중단/만료·동시 갱신·
응답 유실·마지막 SQL 실패 rollback·월 경계 replay를 검사한다. Native D1에서 갱신과
0011 DDL/trigger/schema marker/마이그레이션 원장의 실패 rollback을 확인한다.
0010은 수정하지 않는다. 100/10,000 물리 원장의 hot admission은 read13, binding read30/write13
으로 유지된다. 고객 원본의 로컬 signed upload는 read471/write71, 76 SQL이며 실제 청구 증거가 아니다.

변호사 원본 PUT과 승인된 공개 복사도 인증부터 원장 통지까지 별도 실행 상한을 사용한다.
원본은 암호문 최대 크기, 공개 복사는 원본 GET과 목적 PUT을 함께 예약한다. 용량 예약과
유료 호출 예약은 pending 생성과 동일 batch이며, 정확한 writer token·응답 크기·stream 종료를
확인한 뒤 writer를 stopped로 기록한다. 늦거나 응답이 없는 PUT은 running/미정산으로 보존한다.
실패 시 normal 작업이 소진할 수 없는 cleanup 24문장과 원장 통지 10문장을 사용한다.
공급자 사용량 증거가 없는 성공 응답도 실제 비용 0원이나 정산 완료로 바꾸지 않는다.

0013은 공개 복사 source, reservation blob, entity history와 approved revision 조회 index만
추가한다. Native D1 합성 검증에서 인증을 포함한 변호사 원본은 83 SQL/read470/write76,
공개 복사는 이력 100개와 10,000개 모두 95 SQL/read608/write79였다. 단일 실행 예약은
Worker 1회/CPU 300,000ms, D1 read 1,010,000/write6,000 및 해당 R2 호출을 포함한다.
0013의 실패 batch는 index와 schema marker를 함께 rollback한다.

최신 실제 재원·가격·inventory 입력, 최종 후보 전체 회귀, 같은 SHA 배포 및 실제 제한 smoke,
원래 호출의 공급자 청구 대조는 #19/#57/#58/#71에 남긴다. 구현 병합으로 #57이나 #71을 닫지 않는다.
