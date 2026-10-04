# 제품 분석 이벤트 명세

## 원칙

제품 분석은 사건 내용을 수집하지 않는다. 이벤트에는 사용자 서술, 질문·답변, 법률
검색어, 사건 제목, 결과 문장, 이메일, OAuth ID, IP를 넣지 않는다. 분석용 익명 ID는
인증/DB ID와 분리하고 삭제 또는 opt-out 정책을 공개 정책과 일치시킨다.

## 공통 속성

허용: `eventVersion`, `occurredAt`, `environment`, `release`, `anonymousUserId`,
`sessionId`, `caseIdHash`, `analysisIdHash`, `entryPoint`, `deviceClass`, `resultStatus`,
`questionCount`, `citationCount`, `durationBucket`, `errorCategory`.

ID hash는 분석 환경 전용 salt를 사용한다. 자유 문자열 속성은 금지하고 enum/수치 범위를
schema로 제한한다.

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
| `result_viewed` | 완료 결과의 50% 이상 영역 표시 | `citationCount` |
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
- 분석 완료율 = distinct 완료 analysis / distinct 제출 analysis
- 행동 전환율 = 결과 열람 analysis 중 `evidence_checked` 또는 `citation_opened`가 있는 비율
- 신뢰 응답률 = `helpful=yes` / 모든 `trust_answered`
- 완료 시간 = 동일 analysis의 `case_submitted`부터 `result_viewed`까지, 중도 질문 대기 포함

봇·내부 QA·local/preview를 production 지표에서 제외한다. 하나의 멱등 이벤트 ID로 중복을
제거하고, 분모·기간·결측을 대시보드에 함께 표시한다.

## 변경 관리

이벤트 속성 추가는 allowlist schema와 개인정보 검토를 요구한다. 의미 변경은 기존
이벤트를 덮어쓰지 않고 `eventVersion`을 올린다. 자유 텍스트가 필요한 피드백 기능은
별도 PRD와 보안·보존 정책 없이는 추가하지 않는다.
