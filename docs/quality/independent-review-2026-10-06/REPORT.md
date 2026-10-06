# BARO 독립 통합 검토 · 2026-10-06

검토 시작 21:41 KST, 최종 GitHub 재확인 21:59 KST. 60분 제한 내 독립 수행. 새 chat·Goal·추가 agent 없음. A~E 제품 파일을 직접 수정하지 않고 독립 검증과 재현 기록만 작성했다.

고객/변호사 각각의 **동일 제품 UI mock 완주**는 통과했다. **다른 탭의 계정 전환 후 이전 owner 내용이 남는3건** 때문에 계정 전환을 포함한 M0 통합 완료로 판정할 수 없다. 실제 외부 OAuth·AI·OCR/ASR·R2·원격 cleanup 성공은 검증하지 않았으며 #70/#71 및 기존 P0.3 공개 gate를 유지한다.

## 기준과 GitHub 상태

AGENTS.md, README.md, EXECUTION.md, PARALLEL-UI-SPRINT.md, CLIENT-API-CONTRACT.md를 읽었다. 설치된 Bun1.3.14 경로를 찾아 `bun run work:next`를 실행했다. #101~#106 본문/최신 댓글과 아래 PR의 실제 head/base/CI를 조회했다. 시작 원문 snapshot은 같은 폴더의 `issue-*.json`, `pr-*.json`, 최종 상태와 최신 댓글은 [final-status.json](./final-status.json)에 있다.

브라우저 실행은 A candidate `dc22c26ac0e3021ac9ae99bedd71099530efe82b`에 고정했다. 시작 candidate `4ae3aab`에서 최신 E/D 수정(PR118)을 받았다. 후속 `fde4f2c`와 `539a3cc1771b0c28bafe01272cab75fff77e48f9`는 기존 browser fixture/config 수정이며 본 검토의 제품 소스가 동일함을 diff로 확인했다. 원격 후보가 계속 갱신되므로 이 SHA 뒤의 제품 변경에는 결과를 자동 적용하지 않는다.

| PR | 확인 상태 | 통합 의미 |
| --- | --- | --- |
| #100 | main MERGED, head1bce704, CI SUCCESS, merge b6cfdfe | 기존 real workspace backend 사용 가능. 외부 성공 증거 아님 |
| #110 | main 대상 OPEN, 최신 확인9dda100, CI 진행 중 | 실제 통합 후보. 검증 실행 기준은 dc22c26/539a3cc. UI main/preview 완료로 표시하지 않음 |
| #111/#112/#113 | A branch에 MERGED; 각 PR 당시 CI 실패 | D/C/E stacked 병합. main 병합/green으로 취급하지 않음 |
| #115 | main 대상 OPEN, head7cc4e28, CI FAILURE/BEHIND | B 소스는 A merge에서 확인. standalone 상태와 분리 |

`dc22c26`의 CI는 타입이 아니라 기존 `analysis.e2e.ts`4개에서 실패했다(run37465349621). A가 이후 fixture/config를 보완했다. 최종 `539a3cc` [run37466327829](https://github.com/creno-va/baro/actions/runs/37466327829)은 C 공통 UI 검사 `workspace-shared.e2e.ts:17`에서 로그인 후 consent 대신 login에 남아 실패했다. 원격 CI 관측이며 본 독립 검사에서 재현한 신규 제품 blocker로 중복 등록하지 않는다. 최소 확인 위치는 C의 login 초기 hydration 대기와 전용 mock server 설정이다. 독립 4350 검사의 같은 로그인은 통과했다.

최종 인계 직전 A가 `9dda100`으로 AuthButtons의 hydration 전 제어를 보완했고 [CI run37466884899](https://github.com/creno-va/baro/actions/runs/37466884899)가 진행 중이다. 이 commit의 변경은 `src/components/AuthButtons.tsx` 하나이며 아래 계정 전환/real 재시도 결함의 소스는 동일하다. 이 head의 전체 browser를 실행했다고 주장하지 않는다. 앞선 C login CI 실패를 새 제품 blocker로 올리지 않는다.

과거 session 반환/type generic/E narrowing/facade cache/E role 연결 문제는 수정 코드와 최신 댓글을 확인했으므로 새 blocker로 등록하지 않았다. CSP 후속 PR119는 별도 담당자가 수정했고 [원격 CI SUCCESS](https://github.com/creno-va/baro/actions/runs/37466069757)를 확인했다. A 후보 통합은 별도이며 기존 CSP 결함을 신규 blocker로 올리지 않는다.

## 독립 검증 결과

실제 제품 페이지와 공통 facade/runtime만 사용했다. 별도 mock UI·사건 fixture 주입·제품 API alias 없음. browser는 실제 `/api/` 요청을 차단했다. real API 검사는 합성 signed session/SQLite 또는 합성 HTTP 대역이며 실제 공급자 호출이 아니다.

| 검사 | 결과 |
| --- | --- |
| 고객 login/consent→create→질문 모름/건너뛰기→reload/resume→요약 확인→workspace | 통과 |
| 대화 실패→reload→재시도, 파일 part 실패→재시도→ready→reload | 통과 |
| B/C/D의 동일 case id, 현재 owner 및 facade workspace revision | 통과 |
| 리포트 편집/마스킹 저장→reload, PDF/선택 원본 ZIP→사건 삭제→reload/접근 차단 | 통과 |
| 변호사 login/consent→프로필 저장→reload→공개→검색→동일id 상세→비공개→reload/검색 제외 | 통과 |
| 두 탭 리포트 및 변호사 프로필 stale revision 충돌/최신본 복구 | 통과 |
| workspace 변경 뒤 report stale, 삭제된 자료의 오래된 ZIP 선택 다운로드 차단/재조회 | 통과 |
| report save commit 뒤 합성 응답 유실→같은 버전 재시도 | 통과. report revision2 유지 |
| 계정 삭제→본인 case/files/session 제거→새 login id, peer lawyer profile 보존 | 통과(mock) |
| 다른 owner case/workspace/files/report 조회 | 데이터 반환 없음. workspace만 NOT_FOUND 대신 UNAVAILABLE 결함 |
| 계정 전환 뒤 이전 owner 화면 purge | report/summary/workspace3건 실패 |

브라우저12개 중8개 통과/4개 실패 assertion(제품 결함3건). 합성 real boundary4개 중 route 상태 기록1개 통과, metadata cleanup1개 및 intake retry2개 실패. source 결과의 stack·인증 cookie·token·SQL 출력은 증거에 넣지 않았다. 타입/tools tsc 및 독립 파일 Biome 검사를 수행했다. 제품 build/Worker/전체 corpus를 중복 실행하지 않았고 CI 상태는 별도로 기록했다.

## 시연을 막는 결함

### M0-1 · D/#105: 다른 계정으로 전환해도 이전 고객 리포트 유지 (P1)

- 재현: 고객 탭1에서 `/cases/{id}/reports`를 열기 → 같은 browser context 탭2 `/login`에서 변호사 선택/login/consent → 탭1 복귀.
- 예상: 기존 owner 본문·자료·편집·미리보기·다운로드 선택을 숨기고 재인증/접근 오류 표시.
- 실제: 6초 뒤에도 이전 고객 textarea와 편집/다운로드 UI가 남는다. API 재조회는 거절한다. 새 조회로 타인 데이터를 반환한 결함은 아니다.
- 최소 수정: `src/components/reports/ReportReview.tsx:59` mount-only load에 owner/session 변경·focus/visibility 검사; `run`의 접근 거절도 전체 state purge. 현재 `load` catch는 report/files만 일부 지우며 mutation catch는 error만 저장한다.
- 증거: `evidence/account-switch-report.png`, 독립 test `switch account in peer tab hides former owner's report before further actions`.

### M0-2 · B/#103: 미확인 요약 화면이 계정 전환 후 유지 (P1)

- 재현: 고객 질문을 끝내고 요약 확인 전 `/summary`에서 정지 → 탭2 변호사 login/consent → 요약 탭 복귀.
- 예상: 이전 owner 요약과 수정/확인 상태를 숨긴다.
- 실제: textarea의 고객 요약과 수정/확인 UI가 그대로 남는다.
- 최소 수정: `src/components/intake/SummaryReview.tsx:21` load/실패 경계와 `:36` lifecycle에서 owner 재검증, item/summary/checked/confirming purge. CaseList/IntakeQuestions의 같은 경계는 담당자가 함께 확인할 필요가 있으나 독립 재현 없이 추가 blocker로 올리지는 않았다.
- 증거: `evidence/account-switch-summary.png`, 독립 test `switch account in peer tab hides former owner's intake summary`.

### M0-3 · C/#104: v1 fallback이 owner 거절을 UNAVAILABLE로 바꿔 workspace 유지 (P1)

- 재현: 고객 workspace에서 합성 대화 저장 → 탭2 변호사 login/consent → 고객 탭 focus/visibility refresh.
- 예상: NOT_FOUND 및 이전 case/messages/files/editor 숨김.
- 실제: v2 workspace404 뒤 v1 `/api/cases/{id}` fallback을 시도한다. mock에 없는 legacy 경로503이 UNAVAILABLE로 변환된다. Workspace.showError는 이 코드에서 이전 view를 보존하여 고객 대화/editor가 남는다.
- 최소 수정: `src/client/api/workspace.ts:178` fallback과 `src/client/api/mock/workspace.ts` legacy miss 경계. v1 정상 fallback과 일시적 서버 장애 시 편집 보존을 유지하면서 실제 owner/삭제 거절을 정확히 분류해야 한다.
- 증거: `evidence/account-switch-workspace.png`; 독립 owner API test와 focus refresh test 두 개가 같은 결함을 재현한다.

위3건 [A~E 인계 댓글](https://github.com/creno-va/baro/issues/101#issuecomment-6016591791)에 담당자/재현/예상·실제/최소 위치를 기록했다. 새 이슈·중복 blocker는 만들지 않았다.

## 실제 기능 미연결 및 M1 재시도 결함

| 항목 | 담당·기존 추적 | 독립 관측 / 최소 연결 위치 |
| --- | --- | --- |
| report 조회/저장/생성, PDF/ZIP | D/#66 | GET/PATCH/POST `/v2/cases/:id/reports`, GET `/v2/reports/:id/pdf`, POST zip 모두404. DTO adapter/mock만 있고 real renderer/API/router가 미등록. `src/client/api/reports.ts`, D reports service/API 및 A router 등록 |
| 타임라인 새 일정 / 자료 처리 재시도 | C/#65 | POST timeline 및 POST file retry404. 기존 timeline PUT과 자료 업로드/조회 API는 보존. C workspace/files service/API에 연결 필요 |
| 실제 이전 질문 batch back-edit / ACK job id 유실 복구 | B/C/#65 | 기존 최신 댓글의 미연결 항목을 유지. mock 성공으로 종료하지 않음; 추가 외부 검증을 수행했다고 주장하지 않음 |
| 실제 계정 삭제 후 역할 metadata | D/#67, A/#102 | 합성 SQLite에서 user 삭제 성공 후 `account-type:{owner}` preference가 남음. #105/#102의 기존 cleanup 요청이 여전히 미완료. `src/server/modules/deletion/service.ts:19`의 원자적 삭제/restore replay 경계에서 owner key 정리. 새 DB/migration 선행 불필요 |
| 실제 요약 저장/확인 commit 후 응답 유실 retry | B/#103/#65 · 신규 M1-R1 | 아래 재현에서 CONFLICT/writes1. `src/client/api/cases.ts` real saveSummary/confirmSummary의 original wire revision/body 및 pending replay 연결 |

M1-R1 재현: workspace revision5, summary revision2를 조회 → 첫 PUT save 또는 POST confirm을 서버가 commit하며 workspace revision6으로 증가 → 응답만 유실(UNAVAILABLE) → 같은 UI expectedRevision5와 입력으로 재시도. 예상은 원본 wire body/revision/key로 receipt replay 또는 안전한 본인 완료 확인이다. 실제는 fresh GET revision6과 UI5를 비교하여 CONFLICT를 던지고 두 번째 mutation은 보내지 않는다. 서버는 receipt replay를 먼저 확인하지만 client가 그 경로를 막는다. 합성 HTTP로 두 operation 모두 재현했으며 외부 성공 증거가 아니다. **기존 this.get/facade cache 해결 건과 다른 결함**이다.

[신규 B 재시도 인계](https://github.com/creno-va/baro/issues/103#issuecomment-6016660215). 정상 stale edit/다른 payload/계정 검사를 완화하지 않고 최초 wire request를 pending 동안 유지해야 한다.

## 후순위 개선

- D PDF 제목은 `src/components/reports/download.ts:144`의 `title.slice(0,32)`로 잘린다. 실제 case title보다 짧고 생략 표시가 없다. 합성 다운로드 렌더에서 확인했다. 줄바꿈 또는 명시적 생략 표시 개선은 전체 시연을 막지 않는다.
- 다운로드 PDF는 raster mock이며 검색/텍스트 선택을 지원하지 않는다. 유효한 합성 PDF 시연에는 문제가 없고 실제 renderer/#66의 인수 기준과 구분한다.

## 다운로드 증거와 실행

`evidence/synthetic-report.pdf`: PDF1.4/A4/1page, Poppler parse 및 PNG 전체 확인. 한글 본문·전화번호 가림 렌더 정상, 제목 축약은 위 개선으로 기록. `evidence/synthetic-originals.zip`: zipfile CRC 검사 통과, UTF-8 파일명과 합성 원본 bytes 일치. PDF의 식별정보 가림이 원본에는 적용되지 않는 안내/동작을 확인했다. 다른 형식에 확장자만 붙인 결과가 아니다.

실행 방법과 known-failure 범위는 [독립 검증 README](../../../tests/independent-review/README.md), machine-readable 관측은 [review-results.json](./review-results.json). 독립 실패 재현은 opt-in이며 기본 UI/Bun 테스트 선택을 수정하지 않는다. 제품/CI/main/preview를 직접 편집·병합·배포하지 않았다.
