# 사건 AI의 외부 조회 도구

2026-10-24 직접 사용자 요청 / [#458](https://github.com/creno-va/baro/issues/458).
기존 법률 원문 검색은 `legal-retrieval`의 등록된 법령·판례·기관 안내 경로를 유지한다.
새 조회 어댑터는 `external-tools`에 있으며 AI 모델 호출은 계속 `llm-gateway`만 소유한다.

## 현재 계약과 발급 상태

2026-10-27 최신 사용자 지시: **이 툴콜링 파트는 API 키 준비 전 보류한다.**
등기정보광장의 미구현 placeholder/통계 연동 제외(#555)는 유지하되, 원래 의도인
전세사기 관련 개별 건물 등기부 자동 확보는 미구현 잔여로 보존한다. 이 목적 자체를
불필요하다고 했던 판단은 정정한다. 현재 DataHub 사전주소·건축물대장 조회 코드만으로
등기부 원문을 확보하지는 못한다. 공식
[고유번호로 PDF열람(선불결제전용)](https://dataapi.co.kr/upload/dLab/20260831-151849-54674.html)의
RealEstateUniqNumPdfPrepaid와 원천 계정/암호화 비밀번호·선불결제 카드 계약, 정확한
대상 선택·PDF 자료 처리 연결은 미구현이다. 건축물 주소 식별자 취득도 별도다.
키·상품 권한·계정/결제 조건이 준비된 뒤 사용자 지시로 재개하며 실제 키/계좌/원문은
공개 기록에 남기지 않는다. [종료·보류 인계](../quality/MAINTENANCE-HANDOFF-2026-10-27.md)를 따른다.

registry는 이름·미연결 상태 처리만 있던 placeholder였으며 실제 HTTP adapter나
인증키 설정은 없었다. 신규 runtime/model/private catalog에서는 제외하고 과거 ID·
암호화 결과 읽기와 HTTP를 보내지 않는 not_configured 처리는 호환 보존한다.
수동 tools_registry 하네스는 이 과거 미연결 결과만 검사하며 현행 기능 인수가 아니다.
제외는 구현·발급·실제 외부 검증 성공을 뜻하지 않는다.

사용자는 국세청·더치트·DataHub의 API가 아직 발급되지 않았다고 확인했다. 어댑터·대역
검증은 실제 발급·제휴·외부 조회 성공이 아니다. 미설정은 not_configured, 입력/수신자
동의 미확인은 input_required로 남기며 다른 법률·자료 정리를 막지 않는다.
사용자는 개인사업자가 있으며 실제 발급 절차는 대표자에게 요청한다고 밝혔다.
운영 계정의 가입·약관 동의·상품 계약·키 설정 완료는 확인되지 않았다.
가입 정보·사업자 정보·약관 동의·상품 승인을 임의 생성하지 않는다.

| 도구 | 공개 문서로 확인한 범위 | 남은 외부 입력 |
| --- | --- | --- |
| 홈택스/국세청 | [사업자 상태 서비스](https://www.data.go.kr/data/15081808/openapi.do), [공식 Swagger](https://infuser.odcloud.kr/api/stages/28493/api-docs?1728017570963). POST `/api/nts-businessman/v1/status`, 요청 번호와 응답 번호 일치 검사 | 활용 신청·운영 인증키. 개인의 납세·체납/세무 서류 조회는 이 계약에 포함하지 않음 |
| 더치트 | [공통 인증·복호화](https://apidocs.thecheat.co.kr/docs/api-usage/api-common/), [피해 등록 조회](https://apidocs.thecheat.co.kr/docs/api-usage/api-search-plain/), [공식 준비사항](https://apidocs.thecheat.co.kr/docs/api-prerequisite/). X-TheCheat-ApiKey, AES256-CBC, keyword/type/은행코드·기간 일치 검사 | 기업 회원·사업자등록증·앱 등록 후 API/ENC 키. `success (test)`는 실제 등록 여부로 표시하지 않음. 추가 네트워크 정책은 실제 발급 계약에서 확인하며 임의 필수 조건으로 만들지 않음 |
| 데이터허브 | [공통 인증·production 도메인](https://dataapi.co.kr/dLab/mdh_api.do), [부동산 사전주소](https://dataapi.co.kr/upload/dLab/20260831-151849-35382.html), [건축물 총괄표제부](https://dataapi.co.kr/upload/dLab/20231102-132305-87364.html) | 승인 Token·상품 사용 권한·실제 응답 인수. 공개 가이드의2022/2025 개정일은 그대로 보존 |

데이터허브 사전주소의 소유자명/소유자주소 필드는 반환·모델 전달 대상에서 제외하고
후보 고유번호·현행/폐쇄만 표시한다. 후보 검색은 등기부등본이나 소유권 증명이 아니다.
건축물은 주소 검색에서 확인한 INNB/RNMGTSN/BULDMNNM/BULDSLNO를 사용한다.
그 값을 AI가 주소에서 만들어 내거나 사전주소 API의 ESTATENUM과 혼동해서는 안 된다.
2026-10-24 공개 [가이드 검색](https://dataapi.co.kr/dLab/mdh_guide.do)에서 주소 검색은
위 사전주소 가이드를 반환했지만 건축 검색 결과는 없었다. 이는 서비스 종료 증거가
아니다. 기존 건축물 가이드의 필수 식별자를 제공하는 현행 주소 검색 상품·endpoint와
건축물 상품 사용 가능 여부를 발급 과정에서 확인해야 하며 endpoint를 추측하지 않는다.

발급 준비 순서는 운영 주체/계정 확정, 위 공식 경로의 서비스 신청, 승인된 계약의
endpoint·필드·인증 방식 확인, 기존 Cloudflare secret 이름으로 안전하게 설정,
명시적 대상/수신자 동의와 durable producer 연결, 합성/승인된 대상의 제한 실제 인수다.
국세청 사업자 상태 API 신청을 개인 홈택스 세무 조회 승인으로 표현하지 않는다.
계정 생성의 약관 수락과 결제·상품 계약은 실제 해당 단계에서 사용자가 처리해야 한다.

## 실행·정보 경계

`LookupAccess`는 신뢰된 서버의 사건 소유권·revision·현재 동의와 구체 조회 대상/수신자의
전송 동의를 검사하는 closure다. 모델/HTTP body의 boolean으로 권한을 만들 수 없다.
실제 HTTP 직전에는 durable per-job reserve를 요구하고 결과 표시 직전에도 권한을
확인한다. 예약이 없거나 불명확하면 실행하지 않는다. 동시 실행에도 harness당 최대2회,
HTTP20초·응답256KiB이며 자동 retry·redirect·임의 URL·개발 서버 fallback은 없다.
취소/삭제·권한 변경은 결과를 숨기며 앞선 실행 기록을 지우지 않는다.

모델은 등록된 tool ID와 서버가 승인한 opaque target만 선택한다. 인증키, 연락처/계좌,
원천 callback·세무 인증·개인 식별자는 tool schema에 넣지 않는다. 가입·결제·제휴 수락,
개인 인증을 어댑터가 대신하지 않는다. PR542/PR543으로 명시 대상 입력·전송 동의,
durable reservation producer와 채팅 소비를 연결했다. 이 소스 통합과 합성 검증은
운영 키 발급·상품 권한·실제 공급자 응답·동일 SHA 배포 인수를 대신하지 않는다.

## 결과와 이전 앱

새 `v2ToolResultSchema`는 도구·상태·고정 출처 URL·실제 관측 시각·허용 표시행·주의점을
가진다. API 설정이 없으면 시각을 만들지 않고, 오류를 조회 성공/기록 없음으로 바꾸지
않는다. 더치트 테스트 결과와 실제 결과는 구분하며 owner/인증 query deep link는 반환하지
않는다. 비용/가격 미관측은 실행 실패로 전파하지 않는다.

기존 strict assistant message DTO의 shape를 보존하고 별도 opt-in endpoint로 결과를
제공한다. 이번 명시 입력 UI와 runtime 연결은 웹 기준이며 앱/package 소비 변경과
실제 네이티브 외부 조회 인수는 별도다.

## 채팅 연결

채팅 planner는 최대2개의 중복 없는 등록 ID만 요청하고 서버 결과를 받은 뒤 한 번
재생성·독립 감사한다. 결과는 validated 메시지와 같은 암호화 payload에 원자적으로
저장하며 기본 메시지 projection에서는 제거한다. 별도 소유권 검사의
`GET /api/v2/cases/:id/messages/:messageId/tool-results`로만 읽는다. 이전 payload는
빈 결과로 읽힌다. 웹 카드에서는 상태·관측 시각·고정 출처·주의점을 구분한다.

설정 이름은 `HOMETAX_SERVICE_KEY`, `THECHEAT_API_KEY`,
`THECHEAT_ENCRYPTION_KEY`, `DATAHUB_API_TOKEN`이다. 값은 현재 미발급이며
이름 선언은 secret 설정이나 검증을 의미하지 않는다. 현재 웹은 설정된 도구에 한해
대상·수신자 동의를 입력받고 runtime은 암호화된 원래 요청과 durable permit을 대조한다.
키·명시 대상·동의·유효 permit이 없으면 실제 HTTP를 보내지 않는다. DataHub 건축물은
식별자4개를 직접 입력하는 경로이며 주소에서 자동 취득하는 상품 연결은 미구현이다.
