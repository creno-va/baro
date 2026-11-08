# BARO 웹 전면 개편 통합 인수

현재 사용자 직접 지시의 다섯 지정 세션을 별도 checkout/codex 브랜치로 조율하고 통합했다.
결정·소유권·두 정보 구조 비교·상태 보존·전체 경로 계약은
[실행 계약](../development/REDESIGN-EXECUTION.md), 공통 API는
[FOUNDATION](../design/FOUNDATION.md), 결정은 [ADR0021](../adr/0021-case-workbench-and-web-design-system.md)을 따른다.

제품 검사 SHA와 문서/증거 커밋을 구분한다. 정확한 SHA·명령·환경·로그 해시의 정본은
이 문서와 연결된 JSON receipt다. 같은 화면의 캡처만으로 합격을 선언하지 않는다.
main 병합·preview/production 배포는 이번 작업에서 수행하지 않았다.

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
| 05 독립 | 최종 검수 PR 후속 기록 | 제품 코드0·baseline/중간 실패·최종 정확SHA 합성 과업과 실제 UI 증거 |
| 총괄 | [778](https://github.com/creno-va/baro/pull/778) | 제품/ADR/실행 정합성, 공통 로그인·mock 정합성, 통합 충돌·전체검사·접근실패 HTML 연결 |

01 이외의 공통 변경은01 원본 커밋의 소비다. domain PR에는 선행 소비 diff가 포함될 수 있으므로
각 작업자의 새 소유 변경과 구분해 검토했다. 중복 cleanup Draft777은 닫고774+778에 통합했다.
전체 통합 전 main e5871a4(PR772/773/776)를 보존했으며 기존 worktree·secret·실패 증거를 건드리지 않았다.

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
   최종 SHA에서 생성했다고 표현하지 않는다. [05 검수 기록](./redesign-acceptance/README.md)에 원본 해시/쪽 수를 연결한다.
7. 비용 관측 전용·ledger/hold·AI200/일·질문2×3·실제 기술 용량, Workers·모델/법률 호출 경계,
   인증/권한·암호화·개인정보·출처·리포트 버전/CAS를 유지했다.
