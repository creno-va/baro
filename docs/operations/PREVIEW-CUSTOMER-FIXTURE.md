# Preview 합성 고객 사건 준비

이 수동 도구는 사전에 지정된 합성 프로필의 현재 소유자에게 고정된 합성 intake 한 건만
준비한다. 일반 사건 생성 UI, Turnstile, OAuth 또는 외부 연동의 성공 증거가 아니다.
실제 사건과 구별되는 명시적 합성 문장을 저장하며 다른 고객 자료는 조회·수정하지 않는다.

`Prepare one preview customer fixture (manual)` workflow는 허용 운영자의 main 실행만
허용한다. `target_sha`는 workflow checkout, 현재 main, 성공한 main CI, 실제 preview의
live/ready SHA와 같아야 한다. preview Environment의 기존 암호화 키와 D1 권한을 마지막
step에만 제공한다. production 대상, 임의 owner·SQL·본문·fixture key 입력은 없다.

`status`는 읽기 전용이다. `create`는 exact profile ID의 현재 draft 한 건만 복호화하여
지정된 이름·사무실 marker를 대조한다. 고객 역할·현재 필수 동의·삭제 여부와 일일 사건
3건 한도를 확인한다. profile/revision/ciphertext, 고객 역할, 현재 동의는 canonical
생성 claim에서 다시 검사한다. 인증·세션·역할·동의·Turnstile 설정은 쓰지 않는다.

HTTP 생성 API는 기존 Turnstile 및 abuse 검사를 계속 사용한다. 내부 저장 함수의
business payload를 재사용하므로 가짜 토큰을 만들지 않는다. 암호화 AAD, 원자 생성
batch, new_case operation, 실제 quota 소비를 유지한다. 생성은 intake/collecting으로
끝나며 질문·요약·확인·채팅·자료·리포트는 실제 UI와 기존 실행 경로로 진행한다.

## REST 원자성 확인과 중단 조건

생성 전 실제 REST 경로에 두 개의 동일한 INSERT를 하나의 batch로 전달한다. 대상은
`baro-test-fixture:customer-intake-v1:atomicity-probe` 임시 metadata key 하나이며 고정된
시험 값만 쓴다. 예상한 `app_metadata.key` UNIQUE 거절 **및** 이후 key 부재를 모두
확인한 경우에만 계속한다. 이 시도의 rollback 관측이며 모든 공급자 동작의 보증은 아니다.
성공 응답, 다른 오류, timeout, 조회 실패 또는 잔여 key는 원자성 미확인으로 중단한다.
잔여 probe는 자동 삭제하지 않는다. 기존 schema/비용/운영 metadata를 변경하지 않는다.
로컬 SQLite 또는 native 대역 통과를 원격 REST 관측으로 기록하지 않는다.

고정 workspace/operation ID와 `baro-test-fixture:customer-intake-v1:attempt` 단일 시도
표식은 날짜와 배포 SHA에 따라 바뀌지 않는다. 생성 요청을 보내기 전에 표식을 저장한다.
그 뒤 응답을 잃으면 이후 실행은 해당 ID만 조회하며, workspace·operation·소비 quota·
intake·원본 사용량 행이 일치할 때만 이미 존재한다고 판정한다. 일부만 있거나 시도 표식만
있으면 unknown으로 중단한다. 자동 재생성·수선·삭제·새 ID 선택은 하지 않는다.
24시간 idempotency 만료나 후속 UI 편집도 두 번째 fixture를 만들지 않는다.

최초 시도 표식 쓰기 자체가 timeout이면 DB 부재만으로 재송신하지 않는다. workflow는
create/status를 고정 run-name으로 구분하고 CLI는 이전 create 실행이 하나라도 있거나
현재 run attempt가 2 이상이면 status로만 동작한다. 모든 페이지의 전체 개수와 현재 run을
확인할 수 없는 경우도 조회만 한다. GitHub 실행 이력 삭제까지 불변이라고 주장하지 않는다.
운영자는 최초 create 한 번만 실행하며, 결과 불확정 후에는 status만 실행한다. 시도 표식
쓰기 실패 receipt는 phase=intent, domainCreateInvoked=false로 도메인 생성 미호출을 남긴다.

## 확인과 증거

receipt는 버전·preview·candidate SHA·고정 상태/오류 코드·이번 REST 확인 여부와
고정 실행 단계·도메인 생성 호출 여부·UI/Turnstile/외부 연동 미검증 표시만 출력한다. owner/profile/workspace ID, 본문, 키,
암호문, SQL, 원문 오류와 stack을 로그나 artifact로 내보내지 않는다.

키 이름 존재와 CLI 자체 복호화 성공은 Worker가 같은 키를 사용하는 증거가 아니다.
실제 로그인한 고객 UI에서 명시적 합성 사건을 열고 새로고침 후 내용이 유지되는지 확인한
다음 downstream 검증에 사용한다. UI 생성·Turnstile 미확인은 별도로 유지한다. 정리가
필요하면 해당 합성 사건만 기존 UI/API 삭제 journal 경로로 삭제하며 일일 quota를 되돌리지
않는다. 삭제된 고정 ID는 tombstone 때문에 이 도구로 다시 만들 수 없다.
