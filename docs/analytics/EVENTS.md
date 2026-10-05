# 제품 분석 이벤트 명세

## 원칙

제품 분석은 사건 내용을 수집하지 않는다. 이벤트에는 사용자 서술, 질문·답변, 법률
검색어, 사건 제목, 결과 문장, 이메일, OAuth ID, IP를 넣지 않는다. 분석용 익명 ID는
인증/DB ID와 분리하고 삭제 또는 opt-out 정책을 공개 정책과 일치시킨다.
P0 수집 구현은 #30이 소유한다. 비필수 analytics는 명시적 opt-in 전 쿠키·네트워크를
생성하지 않는다. 거부해도 사건 기능은 동작한다. 필수 운영 지표와 선택 제품 분석의
동의 구조는 #20에서 검토한다. dashboard 지표는 수집 완료를 주장하지 않는 목표다.

## 공통 속성

허용: `eventId`, `flowId`, `eventVersion`, `occurredAt`, `environment`, `release`, `anonymousUserId`,
`sessionId`, `caseIdHash`, `analysisIdHash`, `entryPoint`, `deviceClass`, `resultStatus`,
`questionCount`, `citationCount`, `durationBucket`, `errorCategory`.

ID hash는 분석 환경 전용 salt를 사용한다. 자유 문자열 속성은 금지하고 enum/수치 범위를
schema로 제한한다.
flowId는 입력 화면 시작 때 생성한 임의 ID이며 제출과 결과에서 이어 사용한다. 원래
DB ID를 노출하지 않는다. anonymousUserId/hash도 가명정보이며 완전한 익명성을 주장하지
않는다. opt-in한 cohort만 지표에 포함하며 eventId unique로 중복을 제거한다.

## 이벤트

| 이벤트 | 발생 시점 | 추가 허용 속성 |
| --- | --- | --- |
| `case_input_viewed` | 새 사건 화면 실제 표시 | `entryPoint` |
| `case_submitted` | 서버가 사건 생성 승인 | `narrativeLengthBucket` |
| `clarification_viewed` | 질문 화면 표시 | `questionCount` |
| `clarification_completed` | 유효 답변 이벤트 승인 | `questionCount`, `unknownCount` |
| `analysis_started` | Workflow 시작 | 없음 |
| `analysis_completed` | 검증 결과 저장 완료 | `durationBucket`, `citationCount`, `questionCount` |
| `analysis_failed` | 종료 실패 | `errorCategory`, `retryable` |
| `result_viewed` | 결과 요약 영역의 50% 이상을1초 표시, analysis당1회 | `citationCount` |
| `evidence_checked` | 체크리스트 상태 변경 | `itemIndex`, `checked` |
| `citation_opened` | 공식 링크 선택 | `sourceType`, `itemIndex` |
| `case_revisited` | 생성일 다음 세션에 결과 재열람 | `daysSinceCreationBucket` |
| `trust_answered` | 도움 여부 선택 | `helpful`: yes/no |
| `case_deleted` | 서버 삭제 완료 | 없음 |
| `account_deleted` | 계정 삭제 요청 승인 전 마지막 client event | 없음 |

`account_deleted` 이후 server가 사용자 연결 이벤트를 보내지 않는다. 실패 상세는 제품
분석이 아니라 비민감 운영 지표로 보낸다.

## 지표 계산

- 입력 활성화율 = distinct `case_submitted` 사용자 / distinct `case_input_viewed` 사용자
- 분석 완료율 = distinct result_viewed analysis / distinct 제출 analysis (AI 완료율은 별도 운영 지표)
- 행동 전환율 = 결과 열람 analysis 중 `evidence_checked` 또는 `citation_opened`가 있는 비율
- 신뢰 응답률 = `helpful=yes` / 모든 `trust_answered`
- 완료 시간 = 동일 flowId의 첫 `case_input_viewed`부터 `result_viewed`까지, 입력·질문 대기 포함
  (durationBucket 경계는 1분/3분/5분/10분/이상이며 p75는 event 시각 차이로 계산)

봇·내부 QA·local/preview를 production 지표에서 제외한다. 하나의 멱등 이벤트 ID로 중복을
제거하고, 분모·기간·결측을 대시보드에 함께 표시한다.

## 변경 관리

이벤트 속성 추가는 allowlist schema와 개인정보 검토를 요구한다. 의미 변경은 기존
이벤트를 덮어쓰지 않고 `eventVersion`을 올린다. 자유 텍스트가 필요한 피드백 기능은
별도 PRD와 보안·보존 정책 없이는 추가하지 않는다.

## P0.2 구현 경계와 증거

엄격한 `src/contracts/analytics.ts` allowlist와 주입식 SDK를 구현한다. 테스트는
`tests/adapters/analytics.ts` synthetic sink를 사용한다. 제품에는 외부 수집 endpoint나
새 공급자를 추가하지 않으며 명시적 opt-in 후 실제 비민감 이벤트만 해당 탭의
sessionStorage에 보관하는 bounded adapter(최대500 event)를 사용한다. 동의 철회는
event/ID/salt/flow mapping을 모두 삭제한다. 입력·답변·결과·인증 ID는 저장하지 않는다.
analytics 전용 환경별 random salt로 case/analysis ID를 HMAC-SHA256 처리한다.
가명정보이며 완전한 익명성을 주장하지 않는다.

flowId와 admission의 논리적 analysis hash는 답변 revision의 새 DB analysis ID에서도
이어 사용해 제출 분모와 결과 numerator가 어긋나지 않는다. 새로고침에서 eventId 및
analysis당 view 중복을 제거한다. 시작·완료 이벤트는 API의 실제 Workflow 시작/terminal
commit timestamp를 사용하고 view timestamp는 실제50%/연속1초 관찰 시각이다.
완료 시간은 같은 flow의 최초 input view와 result view의 개별 차이를 구한 뒤 p75를
계산한다. 서로 다른 시각의 percentile을 빼지 않는다. local/preview와 명시된 QA/bot
cohort는 production 집계에서 제외한다. 수집 불가/분모 없음/대응 시작 시각 없음은
unknown(null)이며 aggregate에는 개별 ID/hash가 없다.

도움 여부 선택 자체가 독립적인 선택 피드백 요청이다. `{helpful:boolean}`만 owner-gated
PUT으로 D1에 upsert하며 사건/분석 삭제 때 cascade한다. 지표 거부와 분석 기능은
독립적이다. account_deleted SDK 계약은 준비됐지만 계정 삭제 화면/서버 연결은 #17이다.
외부 production cohort 수집을 완료했다고 주장하지 않는다. 공개 목적/보존/쿠키 고지의
승인은 #20에서 확인하며 이 문서가 법률 승인이나 새 공급자 도입 승인을 대신하지 않는다.

## v2 이벤트와 사업 목표의 구분

핵심 목표는 변호사 탐색/직접 연락과 사건 준비·인계다. 연락 클릭은 상담 성사·계약·수임·
법적 효과를 증명하지 않는다. 매출·중개 수수료·유료 순위 모델은 미정이며 지표로 허위
전환/수수료 수입을 생성하지 않는다. 기존 v1 eventVersion을 보존하고 v2 이벤트는 별도
strict schema/version으로 추가한다. 수집 opt-in·bounded session storage·opt-out 삭제를
유지하고 새 외부 수집 공급자를 이 변경만으로 도입하지 않는다.

| v2 목표 이벤트 | 발생 증거 | 허용된 추가 값 |
| --- | --- | --- |
| `directory_viewed` | 목록 실제 표시 | filterUsed:boolean, resultCountBucket; 분야/지역/검색어 원문 없음 |
| `lawyer_profile_viewed` | 승인 프로필 실제 표시 | entryPoint enum; 이름/사무실/공개 lawyer ID 없음 |
| `lawyer_contact_clicked` | 사용자가 외부 연락 수단 선택 | channel:phone/email/consult_link; URL·주소·사건 연결 ID 없음 |
| `intake_batch_completed` | 서버 답변 묶음 저장/advance 승인 | batchIndex, questionCount, unknownCount, skippedCount |
| `summary_confirmed` | 최신 summary revision 확인 저장 | bounded revision, intakeDurationBucket |
| `chat_response_viewed` | 검증된 응답 실제 표시 | bounded response ordinal, citationCount; message내용 없음 |
| `material_processed` | job 검증 terminal | fileKind enum, coverageBucket, durationBucket; 파일명/hash/원문 없음 |
| `action_updated` | owner가 상태 변경 저장 | actionKind/status enum; 행동 label·source position 없음 |
| `report_export_requested` | 고정 snapshot/선택 확인 후 admission | format enum, selectedCount, maskingUsed:boolean |
| `report_downloaded` | 권한 검증된 파일 transfer 완료 관측 | format enum; 내용/이름/원본object key/외부수신처 없음 |
| `profile_submitted` | 자신의 revision 심사 admission | revisionCountBucket; 자격서류·변호사명 없음 |
| `profile_review_completed` | 승인/반려 transaction 완료 | decision enum, queueDurationBucket; reason 자유문구 없음 |

directory/profile/contact 이벤트를 사건 hash/세션 사실과 연결해 AI 맞춤 순위나 광고 targeting에
사용하지 않는다. 필요한 event/flow ID는 analytics 전용이며 직접 account/lawyer/case identity를
전송하지 않는다. 외부 연락 링크에 analytics tag와 사건 내용 query를 붙이지 않는다.
공개 프로필 내용도 analytics payload에 복사하지 않는다.

intake 활성화율은 distinct confirmed summary / distinct admitted v2 intake이고, 준비 인계율은
distinct report download / distinct confirmed workspace다. directory→profile→contact click은
opt-in cohort의 별도 funnel이며 실제 상담 전환율이 아니다. 원본 download 200만으로 사용자
전달 완료를 추정하지 않는다. intake 지표·반복 채팅·report 생성 시간은 operation별 start/end
동일 짝으로 계산하고 v1 단일 analysis denominator와 혼합하지 않는다. sample 부족/수집 거절/
짝 누락은 null이며 preview/test 데이터는 production 지표에서 제외한다.

정확한 quota/cost/삭제 관측은 선택 analytics가 아닌 제한된 운영 ledger다. 운영 데이터에
서술·채팅·파일명·report본문·full URL·cookie를 넣지 않고 공개 정책의 목적/기간을 맞춘다.
event schema·dedup·opt-out·샘플지표는 [시연 증거](../quality/V2-UI-EVIDENCE.md)와 별도
개인정보 검토를 통과해야 하며 목표 이벤트 table은 수집 구현 완료 증거가 아니다.
