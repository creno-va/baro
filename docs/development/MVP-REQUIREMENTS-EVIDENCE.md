# MVP 요구사항·증거 완료표 — 3세션 보완

- 기준일: 2026-10-09 KST. GitHub 이슈/PR이 진행 상태 정본이며 이 표는 요구 누락을 막는 인수 정본이다.
- A: 고객 #64/#65/#162, 공통 client/auth/router/types·CI·통합/운영. B: #58/#59/#66/#67 자료·리포트·삭제. C: #62 변호사 서버/client와 계획·작업 그래프·#69/#71 감사.
- 기존 worktree/커밋/실패/완료 증거 보존. 새 Goal·세션·에이전트·DB/비용 선행 이슈 없음.
- #163의 Editor/Profile/Directory는 main 통합 후 C 수정. shared mock `requireSession({consent:false})`와 읽기/변경 구분은 A 통합, C는 변호사 consumer를 연결한다.

## 상태·증거 판정

`완료(범위)`는 표시한 SHA와 증거 종류의 조건만 충족한다. `보완 중`/`통합 대기`는 통과가 아니다.
`이관`은 필수 조건이 남아 현재 담당 이슈가 있다는 뜻이며 `범위 제외`와 다르다.
ADR-0014의 심사/어드민 UI만 제외하고 기존 backend/증거는 보존한다. #62/#69는 이전 완료를
취소하지 않고 새 누락 조건만 재개했다. M6 mock sprint 종료는 M5/원격/법률 완료가 아니다.

각 새 검증 receipt는 요구 ID, 현재 담당 이슈, candidate 전체 SHA, 환경/시각/역할/합성 fixture,
단계, 기대/실제 결과, 증거 종류(API-mock UI / 실제 SQL·암호화 HTTP / native 처리 / 원격 live /
사람 승인), test/run/artifact reference를 포함한다. source SHA가 다른 증거는 변경 영향이 없는
범위와 재사용 이유를 적는다. 민감 사건·cookie·token·SQL/stack·실제 원문은 넣지 않는다.
기능 통합 전 시나리오를 준비한 것은 PASS가 아니다. 최종 #71 candidate receipt는 별도다.

## 확인된 결정과 우선순위

| 기준 | 현재 확인된 결정·구현 근거 | 과거 기준 처리 |
| --- | --- | --- |
| 역할 | 고객/변호사, ADR-0014. 본인 프로필·직접 외부 연락, 무검증 자격 표시 금지 | 심사/반려/승인대기/어드민 UI 제외; 기존 backend 보존 |
| 질문 | 2026-10-07 사용자 정정, PR154/main `78c1c0e`: 최대 2차례·차례당 3문항, 추가 공백은 요약/후속 chat | v2 3×5/15문항 대체. v1 기존 5문항 읽기 호환은 유지 |
| 사용량 | #57/PR143/main `d91f342`: KST AI200회/일, 사건3/일, media60분/일·저장10GB 등 다른 한도 유지 | AI30회/일 대체. 문항 수와 논리 응답 operation·내부 재시도 비용은 별개 |
| 비용 | #57의 직접 지시 기록·PR143·DOMAIN-LIFECYCLE: 월 cap 해제(`MONTHLY_BUDGET_CAP_ENABLED=false`), 기존 사용자 설정 잔액$10/충전$30 | 과거 기술100만원 hard stop/자동충전 OFF 대체. actual funding/가격/FX·bounded attempts·unknown holds·ledger는 유지 |
| 운영 승인 | #71의 후속 배포 기록과 실제 현재 Environment 규칙을 A가 확인 | 오래된 reviewer 지정 문서를 현재 설정으로 단정하지 않음. 배포 허용은 법률/사업자/외부 인수 승인 아님 |
| HTML 리포트 | 2026-10-09 B 채팅의 사용자 답변 “BARO 제품에 적용”: 디자인된 HTML 미리보기·다운로드, B #66 | 샘플 파일만 만드는 범위가 아님. 기존 PDF/선택 원본 ZIP 및 외부 gate 유지 |

위 비용 행은 확인한 기존 기록과 배포 코드의 정합성 정리다. C가 새 정책·결제·충전·예산 또는
새 공개 승인을 부여하거나 운영 설정을 변경하지 않는다. 기록 범위 밖 결정은 추론하지 않는다.

## 재사용 증거 인덱스

| ID | 정확한 SHA·결과·reference | 인정 범위와 제한 |
| --- | --- | --- |
| E-L | PR126 head `0faf7e961c59b2867000af6d5b6a383815b9d151`, [CI37492533305](https://github.com/creno-va/baro/actions/runs/37492533305) 필수3 SUCCESS, main `e619cb8beb47dcb103cd422d7189ba24819d54d2` | 기존 변호사 role/프로필/사진/PDF/공개·SQL/합성 browser. 이번 text/재동의 새 요구는 미포함 |
| E-F | `e8b18c72a88a31ec9d4ae0c6f6855c6a59dfd48f`, [CI37506090574](https://github.com/creno-va/baro/actions/runs/37506090574), [Full37506109883](https://github.com/creno-va/baro/actions/runs/37506109883) SUCCESS | unit1261/browser73/native/CSP4/migration6. SQL·실제 PDF 엔진·격리 R2 byte adapter. 새 누락 요구·원격 성공 대체 불가 |
| E-R | `76c31fcc571e82b96d55dab6dcd3f02dc331e323`, [journal](https://github.com/creno-va/baro/issues/71#issuecomment-6024218432) | CI/Full/preview/production·SHA/schema0009/HTTP smoke와 local 세 OAuth callback 기록. 모든 환경 전체 시나리오·복구·정책 완료 아님 |
| E-U | PR143/main `d91f342a3aa64008ab72ff338eca55c4ba14d40e`, CI37532626804/production37534088349 SUCCESS ([#57](https://github.com/creno-va/baro/issues/57)) | AI200·월cap 설정 배포. 실제 원격 비용/unknown hold 정산 완료 아님 |
| E-I | [독립 리뷰](../quality/independent-review-2026-10-06/REPORT.md), PR123 및 #65/#66/#69 후속 이관 기록 | 당시 실패와 수정의 역사. 현재 미충족은 아래 담당 이슈로 유지 |
| E-C | C source `0d3fbe0`, 아래 로컬 검증 기록 PASS; [PR168](https://github.com/creno-va/baro/pull/168), 최종 [통합 PR167](https://github.com/creno-va/baro/pull/167)의 CI/통합 SHA는 #62/#69/#71 후속 receipt에 연결 | 서버/변호사 client/문서 보완. A #163/#165 임시 통합 검증이며 main·원격·사람 승인과 분리 |

## 요구사항 완료표

각 행의 마지막 칸은 검증 SHA·결과를 E-ID로 연결한다. `미검증`은 새 조건에 통과 SHA가 없다는 뜻이다.
원래 정상/실패 세부 절차는 [UI 시연 행렬](../product/UI-DEMONSTRATION.md)을 함께 따른다.

| 요구 / UI | 현재 담당 이슈 | 사용자 시나리오 → 기대 결과 | 필요한 증거 | SHA·현재 결과 / 남은 조건 |
| --- | --- | --- | --- | --- |
| F001 / 01 | A #27/#65, C #69 | 고객/변호사 선택·세 OAuth·취소·만료·로그아웃 → 정확한 역할·복귀 | session/CSRF SQL, 실제 환경별 OAuth | E-F/E-R 일부 완료; 환경별 원격 #27 이관 |
| F002 / 02 | A #64/#65, #57 | 개인/기업 사건·Turnstile·중복/일3 경계 → 단일 owner 저장 | browser+SQL, 실제 Turnstile | E-F 기존 회귀; 새 통합/원격 #71 미검증 |
| F003 / 03–04 | A #64/#65 | 최대2×3·unknown/skip·back edit·중단→로그인 복귀 → 서버 저장 복원 | pipeline/browser/유실 retry·revision | PR154 구현; #159~#161 및 복귀 보완 통합 대기 |
| F004 / 05 | A #64/#65 | 추가 사실·교정→새 요약→재확인 → 최신 확인 revision | SQL/API·browser·경합 | 기존 E-F 완료; 추가 사실/재확인 보완 미검증 |
| F005 / 06 | A #64/#65, #57 | chat 재열람·AI200/201·timeout/retry → 검증된 응답·중복 quota 없음 | SQL/합성 모델·원격 모델/비용 | E-F/E-U 부분; 원격 retry/unknown hold #27/#57 |
| F006 / 07 | A #64/#65 | 사실 교정·날짜 year/month/day/unknown·출처 → 허구 날짜 없이 저장/재접속 | API/browser·source/revision | E-F 기존; 날짜/추가 사실 보완 미검증 |
| F006 / 08 | A #63/#64, #68/#70 | 전략 요청/근거 실패 → 변호사 확인·공식 경고·사실 정리 유지 | boundary/출처 테스트·법률 검토 | E-F 합성 완료; 실제 공식 출처/행동 승인 이관 |
| F007 / 09 | B #58/#59, A #65 | PDF/이미지 실제 upload·100MB/500쪽/손상 → 정확한 처리 상태 | native/SQL·원격 R2/Container | E-F native 완료; 원격 최대경계/실제 처리 #71 |
| F007 / 10 | B #59, #57/#58/#65 | 음성 전체·무음/경계/retry → 시간 위치·누락 구간·실제 비용 | native codec/Whisper·live receipt | E-F 일부; M4A 경계 결함 및 live #59 |
| F007 / 11 | B #59, A #65 | 영상 음성/1초·장면 frame → 실제 coverage/gap 표시 | frame/time fixture·원격 처리 | E-F 일부; 정확한 coverage 보완/live 미검증 |
| F007 / 12 | B #58/#59, #57 | 동의·예약·대기/재개·한도 → 이유/행동/실제 quota 표시 | concurrency/SQL/browser·ledger | E-F/E-U 일부; live 정산 #57/#71 |
| F008 / 13 | B #58/#59, A #65 | 내용 교정/분석 제외·page/time 조회·재접속 → 출처/교정 구분·정본 소비 | 실제 API·browser·AI context | 기존 download E-F; 교정/제외/정확한 coverage 미검증 |
| F009 / 14 | B #66, A #64/#65 | 최신 사실/교정/제외→새 리포트 → 최신 확인 revision, 옛 리포트 stale | API·생성 snapshot/PDF 비교 | E-F 기존; 최신 revision 보완 통합 대기 |
| F009 / 15 | B #66 | PDF 미리보기·다운로드→실제 열기 → 한글/줄바꿈/출처/시각 | 실제 renderer·내용/시각 검토·원격 byte | E-F native 완료; 새 내용/원격 #66/#71 |
| F009 / 16 | B #66/#67 | 선택 ZIP 다운로드 → 선택 원본만, 중복 filename/삭제 안전 | ZIP bytes·HTTP/owner·원격 | E-F native 완료; 최신 보완·원격 이관 |
| F012 / 17 | C #62/#61 | 비로그인 목록 필터/URL/빈 결과/회전 → 객관적 정렬·복원 | browser/API·mobile | E-L 완료; #162 활성화 통합 회귀 #69 |
| F012 / 18 | C #62/#61 | 공개 프로필→연락/세 map 링크 → 올바른 URL·보장 없음 | browser/URL·공개 가드 | E-L 완료; text 표시 보완 및 live #71 |
| F010 / 19 | C #62, A auth | 자기 portal·타인/고객 사건 시도 → 소유권/역할 차단·무검증 고지 | signed SQL/IDOR·browser | E-L 완료; 재동의 보완 E-C 합성 PASS; main 통합 대기 |
| F011 / 20 | C #62 | 제목+별도 본문 작성/저장/재접속/미리보기/공개/수정/삭제 → 본문 보존 | 암호화 SQL·API/mock/browser | E-L image/PDF 완료; text E-C 합성 PASS; main 통합 대기 |
| F013 / 21–23 | ADR-0014 (#60 역사) | 승인·반려·심사 admin → MVP에 노출하지 않음 | route/navigation 확인 | 범위 제외, 기존 backend/증거 보존; #70 법률 승인과 별개 |
| F014 / 24 | B #67, A auth | 최근 OAuth→자료/사건/계정 삭제 → 원본/파생/context/export/public 정리 | 실제 SQL·R2/instance delete | E-F 합성 완료; 원격 #67/#19/#71 |
| F014 / 25 | B #67 | 삭제 중 upload/chat/export 완료 → 부활 금지·재시도/경보 | 경합 SQL·actual restore/journal | E-F 합성 완료; 실제 복구/운영 대기 |
| legacy / 26 | A #65, B #67, #55 | v1 읽기/삭제 → schema1·기존 인용 보존·무단 재분석 없음 | migration/SQL/browser | E-F 완료; 변경 영향만 통합 회귀 |
| all / 27 | A/B/C #69, #56 | 320px/desktop/200%·keyboard → focus/dialog/오류 접근성 | browser/axe+시각 점검 | E-F 기존 완료; 새 화면 E-C 합성 PASS; A/B/C main 통합 대기 |
| all / 28 | A #69/#71, #56 | built Worker CSP→폰트/아이콘/dialog/upload → hydration·fallback | production bundle/CSP/browser | E-F 기존 완료; #162/새 client 통합 대기 |
| F005/009 / 29 | A #64/#65, B #66 | 직접 연락 링크 후 사실/자료 추가→리포트 갱신 → 강제 연락/자동 공유 없음 | browser+snapshot | E-F 기존; 최신 facts 연결 보완 미검증 |
| privacy / 30 | #68/#69 | analytics 거부/철회→기능 동일·PII allowlist | 동의/철회 테스트 | E-F 완료; 정책 사람 승인 #20/#70 |
| renewal-customer / 31 | A #65, B #58 | 재동의 전 사건/자료 조회·다운로드 → 읽기 허용/수정·AI 차단 | API/browser·계정 전환 | 보완 통합 대기, 미검증 |
| renewal-report / 32 | B #66 | 재동의 전 기존 HTML/PDF/ZIP 조회·다운로드 → 저장 snapshot 유지/새 생성·수정 차단 | API/browser·byte/권한 | 보완 통합 대기, 미검증 |
| renewal-lawyer / 33 | C #62, A runtime | 재동의 전 자기 profile/assets 조회·download → 기존 읽기만 허용 | API/stream revoke·mock/browser | E-C 합성 PASS, public 현재동의 유지; main 통합 대기 |
| activation / 34 | A #162/#163 | 출시 모달/비활성 제거→기존 기능 진입 → 권한/상태/외부 gate 유지 | integrated browser/CSP | #163 CI/통합 대기; 기능 자체 완료와 별개 |
| F009 / 35 | B #66, C #69/#71 | 저장 리포트→디자인된 HTML 미리보기·다운로드→모바일/인쇄 → 고정 revision·basis/stale·마스킹·자료 제외·출처/누락 유지 | 실제 HTML/HTTP·browser/시각·escape/CSP·owner/삭제 경합 | 사용자 범위 확정, B 구현/통합 대기; 검증 SHA 없음, 미검증 |
| F015 비용/한도 | #57, A/B #71 | retry/월경계/미확정 청구 → actual ledger·bounded attempt·복구 | SQL·실제 청구/가격/funding | E-U 구현/배포, 실제 정산 미완료 |
| 출처/법률 | #63/#70 | 공식 출처 못 얻음 → 확인불가, 법률 검토 전 승인 주장 없음 | live tuple·사람 검토 | E-F captured/합성; live/사람 대기 |
| 운영/최종 | A #19/#27/#71, C #69 | 최종 candidate 전체 시연·restore/rollback → 요구 누락/결함0 | 동일 SHA release/live·human receipt | E-R 과거 배포만 완료; #71 마지막 종료 |

## 외부 조건·현재 담당 행동

| 이슈 | 구현됨 / 실제 검증 대기 / 사람 승인 대기 | 담당 행동·필요 증거 | 재사용·재검증 조건 |
| --- | --- | --- | --- |
| #19 | 배포/smoke/drill 계약 구현; 실제 복구/경보 대기 | A/운영 책임자: 기존 승인 자원의 격리 drill 대상, DB 밖 journal, 복구 관리자, 경보 수신처 지정 → restore+journal/rollback/ACK receipt | E-R health는 재사용; 지정/환경 변경 후 실제 drill, production restore 임의 수행 금지 |
| #20 | 초안/콘텐츠 감사 완료; 사실/법률/게시 사람 승인 대기 | 사업자/개인정보/qualified 법률 검토자: 등록·대표·주소·연락/권리행사·동의/보존 근거 확정. 승인 후 A가 문서/화면/동의 버전 게시 | E-L 및 [필드별 인계](./LAWYER-POLICY-HANDOFF.md). 후보 값을 사실로 승인하지 않음 |
| #27 | 일부 local 실제 OAuth·transport/설정 완료; 환경별 연동·retry 대기 | A/운영·provider 관리자: preview/production callback·취소/Turnstile·Gateway/키/funding parity와 모델 retry 확인. 비민감 run/환경/SHA 기록 | E-R local OAuth 재사용, PR144/146 실패/ambiguous hold 보존. 설정 변화 없이 유료 실패 반복 금지 |
| #57 | quota/ledger·AI200/cap 설정 구현/배포; 실제 정산 대기 | A 비용 운영/B 자료 소비: 실제 가격/FX/funding·retry actual receipt·unknown hold와 월 ledger 갱신 확인 | E-U 재사용, 설정/결제 추가 변경 없음. 실패를0원·환불·완료로 단정 금지 |
| #63 | bounded retrieval/captured/SQL 검증 구현; 공식 승인/live capture 대기 | 법률 API 계정 관리자: 법령/판례·JSON/도메인/목적 승인 근거 → A bounded live ID/version/date/hash/URL capture | E-F 유지, 승인 변화 전 같은 실패 반복 없음 |
| #70 | 두 역할 공개 문구/정책 초안; 실제 사업자/계약/법률/게시 승인 대기 | 법률/사업자/개인정보/운영: 국가/보존·위탁/국외/민감정보 근거·무검증 프로필/외부 연락/비용/AI 준비 행동 검토, 문서 버전·권한·검토일·범위·서명 reference | E-L은 기술/초안만. draft/개발 consent 불일치를 임의 승인 버전으로 맞추지 않음 |

각 담당은 역할 수준 지정이며 확인되지 않은 개인의 승인/책임을 발명하지 않는다. 실제 담당자
지정·문서/receipt reference 확보는 해당 이슈의 남은 행동이다. #58/#59/#67의 원격 처리·삭제는
B와 A가 연결하고 #71에서 함께 검사한다. 운영 환경 변경·배포는 A가 현행 권한 아래 수행한다.

## #71 마지막 종료 조건

1. 위 모든 필수 행과 기존 UI 정상/실패 조건에 정확한 증거가 있고 이관된 필수 조건의 현재 이슈도 실제 완료한다.
2. #162 활성화 및 #159~#161/후속 알려진 결함, #66 제품 HTML 리포트(UI-35)를 통합하고 #69에서 새 요구를 감사한다. 준비만 된 테스트는 pending이다.
3. #19/#20/#27/#57/#58/#59/#63/#67/#70의 실제/사람 증거가 모두 충족된다. 기존 배포 승인은 외부·법률·사업자 승인 대체가 아니다.
4. 최종 immutable SHA의 CI/preview/production·실제 양 역할·파일 다운로드·권한·삭제/운영 receipt와 정책/동의 버전을 대조한다. 과거 증거 재사용은 영향 범위가 같음을 명시한다.
5. 남은 필수 blocker/결함0, 최종 URL/결과표/증거 링크를 제공한 뒤 M5 및 #71을 마지막으로 닫는다. C PR은 `Refs`만 사용한다.

## C 보완 검증 기록

서버·추적 중간 source `b223cb8`의 당시 기록을 보존했다. 이후 UI 검증은 아래 `0d3fbe0` 절에 따로 기록하며 PR CI/최종 통합 증거와 구분한다.

- `bun ci`: Bun1.3.14 frozen install 성공, lock 변경 없음.
- 변호사 self-profile/self-assets: 16 tests/343 assertions 성공. 텍스트 저장/재접속/공개/수정/삭제,
  재동의 전 기존 조회·ready bytes 다운로드, 수정/공개 차단, 타인/role/session 만료 stream 차단 포함.
- `bun run check`: 문서/그래프/boundaries/lint/typecheck 성공. 전체1430 중1429 통과,
  workerd1은 sandbox의 local listen 제한으로 실패. 같은 test를 local listen 허용 환경에서
  단독 재실행해1 test/39 assertions 통과. 실패 로그를 숨기거나 최초 전체 명령 SUCCESS로 바꾸지 않는다.
- 중단 이후 `bun run db:check`: drift 없음, fresh/upgrade6 tests/29 assertions 성공. schema/migration 변경 없음.
- `docs:check`: 69 Markdown/14 ADR 성공. `work:check`/`work:next`: 54 tasks, no cycles, milestone drift 없음.
- A의 공통 mock 읽기 옵션과 #163 main 통합 뒤 C Editor/Profile·mock consumer 및 browser 시나리오를 검증한다.
  시나리오 준비는 PASS가 아니다. 원격 R2/Containers·실제 OAuth·사람 승인 검증은 수행하지 않았다.

### C 기능 완성 후보 — source `0d3fbe0`

A가 #163을 로컬 통합한 뒤 임시 합성 검증을 허용해 #163 `aae4f77`과 #165 `da568b9`를 C worktree에
반영했다. 공유 파일 소유/실제 main 통합은 A다. 최종 C PR은 선행 main 병합 뒤 C 변경만 포함하도록 정리한다.

- 최종 `bun run check`: **1431 pass/0 fail,137552 assertions**, typecheck0 errors/0 warnings,
  docs69/ADR14·graph54/no cycle·boundary/lint 성공. fresh/upgrade6/29, generation drift 없음.
- `bun run build`, `bun run cf:dry-run`: 성공. 배포/원격 Container 시작은 하지 않았다.
- 변호사 unit+shared runtime:21 tests/388 assertions PASS. 텍스트와 기존 snapshot 호환, read/mutation
  동의 분리, signed SQL/session/owner/role/public/삭제·stream 중 만료, cached mutation 거절 검증.
- wire UI12 PASS:320px/200%·keyboard·axe·실패/충돌·계정 전환·본문 저장/재접속/미리보기/공개/수정/삭제·
  재동의 전 기존 조회/다운로드. `.wrangler/lawyer-portal-320.png`, `lawyer-renewal-320.png` 합성 화면 육안 점검.
- 같은 UI의 integrated mock1 PASS:로그인/동의→photo/PDF/text 저장→재접속/공개→재동의 전 download→
  다시 동의 후 비공개/자료삭제. 실제 `/api` network0; 실제 OAuth/R2 성공이 아니다.
- 추가 다운로드 경합:응답 완료 직전 계정 변경(브라우저 focus event 없음)→이전 owner UI 제거·파일 전달0.
  최초 기대 문구가 공통 오류 매핑과 달라1 fail/7 pass였고 기대를 공통 문구로 고친 뒤 해당1 PASS.
  오류/실패 이력은 보존하며 이 추가 검증을 원격 privacy 승인으로 확대하지 않는다.

고객/자료/리포트 A/B 미통합 보완 조건, 실제 외부·사람 승인 및 #71은 위 합성 PASS와 별도로 계속 대기한다.

### 추적 도구·최종 인계

`work:next`에서 OPEN 외부 조건을 구현 PR 병합만으로 #71의 선행 목록에서 빼던 판정을 수정했다.
개발 선행은 기존 병합 예외를 유지하고 외부/최종 인수는 모든 선행 이슈의 CLOSED를 요구한다.
재개된 보완은 IN_PROGRESS와 기존 implementation PR 병합 증거를 함께 표시한다.
graph 회귀5 tests/16 assertions·tools typecheck·lint·docs69/ADR14·live graph54/no drift가 통과했다.

C는 PR168 원본 커밋과 증거를 유지하고 A가 PR167에서 최신 main 및 A/B 변경을 함께 검증한다.
PR168 `fac2fe5`의 CI37895700011은 후속 요구/추적 commit push로 취소돼 전체 PASS가 아니다.
새 candidate CI와 최종 통합 receipt를 #62/#69/#71에 연결하며 기존 실패/취소 이력은 보존한다.
