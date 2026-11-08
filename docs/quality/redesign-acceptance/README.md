# BARO 독립 UX 검수 기록

현재 판정은 **인수 미완료**다. 개편 전 기준선의 통과 항목과 새 계약 미충족을 분리하며,
통합 후보의 실제 과업 검증을 기존 테스트 성공으로 대체하지 않는다.

## 검사 대상과 환경

- 기준 제품 SHA: `7236c14f88f21a64c5fe916a90779d7c238fff6d`.
- 검수 checkout: `redesign-05-review`, `codex/764-independent-ux-review`.
- 환경: 실제 Astro 7.3.5 페이지, `PUBLIC_API_MODE=mock`, `BARO_UI_TEST_FIXTURE=true`, loopback `127.0.0.1:4385`.
- Bun 1.4.0으로 frozen install/work 검사, Node 24.22.1로 Astro/Playwright 실행.
  Bun에서 발생한 로컬 Miniflare 연결 실패와 sandbox listen 실패는 환경 오류로 분리했다.
- 모든 사건·계정·파일은 합성이다. 실제 OAuth·모델·공식 법률 API·원격 저장 검증과 유료 호출은 없다.
- AGENTS/README/EXECUTION과 live `work:next`(56 tasks/no cycles, exit 0), #764·PR765 원문을 확인했다.
  ADR0019의 확정 제품 경계와 ADR0020의 Proposed 계약을 구분한다.
- 총괄의 현재 실행 계약은 `redesign-00/docs/development/REDESIGN-EXECUTION.md`다.
  총괄이 전달한 사용자 후속 범위에 따라 이번에는 설명으로 시작한 뒤 문서를 추가한다.
  문서 단독 시작·첫 질문 전 문서 반영은 미완료 항목이며 실패한 구현으로 세지 않는다.

## 기준선 자동 검사

Chromium와 WebKit 합계 **22 PASS / 6 FAIL / 0 SKIP**다. 세 과업의 실패를 두 엔진에서 각각 재현했다.
정확한 제품 SHA·테스트 소스 SHA-256·명령 조건·결과는 [기준선 receipt](baseline-7236c14/receipt.json),
원본 Playwright JSON은 [압축 원본](baseline-7236c14/results.json.gz)에 보존한다.

통과한 범위는 320/390/768/1024/1440/1920px 대화·빈 리포트 상태의 가로 넘침과 실제 조작,
같은 자료 패널 왕복의 미전송 문장/미업로드 선택 보존, 자동 전송/업로드 부재,
전체 페이지 이탈 취소 후 입력 보존, 대화 진입의 serious/critical axe 오류 부재,
기존 lawyer 계정의 본인 일반 사건 입력이다. 리포트 경로를 읽기만 했을 때 새 리포트·생성 receipt가
생기지 않는 것도 확인했다. 같은 트리 보존과 이탈 경고는 페이지 왕복·새로고침 복구를 증명하지 않는다.

## 기준선 문제

| ID | 심각도와 분류 | 재현과 기대 | 실제 결과와 증거 | 담당 |
| --- | --- | --- | --- | --- |
| UX05 01 | P1 확정 제품 경계 미충족 | 리포트 준비 후 직접 해결 선택 → 변호사와 해결. 지정 제목/본문/확인의 모달만 열고 이전 선택·편집·포커스 보존 | 모달 없음. 직접 해결 선택 해제, 변호사 선택 활성화, 공유 범위와 `/lawyers` 링크 노출. [화면](baseline-7236c14/modal-settled/evidence/lawyer-action.png), [선택 전후](baseline-7236c14/modal-settled/evidence/selection-before-after.json). 비동기 선택 완료 뒤 revision2/self→revision3/lawyer 확인. mock의 네트워크 mutation 0은 실제 제공자 경계 인수 증거가 아니다 | 03 및 총괄 전달 완료 |
| UX05 02 | P2 새 IA 전환 미충족 | 자료를 닫은 사건에서 대화·자료·리포트·문서 초안에 직접 진입 | 상시 네 작업 진입 없음. 리포트가 자료 패널/도구에 묶임. [화면](baseline-7236c14/evidence/missing-tasks.png). 새 계약 대비 실패이며 이전 계약의 회귀로 단정하지 않음 | 01·02·03 및 총괄 전달 |
| UX05 03 | P2 새 과업 경로 차단 | 미전송 문장과 선택 File을 둔 채 자료→리포트→초안→대화 왕복 | 첫 자료 주 작업 진입 자체가 없어 과업 수행 불가. 뒤 단계의 실제 데이터 유실은 미검증이며 유실로 단정하지 않음 | 02·03 및 총괄 전달 |

## 실제 화면 과업

IAB의 실제 UI에서 합성 Google 로그인·합성 동의 → 문서 없는 민사 대응 설명 → 최대2×3 질문의
모름 선택 → 요약 확인 → 사건 진입 → 파일 선택 → 명시 업로드 → 자료 내용/처리 범위 검토 →
원본 다운로드 → Escape로 원래 대화 복귀 → 리포트 열기/명시 준비 → 사실 정리 초안 준비·편집·
검토 저장·TXT 다운로드 → 리포트 본문 편집/저장(버전1→2)을 수행했다.

- 선택만 한 파일은 전송 전 상태이고 명시 업로드 전 자료 목록에 게시되지 않았다.
- 실제 받은 원본의 SHA-256은 선택 파일과 동일한 `0bfe70cdb06369d65cbcb50b6d8427a24da0782783f770ab8a43beb3db8f7ad5`다.
- 자료 검토를 닫은 뒤 미전송 문장이 남고 자료 확인 버튼으로 초점이 돌아왔다.
- 초안은 공식 법률 미확인 상태에서 사실 정리로 제한됐다. 저장 후 다운로드한 1,970byte TXT에
  직접 보완한 문장이 포함됐다. [출력 실물](baseline-7236c14/evidence/saved-fact-draft.txt)의 SHA-256은
  `69da1a2ba688d69261cb12980825c91dac00a4e82c89fb14a9f2a2017ad2b136`이다.
- 리포트 저장은 버전2와 직접 수정·원문 재확인 필요를 표시했다. 이전 기준 초안은 숨김/재준비 안내가
  표시됐으며 이를 이전 초안의 삭제로 단정하지 않는다.
- mock의 고정 질문이 입력에 이미 있는 날짜/상대 요구를 다시 묻는다. 실제 AI의 질문 중복 여부는
  이 대역으로 판정하지 않는다.

## 최종 통합에서 남은 검사

네 경로의 실제 분기·문서 없는 형사 대응, 긴/많은 자료와 정확한 출처 위치, 보조 근거에서 복귀,
리포트/초안 편집의 같은 트리 전환·커서/스크롤 보존, 새로고침·실패·충돌·재시도·owner 상실,
읽기만 한 초안 진입의 self 선택 PATCH 부재, 출처 절 전체 숨김 여부, 리포트 PDF 실제 출력 렌더,
실제 200% 확대·한국어 IME·모바일 가상 키보드는 아직 최종 통합에서 미검증이다.
현재 검사의 screenshot·axe·mock 저장 성공만으로 이 항목이나 전체 제품을 통과 처리하지 않는다.

## 리포트 수정 후보의 독립 재검증

별도 `redesign-05-candidate` checkout의 정확한 제품 SHA
`cb9764a7936513e9c773a4f76581d6636361430e`를 같은 실제 Astro/mock 조건의4386에서 검증했다.
첫 실행은 읽기 부작용2 PASS / 모달 준비 locator2 FAIL이었다.
새 공통 Section의 `aria-labelledby`가 이름을 제목으로 바꾼 사실을 실제 DOM에서 확인했으며
이 실패를 제품 모달 불량으로 세지 않는다. [첫 실행 receipt](candidate-cb9764a/receipt.json)를 보존했다.

해당 영역의 기존 이름/새 제목만 허용하고, 비동기 선택 변경이 끝난 뒤 상태를 관측하도록
검수 도구를 보완했다. 기대 모달 문구·기존 선택/저장 revision 불변·관측 요청0·확인 후 opener focus의
단언은 유지했다. 동일한 보완 검사를 기준선에서 실행한 결과2 FAIL이고 수정 후보에서는2 PASS다.
[보완 기준선](baseline-7236c14/modal-settled/receipt.json),
[수정 후보 receipt](candidate-cb9764a/semantic-rerun/receipt.json),
[선택 보존 실측](candidate-cb9764a/semantic-rerun/evidence/selection-before-after.json)을 비교한다.
첫 기준선 receipt의 선택 직후 snapshot은 비동기 완료 전이며 보완 실측이 최종 선택 변경 증거다.

이 결과는 해당 후보의 모달과 리포트 읽기 범위에 한정한다. dirty 리포트/초안과 같이 열린 경우,
숨은 화면의 owner purge/polling·정확한 출처 링크·통합 작업 왕복은 최종 통합에서 검증한다.
기존 main에 추가된 PR772를 포함한 최종 SHA의 결과로 확대하지 않는다.

## 재실행

`tests/browser/redesign-acceptance.config.ts`는 별도 Node 실행 Astro 서버를 기본4385에서 시작한다.
기존 격리 서버를 쓸 때는 `BARO_REDESIGN_URL`을 지정하고, 다른 checkout 서버의 검사에서는
그 서버의 정확한40자리 SHA를 `BARO_REDESIGN_SHA`로 함께 전달한다. `BARO_REDESIGN_RESULTS`와
`BARO_REDESIGN_OUTPUT_DIR`로 실행별 증거 경로를 분리한다. 단언을 완화하거나 실패를 skip하지 않는다.

기능 제품 코드는 변경하지 않았고 지정된 신규 검수 파일만 소유한다. 최종 통합 SHA는 총괄에게
받아 별도 결과로 추가한다. 이 기준선 검사는 최종 인수 선언이 아니다.

## 초기 전체 통합의 추가 검수

제품 `c89b30d789af5123a2735b6ca81c957c8365794b`를 독립 `redesign-05-integration`
checkout의 실제 Astro/mock4387에서 검사했다. 최종 동결 전 초기 통합이며 main의 PR772를 포함한다.
[첫 실행](initial-c89b30d/first-run/receipt.json)은32 PASS/2 FAIL이다.
두 실패는 native beforeunload 한 번만 기대하던 검수 코드가 새 이탈 모달을 인식하지 못한 것이다.
실제 DOM에서 제목의 단일 ID 연결을 확인하고 모달의 계속 작성으로 취소한
[재검사](initial-c89b30d/guard-rerun/receipt.json)는2 PASS다. 이를 한 실행의34 PASS로 합치지 않는다.

새 네 작업 사이에서 미전송 문장과 File을 유지하고 자동 업로드0을 확인한 뒤,
명시 전송→첨부 원문 다운로드의 실제 바이트까지 일치시켰다. 파일명만 남은 가짜 복원은 통과하지 않는다.
초안 조회가 self 선택/생성 receipt를 바꾸지 않는지, 출처 절의 제한 본문이 보이는지,
계정 전환 시 이전 입력이 DOM에서 제거되는지도 두 엔진에서 확인했다.
[네 경로와 서식 추가 검사](initial-c89b30d/entry-format/receipt.json)는10 PASS다.
네 준비 방향을 각각 문서 없이 시작한 후 저장된 입장/분야를 확인했고,
메시지의 HTML·javascript URL이 실행되거나 원격 이미지를 요청하지 않는지 검사했다.

### 실제 브라우저 확대와 IME

같은 초기 통합본의 macOS Chrome에서 보기 메뉴·네이티브 키로 실제200% 배율을 적용했다.
Chrome 배율 표시200%, DPR4/innerWidth600/outerWidth1200을 관측했다. CSS zoom 주입이 아니다.
200%에서 Tab으로 입력에 도달하고, 문서 없는 형사 대응 설명→질문→요약→작업대로 진행했다.
한국어 입력 소스로 전환한 뒤 물리 키 `g k s r m f`의 조합 중 `한글`을 확인했다.
대화에서 조합 완료 Enter 뒤 `한글\n`이 남고 사용자 메시지는0건이었다.
자료 왕복 뒤에도 같은 입력과 미전송 상태가 보존됐다.
[본문 화면](initial-c89b30d/physical/ime-200.png), [관측 receipt](initial-c89b30d/physical/receipt.json)를 보존한다.
검사 후 영어 입력 소스와100% 배율(DPR2/innerWidth1200)을 복원했다.
이 관측을 모바일 기기의 가상 키보드 검사나 최종 SHA의 성공으로 확대하지 않는다.

### 검수 코드 검사

frozen install·docs·Biome·tools TypeScript와 canonical 임시 경로의 전체 `validate:quick`은 통과했다.
최초 quick은 macOS 기본 임시 경로에서 기존 Babel coverage 검사1건으로 실패했다.
코드/기존 기대값을 바꾸지 않고 프로세스 `TMPDIR=/private/tmp`로 같은3개 검사를 통과했다.
재실행 때 검수자가 처음 테스트 경로에 남긴 생성 JSON의 lint 실패3건도 보존했다.
해당 생성 원본만 `/private/tmp/baro-ux05-raw`로 이동한 뒤 전체 quick EXIT0을 확인했다.
후속 E2E 보강은 tools TypeScript/Biome로 다시 검증하며 최종 과업은 동결 SHA에서 실행한다.
