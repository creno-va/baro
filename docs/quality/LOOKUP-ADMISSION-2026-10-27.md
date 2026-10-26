# 외부 조회 대상·동의와 실행 기록 선행

- Tracking: [#539](https://github.com/creno-va/baro/issues/539), 소비 작업 [#458](https://github.com/creno-va/baro/issues/458).
- Base: main76b1dfb 뒤 Windows 검사 선행 PR541/mainf67d2af를 통합했다. Migration0018은 #539가 단독 순차 소유한다.
- Status: 선행 PR542/head8652167 CI40368233948 SUCCESS → main249b957 정상 통합. 배포·실제 공급자 인수는 별도다.

기존 외부 조회는 사용자가 명시 입력한 대상과 수신 서비스 전송 동의 없이 실행하지
않는다. 새 선택적 `lookupRequests`는 도구별 대상과 고정 수신자·동의 버전을 검증하고
서로 다른 도구 최대2개만 허용한다. 등기정보광장은 아직 서비스별 승인 명세가 없어
실행 가능한 입력 계약을 만들지 않는다. 미발급 상태는 기존 not_configured로 보존한다.

대상은 기존 AES 암호화 private user-message에만 저장한다. 모델 context 및 기존
strict public 메시지 DTO에서 이 확장을 제거한다. operation의 원래 request hash,
정확한 암호문, owner/customer/현재 동의·workspace revision·tombstone·job/lease/fencing을
대조한 원자 INSERT만 실행 permit을 발급한다. JSON의 transmit=true는 단독 권한이 아니다.

0018의 비식별 journal은 operation/tool마다 단 한 번의 dispatch 사실을 보존한다.
새 lease·서버 재시작·job 재시도도 unknown을 초기화하거나 같은 operation의 HTTP를
중복 실행할 수 없다. 계정/사건 삭제가 실제 실행 사실을 지우지 않도록 source FK를
두지 않는다. target·credential·응답 본문은 이 journal에 저장하지 않는다. 실제 늦은
transport 응답은 삭제/권한 철회 후에도 원래 closure-issued permit으로 기록할 수
있으나 새 조회 권한을 주지 않는다. 최종 transport와 dispatch binding은 불변이다.

## 검증 범위

실제 SQLite·AES 합성 fixture로 명시 동의/수신자/버전, 공개 DTO의 대상 제거,
동시 claim·재생성/새 lease·unknown 보존, 원래 request hash 불일치, 복호화 사이의
역할/동의/삭제/revision/lease 변경, permit 위조, 실제 account cascade 이후 늦은
receipt·불변/삭제 금지 trigger를 검증한다. 기존 외부 도구·private 결과 endpoint와
preview fixture의 회귀도 함께 실행한다. 새 schema의 fresh/upgrade/drift와 Workers
build를 검증한 정확한 PR head의 CI 결과는 #539에 기록한다.

최종 로컬 관련7파일95개/604 assertions 및 새 admission10개가 통과했다. Bun1.4.0 frozen
설치·validate:quick(공통/mobile525·RN108·최종601성공/기존host전용2제외), DB drift 및
실제 local D1/원자 import·재실행 no-op, production build/bundle/dry-run/local built workerd가
통과했다. 검사 중 발견한 Windows 도구/fixture 문제는 별도 PR541에서 정확 CI 성공 뒤
mainf67d2af에 정상 병합했으며 #539 제품 변경과 분리했다.

이 선행만으로 runtime의 외부 HTTP를 활성화하거나 새 UI를 노출하지 않는다. 기존
어댑터의 실행 연결·HTTP transport 관측과 명시 입력/동의 UI는 선행 정상 병합 뒤
#458에서 소비한다. 사용자가 2026-10-27에 모두 미발급임을 재확인한 홈택스·더치트·
등기정보광장·DataHub의 실제 요청·성공, 기존 unknown 모델 호출의 해결, 보안 full
성공이나 production/전체 MVP 완료를 뜻하지 않는다. 기존 비용 관측 전용·AI200/일·
보안/삭제/권한·기술 상한과 랜딩·네이티브 앱을 보존한다.

같은 날 사용자 후속 지시로 외부 API의 미발급 설정·실제 검증은 이번 완료 범위에서
제외하고 비워둔다. 실제 성공을 표시하지 않으며 발급 후 검증 항목을 남겨 추적 이슈를
정리할 수 있다. 이것은 기존 권한/전송 동의/보안 검사 또는 unknown 실행을 지우는
승인이 아니다. 실제 설정이 없는 도구는 계속 not_configured다.

## #458 실행·웹 입력 연결

선행 통합 후 `codex/458-explicit-lookup`에서 기존 runtime의 null-target/예약 거절
stub를 제거하고 새 permit에 연결한다. 모델에는 도구 ID와 실제 상태만 전달하며,
대상·동의 원문은 모델 context와 공개 메시지에서 제거한다. 명시적 조회 요청은 초기
모델 admission을 바꾸지 않고 첫 draft 뒤 실행해, 모델이 도구 선택을 생략해도 최종
답변 전에 해당 도구를 확인한다. 도구 수 최대2와 최종 독립 감사는 유지한다.

실행 직전 fresh 권한 검사를 추가하며, 전송 전 철회는 not_sent, 실제 HTTP 응답은
response/provider_error, 네트워크 미확정은 unknown으로 관측한다. 응답 중 철회 시
transport 사실은 보존하되 결과를 공개하지 않는다. 같은 operation/tool의 재호출은
새 runtime/lease에서도 금지한다. 관측 DB 장애로 unknown이 남아도 실행 예약을 지우거나
재전송하지 않는다.

owner/현재 고객 동의를 확인하는 private/no-store catalog endpoint는 credential을
반환하지 않는다. 서버가 설정 유무 boolean만 웹에 전달하며 실제 설정이 있는 경우에만
조회 버튼을 노출한다. API가 모두 미발급인 현 환경의 설정은 비워둔다. 명시적 mock
환경은 합성 UI 검증만을 위한 예외이며 실제 서비스 응답을 대체하지 않는다.

입력창은 도구별 대상·수신 서비스·전송 내용을 표시하고 별도 동의를 요구한다. 대상이
바뀌면 동의를 해제하고, 닫기/계정 변경 시 입력을 버린다. 대상은 채팅 문장·브라우저
지속 저장소에 넣지 않는다. 접수 ACK가 불명확하면 원래 body/멱등 key로 확인하며 HTTP를
자동 재시도하지 않는다. 합성 mock의 receipt key도 요청 원문 대신 해시를 사용한다.

발급 후 실제 검증 항목은 아래와 같다. 이번 개발 완료/이슈 정리는 이 항목의 성공을
의미하지 않으며, #71의 실제 외부 인수와 별도로 보존한다.

- 홈택스: 발급 key·실제 business number에 대한 상태/미존재·인증 오류와 응답 범위.
- 더치트: 승인 계정·32-byte 복호화 key, 실제/테스트 응답 구분과 대상/제공 기간 대조.
- 등기정보광장: 승인된 서비스별 API 명세부터 확정한 후 대상·동의·adapter 계약 추가.
- DataHub: 승인 token, 주소 후보·공식 식별자 기반 건축물 총괄표제부 응답과 접근 거절.
- 배포 시0018 migration과 동일 SHA 검증을 먼저 적용하고, 최소 합성 실제 smoke만 수행.
  실제 키·계좌·전화·주소·원문 응답은 이슈/로그/공개 artifact에 기록하지 않는다.

로컬 집중 검증은4파일71개/389 assertions가 성공했다. 정상 dispatch/unknown 재생성/
미설정·대상 누락·불일치/전송 직전·중간 철회/관측 DB 장애·중복 차단, catalog의
세션·소유권·동의, 원래 body/멱등 key의 ACK 복구와 public/mock 지속 저장에서 target
제거를 검증했다. 390px 실제 브라우저에서 입력 변경 동의 해제·닫기 초기화·focus 복귀·
동일 요청 재확인·미설정 상태의 새2개 시나리오가 통과했으며 실제 PNG도 확인했다.
최종 전체 작업공간 회귀 결과와 exact CI는 PR에 이어 기록한다.

Bun1.4.0 frozen·validate:quick(공통/mobile525·RN108·마지막601성공/기존host전용2제외)와
production build/bundle/dry-run/local built workerd가 통과했다. Windows의 과거 built
runtime 검사 wrapper가 종료된 뒤 Node/workerd 자식을 남겨 dist/client를 잠그는 문제도
확인했다. 해당 검사 PID 트리만 정리하고 검사 종료를 Windows의 child-tree 정리로
보완했다. 이후 build와 로컬 login200, 자식 프로세스가 남지 않음을 확인했다.

이 작업에서 실제 외부 조회·모델 호출·새 preview/production 배포는 수행하지 않았다.
최종 SHA full의 원본 보안 audit·실제 외부 검증과 #71 최종 인수는 별도다.
