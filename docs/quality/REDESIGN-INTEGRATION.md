# BARO 웹 전면 개편 통합 인수

현재 사용자 직접 지시의 다섯 지정 세션을 별도 checkout/codex 브랜치로 조율하고 통합했다.
결정·소유권·두 정보 구조 비교·상태 보존·전체 경로 계약은
[실행 계약](../development/REDESIGN-EXECUTION.md), 공통 API는
[FOUNDATION](../design/FOUNDATION.md), 결정은 [ADR0021](../adr/0021-case-workbench-and-web-design-system.md)을 따른다.

제품 검사 SHA와 문서/증거 커밋을 구분한다. 정확한 SHA·명령·환경·로그 해시의 정본은
이 문서와 연결된 JSON receipt다. 같은 화면의 캡처만으로 합격을 선언하지 않는다.
아래 제품 인수 시점에는 main 병합·배포를 수행하지 않았다. 이후 사용자가 최종 검증 후 preview
배포와 GitHub 정리를 지시했으며 현재 진행·정확 main SHA·배포 receipt는 실행 문서와 후속 기록을 따른다.

## 적용한 경로

| 실제 경로/상태 | 적용 결과 |
| --- | --- |
| `/` | 준비 가치→설명/질문·자료·지속 리포트의 흐름, 실제 지원/미지원, 키보드·JS 없는 링크 |
| `/login`, `/consent` | 공통 로그인·기존 계정 유형/returnTo 보존, 동일 정책 버전·명시 동의·실패/재시도 |
| `/app`, `/cases/new` | 네 사건 경로/미정 선택, 설명 진입, 문서 없는 대응, 실제 자료 추가 시점·한도 안내 |
| `/cases` | 실제 전체 목록·단계별 재개·삭제·owner purge, 상시 ‘내 사건’ 진입과 공통 목록 행 |
| `/cases/:id/intake`, `/summary` | 질문2×3·모름·재개/충돌, AI 추출/요약 교정과 사용자 확인 구분 |
| `/cases/:id`, `/files` | 같은 사건의 대화·자료 작업, 미전송 설명·실제 File bytes·커서/스크롤 보존, 명시 업로드/자료 반영 |
| `/cases/:id/timeline`, `/actions`, `/precedents` | 기존 직접 URL/작업 유지, 출처 위치·현재 자료 revision·불확실성·공식 원문 |
| `/cases/:id/reports`, `#document-drafts` | 같은 Workspace 직접 진입, 네 작업 왕복·리포트 편집·검토 체크/초안 보존, 명시 저장/TXT |
| 리포트 후속 세 액션 | 직접 해결·리포트만 저장 유지. 변호사는 지정 미지원 모달, 요청/선택 변경0·닫기/초점 복귀 |
| `/settings`, `/help` | 계정·동의·사용량/한도·삭제·재인증·지원 안내, 이전 변호사 계정 본인 자료 열람/다운로드/삭제권 |
| `/policies/terms`, `/privacy`, `/ai`, `/ai-notice` | 공통 읽기 레이아웃·기존 alias, 법률 정책 원문/버전/동의 의미 불변 |
| `/lawyer`, `/lawyers`, `/lawyers/:id` | 실제 HTTP410·종료 안내·공통 사건 이용, 프로필/목록 조회와 컨택0 |
| 알 수 없는 URL | 실제 Astro404와 공통 공개 레이아웃 |
| `/app`·`/login`의 접근 확인 실패/베타 닫힘 | 공통 503 안내, 인증·캐시·Retry-After·보안 헤더 보존 |

기존 v1 저장본·읽기·삭제도 보존한다. native 보안 challenge는 웹 탐색 경로가 아닌 기존
브리지 화면이며 이번 웹 DS 적용과 구분한다. 리포트 HTML/PDF의 독립 출력 스타일도 보존한다.

## 세션 PR과 검토

| 담당 | PR / 정확한 domain head | 통합 검토 |
| --- | --- | --- |
| 01 공통 | [774](https://github.com/creno-va/baro/pull/774) / 9b5b273 | canonical tokens/API·source tree·native portable 값 보존, cleanup5개 후속과 List를 총괄 통합 |
| 02 사건·자료 | [780](https://github.com/creno-va/baro/pull/780) / d73d5f9 | 생성ID/재시도·네 경로·출처/현재rev·File bytes·retained Workspace,03/01 선행 소비와 소유권 확인 |
| 03 리포트·초안 | [775](https://github.com/creno-va/baro/pull/775) / f5236c9 | 세 액션·명시 reviewed 저장·자료/편집·owner/CAS·버전 보존, 직접 URL486/511 후속 포함 |
| 04 공개·계정 | [779](https://github.com/creno-va/baro/pull/779) / eb09e7e | 정책 본문/버전 동일·공통 로그인·기존 자료 권리·410/404/CSP·test-only legacy 격리 |
| 05 독립 | [781](https://github.com/creno-va/baro/pull/781) / 63c3092 | 제품 코드0·독립 검수/실패 이력·사용자 승인 후 원본 증거 통합 |
| 총괄 | [778](https://github.com/creno-va/baro/pull/778) | 제품/ADR/실행 정합성, 공통 로그인·mock 정합성, 통합 충돌·전체검사·접근실패 HTML 연결 |

01 이외의 공통 변경은01 원본 커밋의 소비다. domain PR에는 선행 소비 diff가 포함될 수 있으므로
각 작업자의 새 소유 변경과 구분해 검토했다. 중복 cleanup Draft777은 닫고774+778에 통합했다.
전체 통합 전 main e5871a4(PR772/773/776)를 보존했으며 기존 worktree·secret·실패 증거를 건드리지 않았다.

## D44 당시 통합 기능 검증 (후속 preview 인수와 구분)

실제로 검사한 제품 SHA는 **`d44a09a50d55132f9d035fead54b61a2c305a4cd`**다.
root는 frozen install부터 quick/build·guard 검사·live 작업 그래프 완료까지 같은 HEAD와
clean 상태를 유지했다. Bun1.4.0 / Node24.22.1 / canonical TMPDIR를 사용했다.
D44→요약head16c0264까지는 테스트·증거·문서만 변경했다. 이후 preview 인수 감사에서 발견한
리포트 읽기 폭 결함은 공통 CSS 후속으로 수정했으므로 현재 제품을 D44와 동일하다고 표시하지 않는다.

| 검사 | 실행 SHA / 결과 | 증거 |
| --- | --- | --- |
| `bun ci`, `validate:quick` | d44: EXIT0. 보안18·토큰4·mobile534·개편542·후반793 PASS, 기존4 SKIP·실패0 | [root receipt](./redesign-integration/summary-d44a09a.json); 원본 로그는 로컬 보존 |
| `validate:build` | d44: production/bundle·Workers dry-run·실제 local workerd 익명 login200 + 공통503/보안 헤더/script0 PASS | 같은 root receipt |
| 인증 guard·공통 로그인·archive mock | d44:21 PASS/0 FAIL/0 SKIP,466 assertions | 같은 root receipt |
| 원격 제품 CI | d44 Quality/native HTML·PDF SUCCESS | [Quality](https://github.com/creno-va/baro/actions/runs/42475501690), [native](https://github.com/creno-va/baro/actions/runs/42475501949) |
| `work:next`와 최신 main | d44: 실제 GitHub56 tasks/cycle0. 최신 main e5871a4 유지 확인 | 같은 root receipt |
| 독립 과업 Chromium/WebKit | d44:46 PASS/0 FAIL/0 SKIP·flaky0 | [05 검수 정본](./redesign-acceptance/README.md) |
| 계정 복구·권한/늦은 응답 | d44:15 PASS/0 FAIL/0 SKIP·flaky0 | 같은05 정본 |
| 자료·retained Workspace | d44:17 PASS/0 FAIL/0 SKIP·flaky0. 실제 File bytes·자료 반영·owner 명시 재열기 | 같은05 정본 |
| 실제 Astro 리포트 직접 URL | d44:10 PASS/0 FAIL/0 SKIP·flaky0. 320/390/1440·query/hash·편집/초안·자동전송0 | 같은05 정본 |
| 실제 Chrome UI 확대/한글 입력 | d44:200%(DPR4/inner600/outer1200) 가로넘침0, 실제 한글 조합/Enter 전송0·작업 왕복 보존. dirty 모달·초점·명시 저장 확인 | 같은05 정본의 실제 UI receipt/화면. 종료 후 ABC/100% 복원 |
| 공통503 문서의 no-JS/키보드/axe/CSS200 | renderer f4(제품 d44와 동일), test head f51:13 PASS/0 SKIP. 실제 Worker 검사는 위 d44 build와 구분 | [공통503 manifest](./redesign-integration/summary-d44a09a.json) |
| 기존 공통 레이아웃/상태 | 제품396: shell26 PASS, test-only dcf 수리 뒤 foundation18 PASS | [공통 manifest](./redesign-integration/summary-d44a09a.json) |
| 리포트 상태/후속 문서 | d77:19+직접URL10 PASS. resolution98은396에서 실행했으며 현재 SHA 실행으로 합산하지 않음 | [d77 receipt](./redesign-integration/reports-d77d42d/verification.json), [396 receipt](./redesign-integration/reports-396927f/verification.json) |

최종 네 브라우저 묶음은 각각 실행한 결과다. 공통13·이전 공통44·리포트98의 source/renderer
동일성은 재실행 성공과 구분한다. 원본 로그의 SHA256과 실패·성공 구분을 로컬 manifest 및 공개 요약에 보존했다.

## 실제 검사와 실패 이력

최종 결과는 후속 표/receipt에 기록한다. 다음 중간 결과는 최종 성공으로 옮기지 않는다.

- 기준선7236c14: 독립28개 중22 PASS/6 FAIL. 작업 진입·보존과 기존 변호사 액션 결함을 수집했다.
- 초기 통합c89:32 PASS/2 FAIL. 구 native 이탈 확인 기대를 실제 새 DOM 모달의 취소·작성 보존 검증으로 옮겼다. 실패 원본을 남겼다.
- 제품396927f: 독립44 PASS, 계정 회귀12 PASS/3 FAIL. 세 실패는 확정 owner 변경 시 편집은 purge되지만 설명이 없는 빈 리포트 영역이 남는 실제 결함이다.
- 같은396의 자료 내용 반영은 미전송 설명이 빈 값으로 바뀌는 결함을05가 독립 재현했다.02는 전체 페이지 이동을 보관된 작업 전환으로 교체했다.
- 공통396: shell26 PASS, foundation17 PASS/1 stale heading FAIL. 새 시작/목록의 실제 제목으로만 기대를 교정한 dcf2115에서18 PASS. 나머지 대비·44px·폭·키보드 단정은 유지했다.
- root 첫 quick396은 테스트 두 파일의 포맷 오류로 중단됐다. 의미/단정 변경 없이 교정한 b84c1c9의 quick EXIT0, c6e0573의 build/bundle/dry-run/local workerd EXIT0.
- d77d42d는 두 실제 보존 결함의 수리를 통합했다. 재검증과 후속 공통503 반영 결과는 최종 receipt로 구분한다.

초기 tmp alias·허가되지 않은 로컬 listen/Chrome 실행·동일 worktree의 Vite cache 경합도
제품 실패와 구분해 보존했다. 순차 서버/빌드·Node24·Bun1.4·canonical TMPDIR로 실행했다.
테스트를 삭제하거나 실제 실패·skip을 성공으로 바꾸지 않았다.

## 범위와 남겨 둔 일

1. 사용자 후속 선택에 따라 기존 계약을 유지한다. 설명→질문/요약 확인→자료 추가를 구현했으며,
   문서 단독 시작과 최초 질문의 업로드 문서 반영은 미완료 목표다. 새 admission API/DB를 만들지 않았다.
2. 작업 전환의 메모리 보존을 새로고침·전체 이탈 뒤 자동 저장이라고 표시하지 않는다.
   초안은 명시 저장/TXT만 지원하며 PDF/DOCX 자동 출력을 약속하지 않는다.
3. 기존 공개 프로필/자산 API·캐시·외부 복사본 폐기와 native의 전용 기능 전환은 이번 웹 UI 변경과 별도다.
   기존 계정 role 일괄 변경이나 원격 자산 삭제는 수행하지 않았다.
4. 기준 리포트가 바뀐 옛 문서 초안은 최신 초안으로 표시하지 않는다. 안전한 영구 비교/복구 계약은 추가하지 않았다.
5. 합성 계정/실제 SQL·HTTP transport·로컬 Workers 검사는 실제 OAuth·모델/법률 공급자·원격 저장·실기기/독립 법률 인수와 구분한다.
6. 기존 native PDF의 P3 표현 차이를 남긴다. source c2ed79e의 native9쪽 중8쪽에 소제목 Markdown과
   일부 emoji fallback glyph가 그대로 보인다. HTML 인쇄10쪽의9쪽은 정상이며 텍스트/출처 손실·
   clipping/overlap은 발견되지 않았다. 출력 의존성이 d77과 동일함을 비교했으며 이전 생성물을
   최종 SHA에서 생성했다고 표현하지 않는다. [05 PDF receipt](./redesign-acceptance/pdf-c2ed79e/receipt.json)에 원본 해시/쪽 수를 보존한다.
7. 비용 관측 전용·ledger/hold·AI200/일·질문2×3·실제 기술 용량, Workers·모델/법률 호출 경계,
   인증/권한·암호화·개인정보·출처·리포트 버전/CAS를 유지했다.

## 원격 게시 승인과 이력

처음에는 자동 승인 검토가 독립 QA 원본의 특정 payload/destination 게시 승인 부재를 이유로
원격 push를 거부했다. 총괄은 원본을 대신 게시하지 않고 테스트/내용 없는 요약만 head16c0264에
반영했다. 이후 사용자가 QA 채팅의 구체적인 게시 질문에 **게시 승인**으로 응답했다. 총괄도
원래 사용자 메시지를 읽어 합성 QA 코드·스크린샷·PDF·압축 결과, creno-va/baro 저장소,
지정 브랜치와 통합 브랜치 대상 Draft PR이라는 승인 범위를 확인했다.

승인된 원본 head63c3092는 [PR781](https://github.com/creno-va/baro/pull/781)로 게시됐다.
총괄은 최종 artifact19개와 실행한 테스트 소스의 SHA256 일치를 다시 확인하고 원본을 통합했다.
원본 증거 게시 당시 제품은 D44와 동일했다. 이후 읽기 폭 수정은 아래 후속 감사로 구분한다.
과거 거부/실패 기록과 로컬 원본은 보존한다.
이 승인은 제품/main 병합·배포, 실제 공급자 호출이나 새로운 데이터 게시로 확대하지 않는다.

전체 독립 검수 정본은 [QA 보고서](./redesign-acceptance/README.md)와
[최종 manifest](./redesign-acceptance/final-d44a09a/manifest.json)다. 로컬 원본도
`codex/764-independent-final-acceptance` / `63c3092e32d37249a0975f82b9afe8ed3e10a301`에
그대로 남아 있다. 총괄의 별도 전체 로그/503 캡처는 계속 로컬
`codex/764-redesign-local-evidence`와 `/private/tmp/baro-redesign-00-d44-*.log`에 보존한다.

## preview 전 전체 회귀 감사 후속

사용자 추가 지시의 최종 main full·동일 SHA preview 전에 이전 full 실패와 현재 테스트를 대조했다.
02의 test-only c9a2171은 제거된 변호사 링크 양성 기대를 현재 네 작업/명시 실행·연락0으로 고치고
응답 실패/재시도·체크·타임라인·원본 bytes·취소·삭제 전체 과업을 유지했다. 해당2개 PASS,
판례 비교 전체 과업은 기존740 제품 그대로1 PASS/axe[]로 현재 색 대비 결함이 재현되지 않았다.

03의 PDF footer 조사에서는 고정170px/desktop compact가 확정 공통 계약이 아님을 확인했다.
단 desktop 리포트 일반 문단1056px·읽기1120px가 확정48rem을 넘는 실제 결함을 발견했다.
01 원본4bcc0f6(총괄716a891)은 reports.css의 읽기/본문/내보내기 영역을 기존 --reading-width로
제한하고 같은 폭으로 정렬한다.1440px에서 읽기/본문/footer/button768px·일반 문단704px로
복원했고390/320의 모바일 배치·54px 조작·focus·가로넘침0은 보존했다. 새 API·저장·native PDF 변경은 없다.

03 전체 리포트 회귀의 설정 axe는 비활성 회색에서 활성 destructive 배경으로 전환하는 동안
글자색만 즉시 흰색이 되는 실제 대비 위반도 검출했다.01의 원본3f7823f(총괄bb4c939)은 공통
Button의 background 보간만 제거하고 border 전환·색 토큰·disabled 의미를 유지한다.
실제17프레임의 최소 대비는1.0955에서6.5743으로 개선됐다. 공통19/19는제품3f7823f에서,
리포트10/10·긴본문layout2/2는제품322c088에서실행해통과했다. 기존axe기대는변경하지않았다.
기다림 추가·axe 제외·기준 완화는 없다.

최종 제품 검증은 이 두 공통 스타일 수정 뒤 고정한 **main의 실제 SHA**에서 수동 full(core/browser/native/join),
같은 SHA preview와 제한 smoke를 통과해야 한다. 결과 정본은 [#751](https://github.com/creno-va/baro/issues/751)의
후속 receipt이며 D44의 과거 통과 수를 새 main에서 실행했다고 재사용하지 않는다.

## 최종 전체 회귀 수리 — PR787

main `74396a4d3754cb0a05dbd47d3335ee9612ec416e`의 수동 full
[42492794662](https://github.com/creno-va/baro/actions/runs/42492794662)는 실패했다.
core의 공개 Git blob ID 오탐은 PR782에서 정확한 세 fingerprint만 검증해 수리했다.
native는 성공했지만 browser는 60분 경계에서 취소됐고 join은 실행되지 않았다.
68개 실패 제목과 미실행 범위를 보존했으며 이를 최종 인수로 세지 않는다.

[PR787](https://github.com/creno-va/baro/pull/787)은 현재 main을 기반으로 각 지정 소유자의
수리와 전체 회귀 기대를 통합한다. 실제 제품 결함은 비동기 자료 확인 뒤 opener 초점 복귀,
200% 확대의 긴 제목/입력 공간과 열린 도구 메뉴 위치, 판례 토픽 label cascade,
embedded 리포트의 heading 순서다. owner 검증·busy 상태·현재 revision·출처·CAS·저장 계약은
유지한다. 테스트는 명시 업로드, 네 작업, 실제 SQL/HTTP, 실패/재시도·삭제·원본 bytes와
키보드/기하/axe 검증을 유지하며 현재 UI와 실제 사용하는 reader에 맞춘다.

| 소유자 검증 | 실제 검사 head / 결과 | 구분 |
| --- | --- | --- |
| 01 공통 레이아웃 | `ae0d01269896b05ca3a4690b94fce786ad16b4df`, 실제 Astro 5·shell 26·판례 15·공통 프리뷰 19 PASS | 65개·skip0. 후속 `e4bbb1e`는 테스트 지역 변수 이름/포맷만 정리하며 제품 source 불변 |
| 02 자료·대화 여섯 suite | `7d9fd818bca3ccb99f4a5d8e76edf2754e68086e`, 90 PASS·quick EXIT0 | 제품 변경 없는 회귀 수리. 기존 `1400cf2`의 실제 초점 수리도 통합 |
| 03 리포트·초안 | `2276ed12cda35de5909b7e6ffe3fdbe02447f821`, 표준 dispatcher 9 + 직접 URL 2 PASS·quick/build EXIT0 | draft revision 본문 불변, 기존 HTTP fixture config 연결. 실제 heading 수리는 canonical h2 한 줄 |
| 04 목록·자료 교정 | `e13057969865fa67ded927a28370b16434478de3`, 11 PASS·quick EXIT0 | 실제 SQL 생성/재조회, 원본 음성 재생·편집·signout 제거 유지 |
| 05 독립 runner | `53bd2baacedb5de360f2a803137a4545ccf1617f`, repo 밖 cwd에서 Chromium/WebKit 46 PASS·quick EXIT0 | repo-root cwd/tmp 경로만 수정. 본문 SHA256 `3b2294b14c897bf262466c90b115c7f0be285219218a3117cb30613403fec0fa` 불변 |

위 결과는 각각의 source head 검증이다. 최종 합쳐진 main에서 다시 수동 full의 모든 section과
join을 통과해야 한다. 독립 46개의 JSON/합성 화면은 별도 artifact로 보존해 실제 checkout SHA,
본문 hash·양쪽 브라우저 결과를 확인한다. 기존 journeys artifact의 경로 구조는 유지한다.

총괄의 `4c891b4` 로컬 quick은 localhost listen이 막힌 첫 실행을 보존하고 허용된 환경에서
EXIT0으로 확인했다. 별도 build 두 요청은 자동 검토 시간 만료로 process 생성 전에 끝났으며
실행/통과로 세지 않는다. 소유자의 실제 build 결과와 최종 정확 main의 full build를 구분한다.
05의 추가 수동 첨부 재현은 Chrome 확장 file-URL 설정 오류로 완료하지 못했으며 설정을 바꾸지 않았다.
최종 실제 Chrome 확대·한글 입력 등 독립 검수와 이 도구 제약도 별도 receipt에 남긴다.

오래된 로컬 mock 사건의 PDF 활성 상태 변화는 당시 source hash/binding/revision을 보존하지
못해 원인을 확정하지 않았다. 새 합성 사건에서는 source hash/binding 일치·명시 편집 저장 뒤
PDF bytes를 확인했으나 이를 이전 관찰의 원인 규명으로 표현하지 않는다. 실제 외부 공급자 인수,
문서 단독 시작과 기존 native PDF P3 표현 차이는 앞의 보류 범위를 유지한다.

## 실제 Chrome 확대 후속 — 메뉴 재열기

PR787 병합 main `01af2d1f133c128a6b9b4a9aa4ec16fad96d3d73`은 push CI/native 출력 검사를
통과했지만05의 실제 Chrome200%에서 새 P2가 재현됐다. CSS viewport600×350/root CSS zoom1,
40자 합성 제목에서 머리글 End→도구 열기→첫 링크 Tab→Escape→재열기 뒤 첫 요약 링크의
중심점이 sticky 상단 바에 가렸다. 메뉴16~202px/트리거104~148px/첫 링크21~65px와 상단
바0~56px를 기록했고 총괄도 원본 화면을 직접 확인했다. 이 SHA를 preview에 배포하지 않는다.

공통 담당01이 메뉴의 실제 가용 영역·작은 높이와 정확한 재열기 순서를 수리하고05가 실제
Chrome에서 재검수한다. root CSS 확대와 실제 브라우저 확대를 구분하며 기존 폭·기하·44px·
키보드·초점/작성 보존 단정을 유지한다. 현재 수동 full42505489653은 추가 회귀 수집을 위해
계속 실행하되 성공해도 이 독립 UX 결함의 인수를 대신하지 못한다. 후속 검증 PR의 새 main과
동일 SHA full/preview/smoke가 필요하며 결과는 #751 receipt에 기록한다.

후속 source `5e7ee6c72fd4035d8e301eb4b5e3d1048cccde08`은 고정 탐색을 뺀 실제 가용
사각형에서 메뉴 아래·위 공간을 비교한다. 작은 높이에서는 메뉴만 스크롤하며 전체 높이를
측정하려고 임시로 확대해 scrollTop을 초기화하지 않는다. 메뉴 내부 스크롤은 재배치와
구분하고 현재 링크는 메뉴 안에서 완전히 보이게 한다. visualViewport scroll도 관찰하며
기존 details/이름/href·Escape/초점 복귀·도메인/API 계약은 유지한다.
summary의 활성화 안에서 native open property와 첫 위치를 함께 적용해 늦은 toggle 이벤트
전에 링크의 실제 좌표를 확정한다. 링크에서 온 클릭은 이 처리에서 제외해 기존 href를 유지한다.

추가 actual-Astro 회귀는 같은40자/600×350·DPR4/root CSS zoom1과 물리 포인터 순서를
검증한다. 250·200px 높이, 네 링크44px 전체 노출·중심점 hit·Tab·마지막 링크 초점을 둔
resize/root 배율/머리글 스크롤·작성 보존과 pageerror0도 검사한다. 기존65 기대는 유지한다.
후보의 실제 native Chrome 재현과 기존 회귀·quick/build, 새 통합/main SHA 결과는 구분한다.
원본01af의 동일한 빠른 CSS 배율/머리글 순서에서도 ResizeObserver undelivered 경고1회가
재현돼 원본/후보 비교 로그에 남겼다. 이를 새 수리의 회귀로 단정하거나 검증에서 숨기지 않는다.

## 전체 코퍼스의 마지막 mock 묶음

main01af의 full42505489653은 core/native 성공 뒤 browser25개 실패·join SKIPPED로 끝났다.
첫743 full의60분 취소 뒤 미실행이던 마지막 mock 묶음이 포함된다. 원본 로그와25개 제목을
보존하며, 기존 앱390px 첫 hit1개는 후속 초기 배치 수리와 대조하고 나머지는 현재 main920ed에서
재현해 실제 제품/fixture/현재 UI 기대를 구분한다.02는 대화 시작·workspace 테스트17개 실패,
04는 shell 통합6개와 기존 human review1개 실패를 전담한다. 공통 제품은01 소유를 유지한다.
장문·원본 bytes/PDF·권한/owner epoch·늦은 응답·file picker/초점·반응형/44px·실패/재시도
단정을 보존하고 추가 수리의 새 main에서 전체 검증한다. 현재920ed full의 결과도 별도 기록한다.

후속 원본01 `33010036ad1eb58495cad2a16a1f0b4e4da7a999`는 raw composer의 domain 규칙과
동일 specificity였던 레거시 fallback을 `:where`로 낮춘다. canonical Textarea의 ui-input/ui-textarea
제외와 bare textarea의 기존220px fallback은 유지한다. 실제 stylesheet 순서를 뒤집어 기존220>140
실패와 수정 후140px 상한·16px 글자·44px/실제 hit/axe를 대조했다. foundation 포함21 PASS다.
02 최종 `deb85d3fb56069ecbe0b8f8e3ebf51ed35c919e6`의 workspace90+conversation12,
04 최종 `81ce728632a90b80a56f63debea6ef1f08a571f3`의 shell9+human6은 SKIP0으로 통과했다.
닫힌 native details의 비표시 자식 좌표와 실제 가시 overflow를 구분하며 root 폭·모든 열린 링크의
44px/viewport/hit/키보드 단정은 강화했다. 동의·원본 bytes·권한·늦은 응답·초점 회귀는 유지한다.

03 최종 `ad697de69f7e48f231eed750c34e51d44b695745`는 명시 재생성 전 저장한 수정 본문도
기존 임시 보관에 남긴다. 네 작업 왕복·TXT bytes·중복 덮어쓰기 차단과 계정 변경 purge를 검증한다.
새 v3는 현재 준비된 분석과 hash/scope가 같을 때만 mock binding을 회복한다. v2 수정본의 기존
immutable 이력은 남아 있으며 영구 유실로 분류하지 않는다. 서버의 userEdited 차단·현재 JSON과
알려진 ID의 HTML/PDF 계약은 그대로이며 영구 이력 UI/API는 추가하지 않는다. 초안 안내는 사실 확정과
본문 수정의 차이를 설명한다. React 발췌는 기존 안전한 Markdown renderer로 h4/list를 읽게 하며
불확실성·400자 한계·전체 본문 이동을 보존한다. native PDF의 기존 P3 잔여와 별개다.
원본69 domain/reading·브라우저34(5+19+6+모달4) PASS/SKIP0, 최종 typed-fixture 보완 뒤
quick/build와390/1200px 실제 v2→v3→네 작업→현재 기준 미검토 초안→TXT2 PASS를 구분해 기록한다.
통합 후보와 새 main의 full/preview 결과는 이 소스 단위 결과를 대체해 별도 정확 SHA로 남긴다.

## 초기 메뉴와 지연된 모달 닫힘의 추가 수리

main920ed full42508889497은 core/native 성공·browser24 FAIL·join SKIPPED로 종료했다.
23건은 앞의02/04 후속 범위이며 나머지는 actual-Astro1440의 첫 captured-point hit 실패다.
01의 일반 로컬8회는 통과했지만 실제 Workspace 클라이언트 모듈을 hold한 서버 HTML에서
open=true/ssr=true/style=null인 메뉴의 기본16,72 좌표가 왼쪽 탐색에 가리는 것을 재현했다.
CI 당시 DOM은 없으므로 두 관찰의 원인 동일성은 추정으로 구분한다. 기본 CSS는 native summary
흐름 위치·오른쪽 여백을 사용하고 측정 뒤에는 기존 계산 좌표를 적용한다. 초기화 전의 실제 링크와
초기화 후 같은 captured point/open 상태·네 링크44px/hit를 검사하며 첫 클릭 전 준비 대기로 덮지 않는다.

첫 통합bab6f9a03ee61268dac7abbc3c794afbc5f9acae의 ci/quick/production/bundle/dry-run과
committed-history scanner는 통과했지만 합성 브라우저141개 중140 PASS/1 FAIL로 끝났다.
02가 원본 Home 키보드 제출 검사를 그대로20회 실행해7 FAIL/13 PASS를 재현했다. hydrated=true에서
submit focus→native close→Dialog restoreFocus/onClose→설명 입력창 Enter/줄바꿈의 인과를 기록했다.
CaseInput/Dialog과 검사 본문은920/deb85/bab6에서 같았다. 이는 새 리포트 source의 회귀로 분류하지 않는다.
진단 hook의 전역 첫 submitDisabled 값은 닫힌 제목 수정 모달을 가리켜 근거에서 제외했고 원본을 보존했다.
01이 controlled close 직후 정상 복귀를 한 번 수행하고 queued close에서는 상태만 동기화하도록 수리했다.
정상 invalid-field 복귀와 새 명시적 submit 초점 보존을 독립 회귀로 검사하고 원래20회도 재검증한다.
공통 소스·회귀는01, 원본 Home 독립 반복은02, 리포트 미지원 모달 C/W4는03, 통합·문서는 총괄 소유다.
두 공통 수리와 독립 회귀의 원본은 `114bbace8030ed89d295c72f5451f7fda063e0e7`이며
이미 통합한330의 후속1커밋이다. 정상/새 초점 회귀의 Chromium·WebKit 예비 통과와 최종 통합 검증은 구분한다.

추가114의 원래5폭×4회 first-hit 검사에서는15 PASS/5 FAIL(320px3·390px2)을 발견해 PR789를
Draft로 유지했다. 통합a1a1d2c의143+메뉴9·독립모달4와 fresh PR CI3개 통과로 이 실패를 덮지 않는다.
짧은 로딩 제목이 실제 긴 제목으로 바뀌며 ResizeObserver가 이미 열린 메뉴를24px 아래로 옮겼다.
390px 실제 module hold에서도 최초 open/point hit→release→SSR0→실제 긴 h1 표시→header ResizeObserver
delivery 뒤 같은 point(266,307)가 이동한 유사 판례(top313)를 놓치는 것을 재현했다.
후속은 제목을 즉시 표시하면서 열린 메뉴의 기존 대상을 보존하며 명시적인 viewport/root 배율·
ancestor scroll·재열기는 재배치한다. private 제목 캐시나 준비 대기로 실패를 숨기지 않는다.
후속 소스와 새 frozen head의 관련 반복·통합·CI 결과를 확인한 뒤 병합하며 아직 preview에 배포하지 않는다.
후속 원본 `efced2e1df2f57a1a03ee75ecbaccbabb61d4965`는114의 자식1커밋이며 제목-only
ResizeObserver와 같은 열림의 queued toggle을 구분한다. 현재 prop만 배치 revision 감지에 쓰고
현재 제목/tooltip을 즉시 렌더한다. 390 결정 재현과 원래20회의 수정 전후를 보존하며 예비20/20
통과 뒤 해당 커밋의 전체 공통 회귀·quick/build와 새 통합 head/CI를 별도로 검증한다.

초기 수동 기록의 message counter 두 selector는 실제 Workspace 사용자 메시지 class와 달랐다.
그0만으로 자동 전송이 없었다고 판단하지 않는다. 원본은 보존하고 exact920에서 실제
`.workspace-message--user`로 입력/Enter/네 작업 왕복7상태의 사용자 메시지0과 한글·줄바꿈 보존을
새로 기록했다. 독립46 자동 검사의 원래 올바른 selector·양성 대조·본문 hash는 유지했다.
최종 통합/main의 성공 여부는 이후 정확 SHA의 raw receipt·full join·동일 SHA preview로 판정한다.

## 합성 질문의 중복 관찰과 실제 서버 경계

PR789는 ea59340d5b3fce49469863d3457f118829455472의 새CI3개와 필수 검사·통합143·메뉴10·
독립모달4 및 원본 공통72/반복20 인수 뒤 main9a859e5f86cd9230bbf8435083723d71345d5c40에 병합됐다.
두 트리는 동일하다. 이 main의 직접 Chrome 검수에서 문서 없는 형사 대응의1차2번 주장 질문에
구체 주장을 모른다고 답했는데2차1번이 같은 상대방 발언을 다시 물었다. mock/rework의 대응
질문 치환과 mock/cases의 고정2차 템플릿 조합으로 재현되는 합성 모드 결함이다.

실제 backend는 별도 경로로 모든 저장 질문/답변을 context에 넣고, generation prompt와 독립 audit가
unknown/skipped 포함 재질문을 금지한다. pipeline은 NFKC/공백 정규화 일치 중복 제거와 전부 반복 시
bounded1회 재생성, audit 거절 시 publication 차단을 수행한다. 의미가 같은 다른 표현은 기계적
문구 필터만으로 보장하지 않으며 generation/audit에 의존한다. 이 mock 관찰로 실제 모델의 같은
실패 또는0중복을 판정하지 않는다. 새 topic DTO·API·DB·모델 호출 계약은 추가하지 않는다.

02가 새 mock batch 생성 단계의 후보 선택과 관련 회귀만 수리하고 이미 저장된 질문 ID/답변/과거
batch는 바꾸지 않는다. 원본 중복과 네 경로·unknown/skipped·소유권·저장 보존·질문 한도를 함께
검사한다. root의9a 직접 검수는 실제Chrome200%(600×350/DPR4/rootCSS1), 한글 입력기 Enter/사용자
메시지0·네 작업 왕복 입력 보존, 열린 메뉴4링크44px와상/중/하hit를 확인했다. native AX 활성화는
header scroll을0으로 돌렸으므로 원래 raw-coordinate 포인터 재현을 직접 검수했다고 주장하지 않는다.
setup 좌표 오작동·입력기 전환 중 첫 키 관찰도 원본 receipt에 남겼다. 확대100·원래영문입력 복원과
자기 탭2개 종료,소유4850서버 종료를 확인했다. 이 증거와9a full을 후속 main의 새 검사로 표현하지 않는다.
02 원본 `e047105d3e733d0d44b280cdb51d73a4ba642c0d`는 mock 생성부와 새 회귀2파일만 바꾼다.
정규화한 고정 질문과 알려진 두 주장 문구를 이미 물은 항목으로 취급해 새 후보만 제외하고,
필요할 때 대응 이력·목격자·직접 경험/전해 들은 내용의 고정 후보를 고른다. 저장된 문항과 답변은
그대로이며 ID는 선택한 새 질문에만 만든다. 최초 새10개 중6개 RED와 수정 후 신규11/기존21개의
focused32 PASS를 구분해 보존한다. 이후 동일 소스·새 통합 head의 필수 검사/브라우저/CI와 새 main
full/preview를 별도로 기록한다. 이 고정 템플릿 수리는 최초 설명의 모든 사실이나 임의 문장 사이
의미 중복을 판정하는 구현이 아니다.
