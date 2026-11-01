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

## 실제 PDF 저장 경로의 조회 통합 준비

00의 PR667/669와 PR668 최신 통합 head d11c33ae를 소비한 실제 Astro 회귀는 22/22 통과했다. 48초 동기 생성·초과 자료 제외 복구·늦은 실패/로그아웃 응답을 포함하며 기존 owner·동의·draft·저장 bytes·삭제 보호를 유지한다.

04의 실제 서명 Hono/DB/AES→2×3→확인→자동 분석/리포트→TXT 업로드/처리→실제 Docker PDF 여정에서 첫 PDF가 413으로 실패했다. 원본 limits 함수에 위임하는 임시 로컬 카운터로 측정한 결과 native PDF는 52,064 bytes로 정상 생성됐다. sourceRows11/reportFiles1/ZIP0의 기존 계획은 queries320/rowsRead979200/rowsWritten1000이고, 계획 적용 시점의 253회는 허용됐으나 이후 persist batch의 321번째에서 차단됐다. 실제 query/byte/lease/시도/원장 한도를 바꾸거나 unmetered 어댑터로 이 여정을 대체하지 않았다.

`codex/626-report-scoped-read`는 optional private `readPreparedAnalysisForScope` 포트를 제공한다. current owner·감사된 결과·정확한 공식 원문·현재 및 요청 scope를 한 번의 authoritative read로 증명하는 포트다. 기존 read와 scope proof가 동일한 전체 분석을 두 번 읽는 부분만 통합하며, export 전과 비동기 렌더 후의 각각 새로운 검증은 유지한다. 기존 DI는 두 단계 검증을 그대로 사용한다. masked/excluded 범위의 이전 파생 설명을 제거하고 과거 본문을 보존하는 회귀, 렌더 중 새 분석으로 바뀌면 실제 PDF가 생성됐어도 저장 전에 거절하는 회귀를 추가했다. 새 proof 조회 실패 때 이전 unscoped 결과로 fallback하지 않는 검사도 포함해 reports 288 tests/3504 assertions가 통과했다.

포트 제공만으로 실제 PDF 문제가 해결됐다고 표시하지 않는다. 00이 current `readAnalysisScope`의 전후 동일성과 전체 owner/source 검증을 구현하고 runtime factory를 연결하는 후속 PR의 CI/main 뒤 실제 metered 여정을 다시 검증한다. snapshot과 scope를 오래 캐시하거나 검증을 삭제하지 않는다.

## 공유 예시 여정의 최종 UI 계약 정렬

`codex/626-report-shared-flow`는 00이 위임한 `tests/browser/reports-integrated.e2e.ts`만 정비한다. 실제 제품 페이지와 공유 facade의 mock 모드를 사용하며 API alias/대체 component/검증 성공 seed를 넣지 않는다. 초기 2×3 질문의 각 순서를 확인한 뒤 readonly 요약의 ‘맞아요’→명시 확인, 리포트 준비 상태의 명시 ‘리포트 준비’로 진행한다. 법률 공급자 미실행·unavailable 상태는 그대로 보존한다.

PR676 main a86862e0의 정확한 source identity 대물림을 소비한 뒤, 편집 저장→새로고침→PDF 다운로드·접근성·모바일/desktop 캡처→사건 삭제와 원본 저장소 비움→두 번째 사건/자료→계정 삭제 및 peer 본문/PDF 제거를 검증했다. 원본은 공유 Files API에서 실제 IndexedDB bytes를 읽어 전부 비교하고, 기존 ZIP API로 선택한 원본만 묶어 표준 zipfile의 CRC·UTF-8 파일명·전체 내용 검사를 수행한다. 삭제 후 archive를 포함한 original inventory도 0이다. 화면에는 기존 PDF 저장 UI만 표시한다.

초과 자료의 29,999자+emoji+TAIL을 잘라내지 않고 제외 선택으로 복구하며 저장된 원본·제외 id·본문 well-formed 여부·reload를 검사한다. 다른 화면에서 생성한 아직 보지 않은 리포트는 기존 화면의 재생성으로 덮어쓰지 못한다. 삭제된 사건은 safe NOT_FOUND alert와 편집/PDF 없음, 계정 삭제는 peer의 본문·다운로드 제거와 로그인 안내를 함께 확인한다.

Chromium 3/3 및 WebKit 3/3이 실제 공유 페이지에서 통과했다. 원본 bytearray 동등 검사를 강화한 뒤 변경된 전체 여정도 양 브라우저 각1회 추가 통과했다. 합성 PDF·ZIP·화면은 `.wrangler/report-shared/{chromium,webkit}/`에 보존한다. 이 예시 모드의 canvas PDF/IndexedDB archive 검증은 실제 Docker PDF와 외부 로그인·공급자 인수를 대신하지 않는다. 실제 metered PDF는 00의 scoped helper/runtime binding CI/main 후 별도로 확인한다.

677 main ec292cbb의 실제 scoped authoritative binding을 소비한 별도 signed runtime fixture에서도 TXT 업로드·처리·R2 원본 동일성→Docker native PDF→실제 저장·다운로드가 성공했다. 동일 limits 함수에 위임하는 readonly 계측에서 기존 계획 queries320/rowsRead979200/writes1000은 그대로이며, 계획 적용 시 누적 작업은 253→165(88회 감소), 저장된 다운로드 진입은 237회였다. 이 값은 로컬 실제 SQL adapter의 관측이며 원격 Cloudflare 과금/플랫폼 인수는 아니다.

실제 수신한 WeasyPrint62.3 PDF는 52,070 bytes, SHA-256 `8370d7d64957b536f9c944d9462447a7a42a4c7056a9abc665b747c50b81cea4`, A4 4쪽이다. 각 페이지 추출 본문은 559/961/997/534자로 비어 있지 않다. 전 페이지를 100dpi PNG로 렌더링해 합성 법 조항·판례 원문과 인용의 일치, 증거 위치, 입장·미확인 요건·보완·다음 행동·분석 기준·합성 고지와 한글 glyph/줄바꿈을 육안 검토했다. 잘림·겹침·빈 페이지가 없다. 현물과 추출/전 페이지 PNG는 `.wrangler/report-runtime-main-ec292cbb/`에 보존한다. provider/model 전송은 합성 transport이며 실제 외부 법률·모델 품질 승인과 구분한다.

## 저장 뒤 최신성 및 원본 ZIP의 조회 한도 통합

위 native PDF 관측은 실제 저장된 bytes와 렌더 결과의 증거이며, 당시 저장 **뒤** 최신성 검사를 포함하지 않았다. 후속 실제 UI에서 저장 예약/완료의 작업공간 CAS 증가가 리포트와 분석을 stale로 만들던 별도 결함을 발견했다. 00의 PR691 main `fc00ee2f19a88a0b2d230851235c98804fc7e12a`는 report ciphertext/body를 바꾸지 않는 원자 저장 증명을 추가했다. 이후 04가 실제 UI에서 받은 PDF의 서버 원본 bytes 일치와 사후 최신성을 확인했다. 이 성공을 최종 14개 UI 여정이나 후속 해결 전체 인수로 확대하지 않는다.

`codex/626-report-export-query-budget`는 그 main에서 PDF 다음 원본 ZIP 저장의 plan415 한도 초과를 청구/방어 양쪽에서 실제 재현했다. 고정 Docker PDF와 제품 request meter·암호화·저장 예약·physical writer/receipt를 유지한다. 모델/공식 출처/파일 probe·process 외부 port와 로컬 SQLite/D1/R2 transport는 합성이며, `/report`는 실제 Docker의 제품 renderer다. 원격 Cloudflare 과금/용량 및 실제 외부 공급자 인수와 구분한다.

- 새 ZIP과 replay 각각에서 source digest를 한 번 검사하며, ready ZIP replay의 현재 출처/분석 검사도 유지한다. full build의 중복 digest는 곧바로 동일 digest와 원문을 검증하는 exportFence로 통합한다.
- 숨김 originals export copy는 새 pre-lease 분석 검증과 렌더 후 새 분석 검증을 모두 수행한다. visible canonical report 생성/편집의 기존 사전 분석 검증은 보존한다.
- 98,304 bytes 이하의 private parent body만 기존 snapshotStatements의 AES/AAD/chain·byte/part 상한 안에서 body/review/report/job과 한 batch로 저장한다. 최종 claim은 parent owner/workspace/version/snapshot/cipher/tombstone과 현재 CAS를 비교하고, 누락된 body part는 전체 batch를 rollback한다. 큰 copy와 canonical body는 기존 stage 경로를 유지한다.
- 같은 요청에서 읽고 검증한 immutable body의 파일 개수만 완료 row의 정확한 identity와 함께 전달한다. 권한 판정은 재사용하지 않는다. 역사 PDF/stored ZIP의 기존 read와 모든 stream 경계의 실시간 owner/session/deletion/blob/원본 관계 검사는 유지한다. blob metadata ciphertext도 첫 query에서 가져오되 이후 모든 경계에서 동일함을 확인한다.

새 경계 검사 최종17개/143 assertions가 통과했다. 정확한 98,304/98,305-byte body와 stage fallback의 전체 readback, part 누락 시 body/review/report/operation/job/selection/idempotency rollback, 암호화 중 parent 삭제/교체, pre/post-render 분석 교체, stale replay, 다운로드 직전 snapshot/version/report·blob ciphertext/삭제를 검사한다. 추가 native 검사는 ZIP을 끝까지 소비하고 독립 Python zipfile로 CRC·파일명·원본 전체 bytes, 저장 뒤 본문/basis/최신 상태·모델/출처 호출 수·physical totals/writer stopped를 확인한다.

00의 PR 검토에서 최초 ZIP 다운로드에는 private parent ID 전달이 빠져 기존 saved ZIP의 live parent fence가 적용되지 않던 경계를 발견했다. 실제 report DELETE trigger는 암호화 review 안의 child 관계를 전파하지 못하는 것을 확인했다. 최초 ZIP에도 같은 parent ID를 전달해 기존 한 SQL의 parent owner/workspace/version/tombstone 조건을 적용했다. R2 write 중 삭제·첫 GET 뒤 첫 bytes 전 삭제·600KB ZIP의 첫 chunk 뒤 삭제 3개가 RED→GREEN이며, 마지막 경우 남은 bytes는 NOT_FOUND로 거절한다. 추가 SQL statement와 상한 변경은 없다. 이 보완 뒤 실제 native 양입장2 tests/150 assertions에서도 전체 stream414/기존plan415를 재확인했다.

공통 PR692 main `6869aa6c5fffcb7aace0218e204fd976c10dc5d0`의 private reportIdentity 네 필드만 명시적으로 전달한다. 최종 reservation claim이 실제 owner/W/op/state/version/cipher/snapshot/S를 비교하며, 입력을 권한으로 신뢰하지 않는다. 그 뒤 청구/방어 모두 native PDF→원본 ZIP 전체 bytes/CRC→사후 최신성 검사가 통과했다. 최초 적용된 active plan415는 그대로이며, ZIP 계획 적용 300→214회, stream 끝까지 414회(HTTP middleware 포함 총 D1 관측417회)다. 다운로드 시작 때 계산한 별도 quote320은 이미 plan이 적용돼 기존 meter가 무시한다. namespace 계측 없는 CI 동일 실행도 양쪽 2 tests/151 assertions가 통과했다.

기존 보고서 작업 관측 검사는 first PDF 100 calls/133 statements→90/121, 저장 PDF 32/34→31/33이며 다른 operation은 동일하다. 두 원자 저장 증명과 parts가 실제로 남는 검사도 유지해 12 tests/538 assertions가 통과했다. 전체 reports 348 tests/3831 assertions(별도 native 2개 skip), `bun ci`, `validate:quick` 673 tests/6286 assertions 및 `validate:build`/local workerd가 통과했다. plan415/hard900, rows/bytes/attempts/lease·권한/원장 한도를 높이지 않았다.

완료된 업로드의 파일 목록을 처리 publication과 동시에 읽을 때 한 번의 retryable503을 관측했다. fixture의 일반 read loop는 확장하지 않는다. fresh case의 유일하게 접수한 파일에 대한 ready polling만 typed retryable UNAVAILABLE와 실제 단일 file_processing job의 queued/running/validating 상태를 함께 확인한 경우 기존 500×10ms 범위 안에서 재조회한다. 실패/완료/누락 job, 권한/동의/파싱 오류는 즉시 원래 오류로 실패하고, 계속503이면 원래 코드를 보존한다. 제품 SDK와 retry 정책은 변경하지 않았다.

`.wrangler/report-export-budget/`의 실제 수신 PDF는 청구 SHA-256 `314a324451cc0e0222391c3f27c9fe96d353aa1178b2d78e6c510c9b87e746c0`, 방어 `3092b30704ae02688f5bf5073c6a6cfacf7f8fe8160a915df7869f54c6066759`다. 각4쪽/총8쪽을 Poppler PNG로 렌더링해 직접 검토했으며 잘림·겹침·빈 페이지가 없다. pypdf6.20.1로 같은 실제 HTML의 body text node 청구83/83·방어85/85가 PDF에 모두 남는 것을 확인했다(공백/soft hyphen만 정규화, 누락0). 각 페이지 추출 문자 수는 청구559/961/997/534, 방어549/945/975/707이다. 같은 폴더에 HTML/review JSON/ZIP/receipt/content-check와 전 페이지 PNG·contact sheet를 보존했다. 별도 `.wrangler/report-export-budget-strict/`는 namespace 계측 없이 동일 제품 경로를 끝까지 소비한 추가 증거다. 최종 UI14·실제 OAuth/공급자/법률 승인·전체 main 검증과 배포는 00의 별도 인수다.
