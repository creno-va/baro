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

## 사진 PDF의 첫 전달/저장 실패 (#732)

preview167fa692의 사진 포함 정규 리포트에서 native response 뒤 저장 실패를 관측했다.
finite 진단은 unclassified/unknown/DB_OPERATION_FAILED였다. 원격 재시도 대신 합성
signed Hono/runtime·SQLite·암호화 저장 harness로 원인을 좁혔다. 동일 PDF25,842bytes와
미사용 공식 원문40개는 native 응답1조각에서 성공(300쿼리)했으나 512byte 조각에서는
동일503/DB_OPERATION_FAILED로 실패했다. 조각마다 수행하는 live 권한 SELECT가
post-render 저장 계획에 누락돼 있었다. 실제 native renderer·공급자는 이 offline
재현의 대역이며 실제 분석/PDF 인수와 구분한다.

모든 renderer 권한 검사를 계속 실행하며 실제 검사 횟수를 저장 계획에 더한다.
900쿼리·행·쓰기 상한과 reserve/lease/암호화/인용/owner 검사는 유지한다. 변경 후
동일 fragment 재현은 349쿼리로 저장·복호화 전달에 성공했다. 독립 회귀는 실제 SQL·
physical permit·R2 암호화 저장에서400회 검사를 모두 실행해 성공하고, 과도한 검사와
렌더 도중 요약 변경은 PUT 전에 거절한다. 원래 계획은 같은 긍정 회귀에서 RED였다.
기존 hold는 dispatched로, 저장 artifact는 held/stopped로 보존하는 것도 확인한다.
이 경계 회귀를 quick CI에 포함하며 최종 head CI/main/동일 SHA preview의 실제 첫
다운로드는 후속 기록한다. 이전 사용자 편집본과 저장 PDF는 그대로 보존한다.

## 선택 자료 대화 반영의 독립 audit 거절 (#734)

previeweb1f5d9에서 청구 새 요약3/분석47/리포트6의 실제 분석과 첫 사진 PDF 전달은
성공했다.9페이지 전체 시각 검사 및 웹/실제 HTML/PDF13절 일치까지 확인했다. 같은
배포의 방어 자료 추가 자동 분석도 완료됐으나, 후속 자료 대화 반영은 attempt1에서
실패했다. 별도 검사41697549756은 생성/schema 완료, 모델2개 final/response,
독립 audit 실패를 보여준다. finite critical unsupported_fact2개는 target=unknown/
basis=user_message와 target=timeline/basis=selected_material이며 legalClaimsSupported=true,
strategyDetected=false,unsupportedFactCount=0이다. 공급자 거절·법률 금지로 단정하지
않으며, 보존하지 않은 거절 초안의 특정 문장을 원인이라고 주장하지 않는다.

기존 단일 교정 경로는 intake_narrative 기반 타임라인 거절에 한정돼 있었다. 선택된
자료가 실제 제공되고 위 제한된 finding 조합이 있는 경우만 같은1회 교정 경로에
연결한다. 유한 code/target/basis만 새 생성에 전달하며 거절 출력·식별자·원문은
feedback에 보내지 않는다. 문서 화자와 사건 당사자, 약정일과 실제 사건, 미확인
질문의 전제를 구분하도록 지시한다. unknown 진단을 유효성의 근거로 사용하지 않는다.
새 초안도 모든 source/reference/날짜/개인정보 검증 및 독립 audit를 통과해야 한다.
재차 거절·privacy/법률/strategy/지원 없는 fact·관측 부족·다른 근거 조합은 그대로
실패하며 새 lookup은 거절한다. 기존1회 공유 교정 상한·새 admission·권한/lease와
실패 receipt·과거 snapshot/편집/PDF/hold는 유지한다. 이 복구를 감사 우회나
POLICY_REJECTED의 성공 변환으로 해석하지 않는다.

기존 조건에서는 새 회귀3개 RED, 수정 후 관련148 PASS/0 FAIL/782 assertions다.
실제 자료 반영 재검증은 코드 조건 변경·정확 head CI·병합·동일 SHA preview 뒤로
보류했고 같은 외부 실패를 그대로 다시 호출하지 않았다. eb1 full5358 PASS/8 SKIP/
0 FAIL·native SUCCESS와 raw audit deepmerge low1은 이 후속 수리 전의 중간 증거다.
