# 사건 AI의 외부 조회 도구

2026-10-24 직접 사용자 요청 / [#458](https://github.com/creno-va/baro/issues/458).
기존 법률 원문 검색은 `legal-retrieval`의 등록된 법령·판례·기관 안내 경로를 유지한다.
새 조회 어댑터는 `external-tools`에 있으며 AI 모델 호출은 계속 `llm-gateway`만 소유한다.

## 현재 계약과 발급 상태

사용자는 아래4개 서비스의 API가 아직 발급되지 않았다고 확인했다. 어댑터·대역 검증은
실제 발급·제휴·외부 조회 성공이 아니다. 미설정은 `not_configured`, 입력/수신자 동의
미확인은 `input_required`로 남기며 기능 전체나 다른 법률·자료 정리를 막지 않는다.

| 도구 | 공개 문서로 확인한 범위 | 남은 외부 입력 |
| --- | --- | --- |
| 홈택스/국세청 | [사업자 상태 서비스](https://www.data.go.kr/data/15081808/openapi.do), [공식 Swagger](https://infuser.odcloud.kr/api/stages/28493/api-docs?1728017570963). POST `/api/nts-businessman/v1/status`, 요청 번호와 응답 번호 일치 검사 | 활용 신청·운영 인증키. 개인의 납세·체납/세무 서류 조회는 이 계약에 포함하지 않음 |
| 더치트 | [공통 인증·복호화](https://apidocs.thecheat.co.kr/docs/api-usage/api-common/), [피해 등록 조회](https://apidocs.thecheat.co.kr/docs/api-usage/api-search-plain/). X-TheCheat-ApiKey, AES256-CBC, keyword/type/은행코드·기간 일치 검사 | API/ENC 키·제휴·허용 IP. `success (test)`는 실제 등록 여부로 표시하지 않음 |
| 등기정보광장 | [서비스별 신청 안내](https://data.iros.go.kr/rp/oa/openOapiIntro.do). 별도 회원/서비스별 인증과 승인 명세 필요 | 발급 대상 서비스의 정확한 endpoint·요청/응답 계약·인증키. 주소/소유권/등본 API로 임의 대체하지 않음 |
| 데이터허브 | [공통 인증·production 도메인](https://dataapi.co.kr/dLab/mdh_api.do), [부동산 사전주소](https://dataapi.co.kr/upload/dLab/20260831-151849-35382.html), [건축물 총괄표제부](https://dataapi.co.kr/upload/dLab/20231102-132305-87364.html) | 승인 Token·상품 사용 권한·실제 응답 인수. 공개 가이드의2022/2025 개정일은 그대로 보존 |

데이터허브 사전주소의 소유자명/소유자주소 필드는 반환·모델 전달 대상에서 제외하고
후보 고유번호·현행/폐쇄만 표시한다. 후보 검색은 등기부등본이나 소유권 증명이 아니다.
건축물은 주소 검색에서 확인한 INNB/RNMGTSN/BULDMNNM/BULDSLNO를 사용한다.
그 값을 AI가 주소에서 만들어 내거나 사전주소 API의 ESTATENUM과 혼동해서는 안 된다.

## 실행·정보 경계

`LookupAccess`는 신뢰된 서버의 사건 소유권·revision·현재 동의와 구체 조회 대상/수신자의
전송 동의를 검사하는 closure다. 모델/HTTP body의 boolean으로 권한을 만들 수 없다.
실제 HTTP 직전에는 durable per-job reserve를 요구하고 결과 표시 직전에도 권한을
확인한다. 예약이 없거나 불명확하면 실행하지 않는다. 동시 실행에도 harness당 최대2회,
HTTP20초·응답256KiB이며 자동 retry·redirect·임의 URL·개발 서버 fallback은 없다.
취소/삭제·권한 변경은 결과를 숨기며 앞선 실행 기록을 지우지 않는다.

모델은 등록된 tool ID와 서버가 승인한 opaque target만 선택한다. 인증키, 연락처/계좌,
원천 callback·세무 인증·개인 식별자는 tool schema에 넣지 않는다. 가입·결제·제휴 수락,
개인 인증을 어댑터가 대신하지 않는다. 실제 대상 입력/동의·durable reservation producer와
채팅 소비 연결은 별도 인수이며 standalone adapter만으로 운영 연결 완료를 표시하지 않는다.

## 결과와 이전 앱

새 `v2ToolResultSchema`는 도구·상태·고정 출처 URL·실제 관측 시각·허용 표시행·주의점을
가진다. API 설정이 없으면 시각을 만들지 않고, 오류를 조회 성공/기록 없음으로 바꾸지
않는다. 더치트 테스트 결과와 실제 결과는 구분하며 owner/인증 query deep link는 반환하지
않는다. 비용/가격 미관측은 실행 실패로 전파하지 않는다.

기존 strict assistant message DTO에는 아직 필드를 추가하지 않았다. 후속 producer는
기존 응답 shape를 보존하고 opt-in endpoint로 결과를 제공해야 한다. 모바일 채팅과
이 범위를 조율했으며 앱/package 소비 변경은 별도 통합한다.
