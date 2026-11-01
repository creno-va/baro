# BARO-REWORK-05 리포트 검증 기록

## 구현과 경계

- #626, `codex/626-report-rework`. 계약 #628, shared client #630, 자료 #629/#635, DB #634, 대화 domain #633, 분석 domain #631/#638, 해결 domain #632/#639의 성공 CI와 main 병합을 확인한 뒤 통합했다. 중앙 composition·Workspace·병합·배포는 00/04 소유다.
- 검증된 저장 분석과 연결된 공식 원문만 reports에서 읽는다. 리포트/PDF 다운로드는 모델·검색·법률 API를 실행하지 않는다. 준비는 명시적 `prepare_report`이며 진입은 read-only `peekReport`이다.
- canonical V2ReportBody를 유지하고 private review snapshot에 검증된 분석·정확한 원문 excerpt를 보존한다. 웹·HTML·PDF는 같은 편집 가능한 본문/section parser를 사용한다. 사용자가 편집한 분석은 검증 완료 표시를 유지하지 않는다.
- 법적 요건과 사실·증거 위치·미확인 부분, 판례 공통점·차이점·의미, 입장별 약점·자료·다음 행동과 원문/기준일을 표시한다. `ready/partial/empty/unavailable/review_required`를 구별한다. 출처 목록만으로 완성 처리하지 않는다.
- 자료 제외/마스킹 변경은 파생 분석을 다시 구성한다. 기존 미확인 scope의 파생 설명을 재사용하지 않는다. 중앙이 현재의 실제 필터·마스킹 입력과 일치함을 검증한 명시적 scope receipt가 있어야 새 분석을 포함한다. 원본 snapshot·저장된 PDF·사용자 편집은 보존한다.
- 새 source format만 latest published analysis(entity=workspace)의 manifest identity와 workspace context ciphertext·scope를 source digest/SQL export fence에 포함한다. 이전 형식의 digest 바이트와 저장 PDF 읽기는 유지한다. report bookkeeping workspace revision만으로 stale 처리하지 않는다.
- `ReportReview`의 `embedded/rework/onChanged/onDirtyChange/onBusyChange`로 대화에서 재사용한다. 실제 EvidenceUpload와 FollowUpResolution을 연결하며 자식 편집/처리 상태를 host에 집계한다. `downloadReviewedReport`는 owner와 정확한 report id/revision/stale를 PDF 요청 전후 검사하고 실패를 throw한다.

## 로컬 검증

2026-11-01, 합성 자료만 사용했다. 실제 로그인·실제 사건·유료 모델/법률 공급자 호출·production 배포는 수행하지 않았다.

- `bun ci`.
- `validate:quick`, `validate:build` 및 로컬 workerd의 실제 빌드 login HTML 검증.
- `bun scripts/report-regressions.ts`: 39개 파일, 285 tests / 3449 assertions 통과. 암호화 저장소·권한·삭제·session·lease·HTML/PDF/ZIP·실패/재시도·선택 사진 및 새 분석 회귀 포함.
- 실제 SQLite rework repository publish와 workerd D1에서 분석 원본 경합, 오래된 DI loader, 다른 entity, context 변경, legacy source bytes·digest·정렬을 확인했다.
- 브라우저: rework read-only 진입, 명시적 생성과 실패/재시도, 실제 업로드 컴포넌트의 접수→처리→교정→사건 반영 요청→새 리포트, stale 편집 보관, 계정 전환, 웹/HTML 1440px·375px 줄바꿈, 기존 다운로드 상태와 inline 사진을 검사했다. #639 main(8a5e1711) 통합 후 실제 ReportReview→FollowUpResolution 조립에서 청구·방어 양쪽×3개 경로가 모두 통과했다. self/lawyer도 legacy report GET 0, save_report는 PDF 실패→완료 표시 없음→명시적 재시도 다운로드 성공이며 새 분석/초안/해결 변경 요청은 0이다. 결합 화면의 375px 가로 넘침 없음·44px 터치 영역·섹션 간격도 확인했다. 실제 조립 11개 검사가 통과했다. 기존 리포트+ready 분석에서 새 리포트 조립만 실패하는 경우의 안내 누락과 영문 오류 코드 노출을 수정했다. 네트워크 응답 불명은 동일 request ID로 재확인하고, 접수된 작업의 확정 실패 후 명시적 재시도는 새 ID를 쓰는 것도 같은 브라우저에서 확인했다. API 응답은 합성 fixture이며 실제 외부 인수와 구분한다.

## 실제 PDF와 시각 검증

`services/file-processor/Dockerfile --target office-runtime`의 고정 WeasyPrint/native 의존성을 빌드했다. non-root, network none, read-only filesystem, 제한된 memory/cpu/pids, 기존 `report.py`를 사용했다.

1. `bun scripts/report-native-fixture.ts` / `report-rework-fixture.ts`로 애플리케이션의 실제 HTML을 생성한다.
2. `report-test.py`: 원문·한글·사진·마스킹·금지 리소스와 실제 private HTTP→subprocess→PDF 및 cleanup 통과.
3. `report-rework-test.py`: 청구/방어 사진 포함 각6p, 마스킹 각5p, 실제 암호화 서비스 분석 투영 각3p, 총6문서28p. 추출된 인용문(원문의 **, backtick, ~~ 포함)·판례 비교·증거 위치·입장별 내용·사진 수와 모든 텍스트의 페이지 경계 및 빈 페이지 여부를 검사했다.
4. 실제 PDF 전 페이지를 `pdftoppm`으로 PNG 렌더링하고 6개 contact sheet의 총28페이지를 육안 검토했다. 잘림·겹침·빈 페이지 없음. 긴 한글 제목·35개 긴 조항·긴 URL·가로/세로 사진·증거 번호의 줄바꿈을 확인했다. 웹 캡처로 PDF 검증을 대체하지 않았다.

초기 fixture에서는 footer만 넘어간 추가 페이지가 발견됐다. footer break와 인쇄 section 간격을 조정한 뒤 실제 PDF 전체를 다시 생성하여 해결을 확인했다. HTML 브라우저의 제목이 전역 hero grid에 영향을 받는 문제도 발견해 report 범위의 block 배치와 제목 폭 회귀 검사로 수정했다.

출력은 `.wrangler/report-rework/{claim,response,claim-masked,response-masked,prepared-prepare_claim,prepared-respond_to_claim}.{html,pdf}` 및 `*-page-*.png`, 브라우저 캡처에 있다. 합성 산출물이며 Git에 실제 사건 자료를 저장하지 않는다. Report rendering CI도 같은 고정 native 검증과 PDF/전 페이지 PNG artifact를 실행한다.

## 통합·외부 인수

중앙 runtime은 `readPreparedAnalysis`와 `preparedAnalysisMatchesScope`를 실제 analysis repository/current-scope 검사로 연결해야 한다. 04는 `embedded rework`를 명시해 read-only 진입을 사용한다. 06의 readonly peek/metadataOnly #639는 최신 CI 41303033100 성공·main 8a5e1711 병합 후 실제 조립으로 확인했다. 병합·preview/production·최종 main SHA의 validate:full·실제 외부 공급자 smoke와 공개/법률 승인 상태는 00의 별도 인수이며 이 합성 검증으로 완료 처리하지 않는다. 비용 관측 전용, AI200/일, 공급자/모델·권한·동의·암호화·삭제·lease·실제 용량 정책은 유지한다.

## ACK 유실 뒤 revision 변경 재시도 보완

04의 후속 통합 검토에서, 접수 뒤 응답만 유실되고 workspace revision이 증가하면 ReportReview가 기존 request ID를 새 ID로 바꾸는 경계를 발견했다. `codex/626-report-preparation-retry`는 준비 요청의 action·expectedRevision·requestId 전체를 보존한다. 이후 조회한 revision이 달라도 응답이 불명확한 동안에는 같은 본문과 멱등 키로 결과를 확인한다. 확정 거절이나 정상 응답을 받은 뒤 사용자가 다시 요청할 때 새 시도를 만든다. 계정·사건 변경은 기존 접근 경계에서 요청을 폐기한다.

합성 HTTP 브라우저 회귀에서 서버 접수로 revision 7→8 후 ACK503을 반환하고, 재조회가 8을 반환해도 재전송 본문/키는 최초와 같으며 접수는 1회인 것을 확인했다. 별도 409 확정 거절 뒤에는 revision8과 새 ID/키로 한 번만 접수한다. 기존 접수 후 작업 실패의 명시적 재시도·계정 전환을 포함해 ReportReview 13개 브라우저 검사가 통과했다. 이 검사는 실제 클라이언트와 UI에 합성 HTTP 응답을 연결한 검증이며, 04의 실제 Hono/D1 전체 경로 검증과 구분한다.

## 실제 페이지의 읽기·대기·본문 확인 후속 검증

`codex/626-report-draft-wait`는 실제 Astro 리포트 페이지가 opt-in rework 읽기를 사용하는 경계를 기존 browser fixture에 반영한다. 합성 상태는 공식 원문 미확인(`unavailable`)과 후속 해결 `not_ready`를 그대로 유지한다. 예전 API만 제공하여 초기 본문을 못 여는 오류를 준비 완료 데이터로 숨기지 않는다. 계정 복구 fixture도 같은 읽기 경로를 사용하며 동의·계정 변경·지연 응답·미저장 draft 보호 assertions는 유지한다. 공통 최근 사건 접근은 #619의 양 역할 허용 계약을 따르고, 변호사 settings의 보관 사건 영역은 계속 숨긴다.

`ReportReview.onViewed({id, revision})`는 owner 검증을 거친 실제 본문 accept/readback과 DOM 반영 후, 현재 사건·정확한 본문 identity·fresh 상태가 모두 맞을 때만 알린다. 단순 pane 열기, 본문 로드 실패, stale snapshot, focus metadata만 새 revision으로 바뀐 경우에는 새 본문 확인으로 알리지 않는다. 콜백 자체는 API나 모델 호출을 추가하지 않는다. 실제 SQL browser에서 fresh emit, focus 새 revision 미emit, 동의 철회와 source 변경 후 stale PDF 읽기 미emit, 삭제 후 미emit을 검사한다. rework PDF의 접근 재확인과 PDF 생성 대기 문구도 실제 처리 단계에 맞춘다.

2026-11-02 로컬 결과: `bun ci`, `validate:quick`, `validate:build`, reports 285 tests/3449 assertions, 독립 rework browser 13개와 기존 draft browser 6개 통과. 실제 Astro에서 공통 클라이언트 오류 코드·동기 생성 deadline 및 06의 오래된 세션 lock 수정 의존 4개를 제외한 18개가 통과했다. 해당 공통/06 수정은 각 소유자가 처리하며 최종 통합 결과를 별도로 기록한다.

서명 session·실제 SQL 리포트의 80문단·여러 페이지 긴 문단·초 단위 출처·식별정보 삭제 검증도 실행했다. hash로 고정한 `tests/browser/requirements.txt`의 pypdf 6.20.1을 사용했다. 인쇄 PDF의 margin footer가 긴 문단 중간에 섞이는 추출 현상은 좌표로 footer band를 구분해 해결했다. 본문에서 BARO/숫자 문자열을 삭제하지 않으며, Chromium의 숫자 사이 en dash 추출 alias(U+00AD)만 1:1 변환한다. HTML 모든 원문/heading 검사와 함께 실제 다운로드 PDF의 모든 기대 문단도 exact 검사한다.

합성 실제 다운로드 PDF와 실제 HTML 인쇄 PDF 각8쪽을 `pdftoppm`으로 전 페이지 렌더링하고 4개 contact sheet의 총16쪽을 육안 검토했다. 잘림·겹침·빈 페이지 없음. 현물은 `.wrangler/report-draft-wait/real-korean-report.{pdf,html}`, `real-html-printed.pdf`, `download-page-*.png`, `print-page-*.png`, `*-contact-*.png`에 보존한다. 이 검증은 기존 서명 SQL/legacy PDF 호환 검증이며 앞선 고정 WeasyPrint의 청구·방어·사진 28쪽 검증 및 중앙의 최종 실제 Hono 통합 인수와 구분한다.
