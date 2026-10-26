# 외부 조회 대상·동의와 실행 기록 선행

- Tracking: [#539](https://github.com/creno-va/baro/issues/539), 소비 작업 [#458](https://github.com/creno-va/baro/issues/458).
- Base: main76b1dfb 뒤 Windows 검사 선행 PR541/mainf67d2af를 통합했다. Migration0018은 #539가 단독 순차 소유한다.
- Status: 로컬 선행 검증 완료, 정확 PR/CI/main 통합 대기. 배포·실제 공급자 인수는 별도다.

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
