# 개편 실제 인수 후속 수리 (#723)

현재 채팅 `BARO 개편 최종 오류 수정·실제 인수`에서 수행한다. 상위 #620/#621,
담당 #622–#627의 기존 실제 인수 미완료 및 #339 CLOSED/NOT_PLANNED와 실패 증거는 보존한다.
이번 작업은 preview 전용이며 production에 배포하지 않는다.

## 시작 시 재관측

- 원격 main `65f2f867e4216618d3b044844ab8102b0421afa0`, 열린 PR0. 로컬 clean main을
  fast-forward하고 `codex/723-analysis-acceptance`에서 시작했다. 기존 다른 worktree는 보존했다.
- `work:next`는 56 tasks/no cycles. 시스템 Bun1.3.14는 보존하고 격리 설치한 pinned
  Bun1.4.0으로 `bun ci`를 수행했다(1348 installs/1259 packages, lock 변경0).
- 원격 최신 실행은 기존 main CI41418032329/Report41418032333/preview41418781168 SUCCESS,
  full41418121808 FAILURE다. 이 기록은 새 수리 SHA의 성공 증거가 아니다.
- 기존 진단41379059504는 POLICY_REJECTED 모델 receipt3건(final/response/각attempt1,
  출력 한도2400/10000/8000, 관측 output189/2475/1795)을 보존한다. 진단 output은 빈 객체다.
  모델 계획·생성·감사까지 진행했음을 강하게 시사하지만 공급자 거절/감사/최종 인용 중
  정확한 실패 지점을 이 숫자만으로 확정하지 않는다. 기존 사건/원문/작업ID는 공개하지 않는다.

## 첫 수리와 검증 경계

일반 workspace 채팅과 달리 새 법률 분석은 기존 `resolveQuotationSpans`를 사용하지 않았다.
검증된 excerpt에 유일하게 일치하는 인용문도 모델의 숫자 좌표가 틀리면 독립 감사/최종
검증에 그대로 전달됐다. 기존 코드를 대상으로 새 회귀를 실행해 1실패를 재현했다.
같은 함수를 분석의 schema 검증 후, 독립 감사 전에 연결해 정확 문장과 출처를 보존한다.
불일치·중복·미허가 원문은 보정하지 않으며 독립 감사와 최종 인용 검증을 유지한다.
이 합성 재현을 과거 실제 실패의 단독 원인 확정으로 표현하지 않는다.

분석 runtime의 일반 POLICY_REJECTED 반환이 단계 증거를 버리던 공백도 수리한다.
private workflow에 stage/reason enum과 허용된 감사 findings·개수/claim 실패 enum만 남기고
기존 operator inspection이 이를 읽도록 한다. 원문·식별자·좌표·prompt·출력·stack/SQL은
남기지 않는다. strict HTTP/설치 native DTO, DB schema, 모델/공급자·시도 한도는 변경하지 않는다.

- 집중 기존/신규5파일134 PASS/0 FAIL/694 assertions. 독립 감사 거절, 없는 인용문,
  좌표 복원 후 감사 선행, 출처/권한/중복/Unicode 경계와 실제 암호화 작업 저장을 포함한다.
- 진단 후속2파일17 PASS/0 FAIL/164 assertions. malformed 진단과 private 값 유출을 거절한다.
- quick/build/exact PR CI/main 및 변경 조건의 실제 preview 인수는 후속 기록한다.

## 보안 재관측

현재 pinned Bun/lockfile의 새 raw audit는 16건(high7/moderate5/low4)이다.
deepmerge1/glob1/minimatch1/node-forge12/Zod1을 각각 조사한다. 기존 patch의 범위와
raw advisory 차이는 보존하며 새 수리는 별도 이슈/PR로 연결한다. 검사 생략·allowlist·
버전 위장·의존성 제거로 성공을 만들지 않는다.

최종 집중 검증은 5파일135 PASS/0 FAIL/701 assertions다. 리포트 continuation 실패는
완료된 분석을 되돌리지 않으며 별도 유한 진단으로 보존하는 회귀를 포함한다.
`validate:build` 전체와 실제 local workerd의 익명 login HTML 부팅이 성공했다.
초기 sandbox 부팅 실패·동시 파일검사 timeout, PATH의 sh/unzip 부재 및 단독 재검사
성공을 구분한다. 현재 최종 quick 전체는 도구 PATH를 바로잡아 재실행 중이다.

## 완료 작업의 실제 시도 수

operator inspector의 CLI는 성공한 질문·요약·분석·자료 처리 작업도 기존 모델 admission
receipt로 확인한다. 최근 작업12개/작업당 receipt12개 창을 명시하며, 별도 read-only
집계는 그 창 밖의 작업까지 포함한 전체 workspace model admission을 state/transport별로
센다. prepared/not_sent와 unknown/null은 실제 공급자 성공으로 바꾸지 않는다. 완료 job의
모델 receipt와 분석·PDF 성공은 별도로 해석한다. SQL은 고정 parameterized SELECT이고
원장·hold·관측 시각/금액·실행을 변경하거나 공급자를 호출하지 않는다. prompt·원문·출력·
credential·오류 stack/SQL은 내보내지 않는다. 기존 실패용 policy/schema 필드는 유지한다.

실제 migrated schema에서 SELECT를 실행하고 독립 API envelope로 완료 작업4종·불명확한
receipt·범위·과거 창의 집계·private field 제거를 검증한다. 이 검증은 합성/offline이며
실제 원격 시도 수는 병합 후 같은 SHA preview의 read-only 검사로 기록한다.

## 중간 full의 Linux 예외 fixture 수리 (#730)

main167fa692의 수동 full41683147245 core는 5344 PASS/8 SKIP/2 FAIL로 끝났다.
두 실패는 cleanup 호출 전에 native Error의 throwing getter를 설치하던 중 발생했다.
Linux Bun1.4.0이 lazy stack을 materialize하면서 이미 교체된 name/message getter를
읽은 경계다. private 오류를 사용하지 않은 합성 marker fixture다. stack을 먼저 읽은 뒤
기존의 name/message/code/status/stack throwing getter를 모두 설치한다. 실제 정리기의
retry 및 거짓 absence receipt 거절 assertions와 제품 동작은 유지한다. Windows 집중
검증은 23 PASS/0 FAIL/204 assertions이며 Linux exact-head CI와 최종 full은 별도로 기록한다.
