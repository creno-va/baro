# legacy 재시도 표시와 실행 상태 정합성

추적은 [#547](https://github.com/creno-va/baro/issues/547), 실제 잔여 transport는
[#506](https://github.com/creno-va/baro/issues/506)이다. `codex/547-legacy-retry-state`는
검증된 mainbfaf63e에서 시작해 PR546/main15ea94a를 통합했다. DB migration·공유 wire·
native 앱 제품·랜딩·모델/외부 API 설정을 변경하지 않는다.

## 문제와 변경

기존 POST retry와 SQL CAS는 dispatched/unknown 모델 요청을 차단했지만 GET 사건/분석은
실패 code와 횟수만으로 retryable=true를 표시했다. 새 Hono2개 검사는 이 불일치로 실패했다.

실패한 현재 분석이 원래 재시도 가능한 경우에만 owner/current analysis/revision/attempt와
미확정 flag를 한 SQL snapshot에서 확인한다. 삭제·입력/시도 변경은 stale로 판정해 이전
상태를 공개하지 않는다. 이 flag는 내부 전용이며 strict v1 DTO와 남은 횟수는 그대로다.
dispatched/unknown이면 두 GET의 error.retryable과 분석 retryable을 false로 표시한다.
응답이 확인되지 않아 재분석을 보류했다는 고정 문구를 쓰며 background 처리 중이라고
꾸미지 않는다. 확인된 응답 receipt 후 다음 조회에서 다시 가능해진다.

0017 이전의 역사적 DB에는 journal이 없으므로 metadata 확인 뒤 journal을 참조하지 않는
동일 owner snapshot으로 읽는다. 이 경우는 ‘가능 여부를 확인하지 못함’과 retryable=false다.
없는 기록을 provider unknown/실제 성공으로 만들지 않고 실패 사건의 읽기도 보존한다.
재시도 표시가 실행 권한을 대신하지 않으며 실제 Workflow terminal과 최종 SQL CAS는 계속
확인한다. definite transport blocker는 Workflow control-plane 조회 전에 거절해 즉시
재시도를 안내하지 않는다. read-only ‘분석 상태 다시 확인’은 모델 POST 없이 최신 GET을 읽는다.

## 검증과 남은 실제 조건

SQLite/AES/Hono 집중3파일62개/636 assertions가 통과했다. 두 미확정 상태의 공개 flag와
안내·attempt/멱등/outbox 보존, 합성 late receipt 후 재활성화와 명시 재시도202를 확인했다.
prepared/not_sent, journal/usage의 read-only 보존, 다른 owner·새 revision 차단,
0005 실패 읽기와 기존0005→0006의 ciphertext/삭제/다른 사용자 보존도 확인했다.
미확정 상태의 POST는 Workflow status를 조회하지 않고 모델 호출도 하지 않는다.

브라우저2파일16개가 통과했다. 390px에서 재시도 미노출·read-only 상태 확인·fresh response
후 재활성화, 기존 lost ACK key·stale response·세션/동의·Unicode·실제 합성 signed session/
API/SQL의 질문→결과→재방문→삭제를 검사했다. 실제 모바일 PNG도 확인했다.
validate:db는 drift·기존 upgrade·로컬 D1 import/reapply no-op을 통과했고 새 migration은 없다.
최종 quick/build와 정확 PR/CI/main 결과는 이슈/PR에 이어 기록한다.

최종 quick은 보안9·공통/mobile525·RN108·마지막603성공/기존host전용2제외로 통과했다.
production build/bundle/dry-run/local built workerd도 통과했다. 실제 외부 공급자 호출이나
preview/production 배포는 수행하지 않았다.

preview의 기존 attempt2/minimize unknown은 그대로다. 이 테스트의 합성 receipt를 실제
종료 증거로 사용하지 않으며 실제 모델 호출·fixture reset·3번째 호출·ledger 삭제는 없다.
원래 입력/읽기/삭제·남은 시도·AI200/일·비용 관측 전용·권한/무결성·실제 공급자 오류와
#339/#71 보안·릴리스 조건을 보존한다.
