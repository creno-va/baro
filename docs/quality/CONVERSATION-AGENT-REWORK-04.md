# 대화 에이전트 통합 검증 (#625)

이 문서는 합성 사건의 검증 계약과 실행 기록이다. 최신 결과는 아래 최종 실행 상태를 따른다. 실제 외부
모델·법률 API·OAuth·배포 성공을 합성 결과로 대신하지 않는다. 공통 계약과 통합 상태의
정본은 `docs/development/CONVERSATION-REPORT-REWORK.md`이며 통합00이 관리한다.

## 2026-11-02 최종 실행 상태

실제 앱 조립의 고정 검사 소스는 `b424eb2125c2fef3399adbb5790423c45921f7d8`이다.
공통 mock 선행 [PR695](https://github.com/creno-va/baro/pull/695)의 exact
`87a10a6c57e7a8b167a7fb5057dff861005d480d` Quality41355266822 성공과 main
`7cea91232f63f6807b62d15b53c6fbc7f27c2e41` 병합을 재확인해 통합했다.
그 뒤 결합 소스 `13f0b062e990371b5543d4634c9decb9a1d31194`에서 공통 mock과 quick를
검증했다. 이번 추가 변경은 공통 mock의 알려진 revision 보존이며 실제 서비스14개 검사의 제품
소스는 그대로다. 성공 당시12경로 원본은 다시 실행하거나 덮어쓰지 않았다.

| 범위 | 결과와 근거 |
| --- | --- |
| 실제 앱/서비스 통합 | Chromium14개/3.5분, WebKit14개/3.8분 통과. 양 입장×후속3경로와8개 실패·경합 검사를 실제 Hono/D1/AES/서명 세션/설치 SDK로 실행 |
| 격리 대화 UI | Chromium17개/8.6초, WebKit17개/12.6초 통과. body/제거된 control·정확한 scroll ancestor·구조적 main opener·외부 control·native dialog·계정 epoch를 구분 |
| 공통 앱 mock | PR695 통합 뒤 Chromium2개/26.9초, WebKit2개/32.1초 통과. 실제 intake·자료·재확인/입장/절차·제한 리포트를 같은 대화 URL로 연결 |
| 브라우저 등록 | 명시 env로 각 config/engine의 `--list`를 수집: Agent17+shared2+actual14=각33개. 등록을 건너뛰어 통과 수를 만든 것이 아님 |
| 코어/게시/업로드/다운로드 | 관련6파일174개/780 assertions 통과. 원래 request ID와 전체 입력, exact 게시 revision, 원본 hash/의미 동결, 실패 후 명시 복구 포함 |
| 실제 native | SDK 원본/hash/로컬 R2 binding 전체 bytes·Docker 처리/PDF·사후 current-report·암호화 저장 용량1개/62 assertions 통과. physical cloud Containers 정지 인수가 아님 |
| 설치/quick | `bun ci`1349 installs/변경0. 결합13f0의 `validate:quick` exit0: Astro542파일 error0,534개·448개/4 opt-in skip·도구674개/6291 assertions 및 타입/정적 검사 통과 |
| build | b424의 `validate:build` exit0. 실제 production Worker를 local workerd에서 부팅해 익명 로그인 HTML 제공 확인. 배포·실제 OAuth 성공이 아님 |
| PDF/HTML/저장 | 실제12PDF/48쪽과 HTML1108개 본문 항목, 전체 bytes·basis/hash 일치. self의 검토/저장 UTF8 초안과 save의 동일 PDF 재다운로드까지 통과 |
| 독립 시각 검토 | 05가 별도 bytecopy에서12PDF48쪽 전체를 렌더/직접 검토. clipping/overlap/blank/brokenGlyph/bbox finding0, 원본 재hash 불변·1108/1108 본문 일치 |

두 입장에서 자료 선택→동의/원본 업로드→대화 반영/inline 검토→재확인→자동 법률·판례 조사→
NLP 리포트 요청→실제 PDF→직접 해결/변호사 준비/저장으로 이어졌다. 첫 self는 실제 commit
응답 유실을 겪은 첨부 메시지를 같은 key/전체 body로 재전송해 첨부1개를 유지했다.
respond-save는 기존 촬영 picker의 `capture=environment`와 실제 합성 PNG를 사용했고,
원본 SHA·vision 실행·partial/low_quality·uncertain·포함 근거·리포트 문구를 확인했다.
`actualCameraDevice=false`이며, 이12경로는 선택된 사진의 PDF 내 이미지 삽입 검증으로
확대하지 않는다. 해당 이미지 삽입은05의 별도 선택사진 검증과 구분한다.

WebKit의 Playwright Request는 원래 Blob PUT의 body를 노출하지 않았다. fixture 전용 dev
middleware가 같은 origin의 원래 HTTP stream을 실제 Hono로 전달한다. 본문 재생성,
결과 DTO 대체, 제품/CSP/CORS·cookie/Origin/expected-owner/upload-session/hash 검증
완화는 없다. 제품 runtime은 Workers이며 Node HTTP는 테스트 config에만 있다.

키보드 문제는 실제 DOM 관측과 독립 red로 재현했다. 현재 패널을 포함한 정확한
`.workspace-messages` 자체가 target인 idle Escape만 기존 close로 전달한다. document/window
listener나 외부 control의 초점 이동은 추가하지 않았다. 구조적 main/scroll은 실제 control
opener로 취급하지 않고 composer로 돌아간다. busy/dirty·owner/epoch·native dialog 경계와
원래 버튼 복귀는 유지한다. 실제 통합 여정에는 임의 focus/sleep이 없고 마지막 상태가
`TEXTAREA#workspace-message`임을 web-first assertion과 최소 metadata로 확인했다.

공통 mock 실패의 readonly 비교에서는 사건9개 영역의 canonical digest가 모두 같고,
workspace/case/conversation revision도 모두10→13으로 일치했다. ready 파일의 hash는 유효하지만 revision만
누락됐고 ACK/review는1이었다. 00이 새 FileView에 알려진 revision1을 보존해 고쳤다.
04의 safe integer/원본 hash/처리 검토/사건 의미/요청 재사용 검증은 완화하지 않았다.

재현 로그는 `/tmp/baro-625-actual-b424-final-{chromium,webkit}.log`,
`/tmp/baro-625-after695-shared-final-{chromium,webkit}.log`,
`/tmp/baro-625-after695-final-quick.log`, `/tmp/baro-625-b424-final-build.log`에 있다.
성공 원본은 `/tmp/baro-625-journeys/{chromium,webkit}/<purpose>-<branch>/`의
PDF/HTML/basis·자료/리포트/후속 PNG와 visual metadata다. 독립 검토는
`/tmp/baro-626-final-pdf-qa-b424eb21/independent-check.json`에 보존했다. 원래 실패는
별도 red-original 경로에 남겼다. protocol/readiness JSON과 모든 tmp/log를 일괄 artifact로
올리지 않으며 외부 모델·공식 source 응답은 명시 합성 포트임을 유지한다.

최종 main의 수동 full·기존 보안/정책/공개 gate·실제 공급자/OAuth/기기/법률 승인과
병합·배포는 통합00의 #621/#71 인수다. 이 로컬 결과로 그 조건을 성공 처리하거나 이슈를
자동 종료하지 않는다. 아래 상세 기록의 대기/실패 문구는 각 당시의 관측이며 최신 상태는
이 절과 PR642의 정확한 최종 head/CI를 따른다.

## 공통 시작 상태

- 두 입장 `prepare_claim`, `respond_to_claim` 각각 실행한다. 옛 사건의 `unconfirmed`는
  입장을 추정하지 않고 확인 UI를 제공한다.
- 합성 사건·자료만 사용한다. 처음 진입한 대화 URL을 마지막까지 유지한다.
- 사건 소유권·현재 동의·summary revision·자료 revision·분석 basis·작업 ID를 검사한다.
- 초기 질문은 최대2차례×3문항이다. 이미 답한 날짜·금액·단계는 다시 묻지 않는다.
- 명시적으로 모름/건너뛰기를 선택한 항목은 미확인으로 보존하며 가능한 부분 결과를 제공한다.

## 양쪽 입장 × 후속3경로

1. 대화에서 계약서 추가 의사를 보낸다. 서버가 검증한 구조화 intent로 자료 UI가 열린다.
   키보드로 파일 선택 또는 촬영 버튼에 접근한다. 취소하면 초안과 기존 사건이 보존된다.
2. 동의 후 합성 계약서를 업로드한다. 업로드 ACK와 처리 완료, 검토 완료를 구별한다.
   처리 실패/부분 처리면 읽지 못한 범위를 표시한다. 자료 검토·교정은 대화 안에서 수행한다.
3. 자료를 반영하고 사건 재확인을 연다. 변경 전후를 검토한 후 명시 확정한다.
   기존 알려진 사실·불리한 사실·모순·미확인은 보존하며 서버 CAS가 새 revision을 반환한다.
4. 확정된 요약과 현재 자료 basis로 법률·판례 조사가 한 번 시작된다. 사용자가 검색어를
   입력하거나 판례를 먼저 선택하지 않는다. 같은 basis의 재진입·polling·일반 대화는
   모델/검색 호출을 추가하지 않는다. 근거 법조항과 요건, 사실/자료와 공백, 판례의 구체적
   공통점·차이점을 대화 안에서 확인한다. 검증되지 않은 검색 목록은 citation이 아니다.
5. 리포트 생성 또는 명시적 정리 마무리를 요청한다. 자료 처리·사건 확인·분석 준비 상태를
   읽고 필요한 단계만 진행한다. 작업 접수/진행/부분/실패를 완료로 표현하지 않는다.
   리포트 본문을 대화 안에서 검토·저장하고 PDF를 다운로드한다.
6. 같은 리포트와 사건에서 각 후속 경로를 별도로 실행한다.
   - 직접 해결: 현재 사건에 맞는 안내·초안을 검토한다. 외부 제출·연락은 자동 수행하지 않는다.
   - 변호사와 해결: 기존06 UI에서 준비·전달 범위를 확인하고 사용자가 직접 연락한다.
   - 리포트만 저장: 검토한 현재 버전을 저장/다운로드하며 추가 실행을 요구하지 않는다.

## 실패와 경합

| 조건 | 관측할 결과 |
| --- | --- |
| 검색 실패·공식 원문 미검증·외부 키 미설정 | 실제 unavailable/partial와 구체적 공백. 예시 성공·근거 없는 법률 결론 없음. 자동 무한 재시도 없음 |
| 자료 처리 실패·일부 페이지 누락 | 실패 범위와 재시도/다른 자료/제한 결과. 미처리 파일을 검토했다고 표현하지 않음 |
| 동일 요청 중복 클릭·네트워크 재전송 | 동일 request ID의 동일 작업/결과. 새 처리·보고서·외부 호출 중복 없음 |
| timeout 후 ACK 여부 불명 | 기존 request/job을 조회해 결과 확인. 새 ID로 재실행하지 않음 |
| 계정 전환·로그아웃·다른 사건 전환 | 이전 결과·초안·패널 제거, 지연 응답 폐기. 새 계정에 이전 결과 반영 없음 |
| 동의 철회 | 현재 쓰기/실행 불가, 허용된 기존 읽기와 보존 유지. 지연 변경 callback 실행 없음 |
| stale workspace/summary/evidence revision | CAS 실패와 최신 상태 확인. 초안 보존, 기존 보고서 보존, stale 결과를 최신 완료로 표시하지 않음 |
| 새 자료·교정·사건 재확인 | 변경 basis에서만 재분석/리포트 갱신 안내. 과거 snapshot을 재작성하지 않음 |
| AI200/일·기술 호출/시도/시간 제한 | 실제 quota 실패 표시. 자료·대화·리포트 보존, 무한 질문/검색 없음 |
| 가격/FX/funding 누락·만료 | 관측 사실 보존. 관측 전용 모드에서 기능·배포 차단 재도입 없음 |
| 모델의 임의 action/API/SQL·자료 안의 지시 | allowlist/입력 검증에서 거절. 기존 권한 서비스 외 실행 없음 |

## 접근성·화면

320px와 데스크톱에서 단일 읽기 열·내부 스크롤·모바일 composer를 유지한다. 파란색,
Pretendard, Lucide를 사용한다. 패널은 한 번에 하나를 열고 주 행동 하나를 우선한다.
Tab/Shift+Tab, Enter/Space, Escape와 패널 닫기 후 composer 또는 원래 버튼으로 초점 복귀를
검사한다. 가로 넘침과 composer 가림이 없어야 한다. 기존 탭과 inline 결과는 같은 서비스를
읽으며 별도 fixture 결과를 제품 fallback으로 사용하지 않는다.

## 2026-11-01 실행 기록: 서버 선행 범위

선행 PR628의 exact head CI/법률 회귀 성공과 main `b5b7de0`, PR630의 exact head CI 성공과
main `3df82be8`를 확인해 통합했다. 별도 `codex/625-conversation-agent`에서 구현했다.

- `conversation-agent.ts`는 인증·동의·삭제 전후 확인, 서버 action allowlist, 입력/CAS,
  현재 작업/자료 처리/요약 확인, 리포트 ID+revision, durable receipt DI를 적용한다.
  분석과 리포트의 후속 실행은 서버에 저장할 continuation으로 구분한다.
- 일반 대화의 기존 generation/audit에서 구조화 intent를 받는다. 별도 분류 호출은 없다.
  조사 intent는 같은 대화에서 중복 공식 검색을 실행하지 않는다. 검증되지 않은 intent는
  게시하지 않는다. 새 신뢰 context가 없으면 기존 대화 범위와 구형 응답을 보존한다.
- `bun test tests/conversation-agent.test.ts tests/conversation-publication.test.ts
  tests/workspace-pipeline.test.ts`: **141개 통과**. 양 입장의 제한 리포트×후속3경로,
  quota/timeout/경합/계정·삭제·동의/중복/잘못된 receipt와 기존 근거 검증을 포함한다.
- publication 검사는 실제 로컬 SQLite/D1 저장소에서 intake→확정→job 실행→독립 audit→
  암호화 메시지 저장→public DTO 읽기를 통과했다. 동일 job을 다시 실행해도 assistant1개와
  모델 callback2회를 유지하고, intent는 private payload에만 남는다.

이 선행 범위는 중앙 runtime 어댑터와 UI 조립을 위한 인터페이스다. 01~06의 실제 서비스·
컴포넌트를 연결한 전체 여섯 경로와 원격 외부 인수는 아직 완료하지 않았다. 후속 PR에서
Workspace와 동일 데이터를 사용하는 inline UI를 조립하고 검증 결과를 추가한다.

## 2026-11-01 실행 기록: Workspace 조립

별도 `codex/625-conversation-workspace`에서 코어 PR633의 main 병합 후 조립했다.
재확인 PR636의 CI 성공/main `9597bc1e`, 법률 runtime PR638의 CI 성공/main `7f625a85`,
후속 runtime PR639의 CI 성공/main `8a5e1711`을 확인해 통합했다.

- 실제 Workspace의 자료 선택·촬영은03 EvidencePicker와 ChatAttachments를 사용한다.
  로컬 미리보기·제거·명시 동의 후 기존 파일 서비스로 업로드한다. 원본 hash/manifest/ACK와
  서버 처리 상태를 구분하고, 접수된 파일은 재전송하지 않는다. 자료 링크는 같은 대화 안의
  FileReview를 열며, CaseMaterials·타임라인도 동일 파일/사실을 읽는다.
- 사건 재확인은01 SummaryReconfirmation을 그대로 사용한다. 확인 후에는 fresh Workspace와
  conversation 상태를 읽어 분석 영역을 열기만 한다. 자동 조사의 admission/continuation은
  중앙 서버가 소유하며, 화면 재진입·polling은 모델/조사 실행을 추가하지 않는다.
- 일반 대화 intent는 새로 완료된 assistant와 정확히 같은 게시 revision에서만 실행한다.
  첫 진입의 과거 intent와 지연된 옛 revision intent는 자동 실행하지 않는다. timeout에서는
  같은 request ID와 전체 입력을 유지해 결과를 확인한다. 현재 scope의 취소 신호와 전후
  세션 검사, case별 remount로 다른 계정/사건의 지연 응답을 폐기한다.
- 재확인·자료·준비 요약·법률 분석·후속 해결은 한 번에 하나의 읽기 영역을 사용한다.
  초안이 있는 영역을 닫거나 바꾸기 전 확인하며, busy 중 닫기를 막는다. stale 상태에서는
  초안을 보존하고 편집을 잠근다. v1은 새 rework API로 위장하지 않고 기존 읽기를 유지한다.
- 공급자 오류 이후 명시적 `analyze_legal` 요청만 새 bounded admission을 허용한다.
  동일 request replay는 중복 admission을 만들지 않으며, `prepare_report`는 실패한 조사를
  자동 재호출하지 않고 한계가 표시된 리포트 준비로 이어간다.

검증 증거:

- 실제 Workspace route의 Chromium **90개 통과**. 자료 추가→inline 검토→준비 요약,
  320/390/768/1440px, 키보드/axe, 선택 후 쓰기0회·미리보기·제거·동의·사진 전송 실패 복구,
  업로드 ACK/부분 실패/원본 바이트 다운로드/삭제, quota/stale, 계정/동의/동시 세션 검사를
  포함한다. 같은 소유자의 customer/lawyer 전환 허용은 기존 main 정책을 유지하며 이전
  epoch의 작업/다운로드만 폐기한다.
- 격리 ConversationAgent 브라우저 **6개 통과**. 초점 복귀/dirty 취소·새 intent1회·
  timeout 동일 입력·옛 revision 무실행·계정 전환 abort·stale 초안 보존을 검사한다.
- 코어/실제 암호화 게시/pipeline/분석 표시 **147개 통과**. 합성 자료를 사용하며 실제
  외부 모델·공식 API·카메라 기기 성공을 주장하지 않는다.

격리 브라우저는 명시적 테스트 adapter다. 제품 fallback이 아니며 기존 Workspace mock의
실제 chunk/hash/원본 검증을 유지한다. WebKit의 IDB Blob 직렬화 문제는 테스트 DI에서
ArrayBuffer를 저장해 검사했고 제품 R2나 중앙 mock 저장소는 변경하지 않았다.
중앙 Hono/D1 orchestration 및 리포트 최종 조립과 전체 여섯 경로 결과는 후속 기록한다.

후속 검사에서 실제 Workspace WebKit **5개**(자료 추가/inline 검토/준비,320px composer,
사진 선택 전쓰기0·미리보기/제거/명시 동의/실패 복구,처리 실패/원본 바이트/삭제)가 통과했다.
main640 통합 뒤 `validate:quick`(Astro518파일 error0, 선택673 tests)도 통과했다.
build는 production Worker를 실제 local workerd에서 시작해 익명 로그인 HTML까지 검사했다.

최종 브라우저 진입점은 `tests/helpers/rework-browser-server.ts`의 loopback 전용 transport와
`rework-browser-proxy.ts`, 실제 Astro route/real-client 설정으로 준비한다. production API
factory와 실제 SQLite/D1·AES·signed session의 조립은 통합00 factory가 소유한다. 이 진입점은
API 응답 DTO·분석·리포트·해결 논리를 새로 만들지 않는다. 요청 본문·쿠키·expected-owner·
idempotency header를 실제 Hono로 전달한다. 중앙 runtime의 CI/main 전에는 실행을 명시적으로
거절하며 `rework-conversation.e2e.ts`의 양쪽 입장×3개 시나리오는 미실행 상태로 유지한다.

리포트 PR641 최종 `cfe65304`의 Quality41304107272/nativePDF41304107288 성공과 main
`1bfe0e50` 병합을 확인해 실제 `ReportReview embedded rework`를 대화에 연결했다. 리포트
내부의03 업로드/06 해결 UI를 바깥에서 중복 배치하지 않는다. 별도 해결 영역의 저장은05
`downloadReviewedReport`를 재사용하며 현재 owner/case epoch와 정확한 report ID/revision/stale를
PDF 요청 전후 확인한다. helper의 실패·취소를 throw해06의 저장 완료 표시를 막는다.
이 조립 뒤 `validate:quick`과 `validate:build`(실제 Worker 부팅)가 다시 통과했다.

05 통합 검토에서 동의 철회 시 부모의 전체 inert가 저장본 읽기까지 막는 문제를 발견해
write disabled와 readDisabled를 분리했다. 동의 없는 현재 소유자의 명시적 보기는 fresh
owner 검증과 conversation GET으로만 열며 action POST/admission을 만들지 않는다. 자식의
현재 동의·수정·생성 검사는 유지하고 stale/다른 owner는 읽기도 잠근다. 해당 브라우저
회귀를 추가해 격리 대화 UI는 **7개 통과**했다. 05가 조립을 재검토해 수정 사항을 수용했다.
법률 관찰 자격 보존 PR644의 정확 head `41a2e9b0` Quality41304742070/Legal41304742069
성공과 main `93131b4f`를 확인해 통합했다.

## 2026-11-01 실행 기록: 명시적 맥락 확인과 공통 mock

00이 명시 배정한 Workspace 대화 범위에서 `ConversationContextReview`를 추가했다.
실제 `getContext/updateContext`로 입장·사건 분야·진행 단계·사용자가 확인한 설명을
읽고 저장한다. 기존 값을 기본으로 표시하며 분야나 입장으로 단계를 추정하지 않는다.
개인/기업 맥락은 기존 값을 보존한다. 모르는 단계는 그대로 남겨 제한 결과로 이어갈 수 있다.
01의 SummaryReconfirmation을 감싼 조립 컴포넌트가 두 편집의 dirty/busy를 합친다.

- 저장 전후 fresh owner 검사, 현재 revision CAS와 readback을 적용한다. 409에서는 선택과
  설명을 보존하고 최신 GET/명시 비교 후 새 기준으로만 다시 저장한다. ACK 유실은 동일
  입력으로 결과를 확인하며 ACK 이후 readback 실패는 GET만 재실행한다.
- 00과 합의해 소유 `conversation-prompts.ts`를 2.12.0으로 갱신했다. 절차 설명과 자료는
  사용자 데이터이며 명령 권한이나 공식 확인이 아님을 generation/독립 audit 양쪽에
  전달한다. 설명에 삽입한 리포트 실행 지시를 audit가 거절하면 게시하지 않는 검사를 추가했다.
  중앙 registration 테스트의 기대 version 한 줄만 00의 명시 배정으로 함께 변경했다.
- 실제 공통 mock/실제 Astro 앱에서 양 입장 각각 초기 질문2×3→사건 확인→자료 추가/검토→
  명시적 절차 확인→제한 리포트/후속 UI를 같은 URL로 검증했다. 분야 선택 뒤 단계가
  미확인인지, Escape 취소/초점 복귀, peer 수정으로 실제 CAS409, 초안 보존/최신 비교,
  320px dialog/composer와 serious/critical axe0을 검사했다. Chromium2/WebKit2 통과했다.
  이 mock은 법률 서비스를 실제 unavailable로 표시하며 구조화 NLP 성공을 대신하지 않는다.
- 공통 원본 저장소 PR647의 ArrayBuffer 호환 구현을 사용하고 임시 byte store helper/DI를
  제거했다. 공통 원본 저장소로 WebKit 자료·사진·동의·원본 바이트·삭제 관련3개가 통과했다.
- 격리 대화 UI는 quota 거절 이후 새 요청 ID와 동의 철회 후 GET-only 읽기 검사를 포함해
  8개 통과했다. 코어/게시/pipeline/분석/검토 다운로드 관련153개, `validate:quick`674개와
  `validate:build`(production workerd 실제 부팅)가 통과했다.

중앙 실제 Hono/D1/AES/서명 세션 조립의 양 입장×후속3경로는 별도 미실행 상태다.
준비된 브라우저 진입점은 중앙 factory가 CI/main을 통과한 뒤 연결한다. 처리/검색/모델은
합성 외부 포트만 사용하며, 앱 서비스·영속 저장·권한 검사는 실제 구현을 사용한다.

후속 PR651~654의 exact head CI 성공과 main `13f2d512`까지 확인해 통합했다.
통합 head `8d659408`에서 `bun ci`, quick674, 위 관련153개, production build/workerd
부팅을 다시 통과했다. 이 재검사는 아직 미연결인 실제 Hono 여섯 여정의 완료 증거가 아니다.

추가 경합 검사는 새 intent를 읽은 직후 preflight GET에서 revision이 바뀌면 자동으로
새 기준에 실행하지 않는지 확인한다. 수정 전 브라우저에서 재현한 뒤 새 요청은 중지하고
최신 확인을 안내하도록 고쳤다. 이미 보낸 요청의 ACK 유실은 revision이 바뀌어도 원래
request ID/expectedRevision/전체 본문으로만 결과를 확인한다. 격리 대화 UI **9개**가 통과했다.
공통 mock WebKit 양 입장에서는 context 저장 후 새 분석 heading으로 초점 이동도 통과했다.

## 2026-11-02 통합 중 검증 기록

PR655~669의 CI 성공과 main `929297bb`, PR668의 CI 성공과 main `864f7994`를 확인해
통합했다. 현재 Workspace Chromium **90개**, 격리 ConversationAgent Chromium **11개**와
WebKit **11개**, 코어/실제 암호화 게시/pipeline/분석 표시 **148개**, 검토 다운로드 **5개**,
`bun ci`, `validate:quick` **674개/6291 assertions**가 통과했다. production build의 로컬
workerd 부팅도 통과했으며 최종 통합 뒤 다시 필요한 변경 검증을 수행한다.

리포트 요청 후 서버가 준비를 끝내면 현재 권한 상태로 검토 화면만 이어서 연다. dirty 초안,
busy, scope 변경, 명시 닫기를 보존하며 이 효과는 POST나 모델 호출을 하지 않는다.
ReportReview의 검증된 본문 `onViewed({id,revision})`만 검토 사실로 받는다. 패널을 여는
동작이나 새 metadata만으로 검토 완료를 인정하지 않고 현재 리포트와 같은 identity일 때만
후속 해결을 주 행동으로 제시한다. metadata가 늦게 반영돼도 이미 검증해 표시한 본문의
identity를 유지한다.

00이 별도 배정한 실제 runtime fixture PR672는 exact head `5d37bbce`의 CI3개 성공 후
main `ef58bcc8`에 병합됐다. signed Hono/API·SQLite/AES·현재 시각·실제 dispatcher·
원장/용량/CAS와 외부 합성 transport를 조합한다. 실제 API 연결 검사15개/864 assertions가
통과했다. 양 입장, 검색 실패의 제한 리포트, passive read 추가 모델/검색0, 실제 SQL
AI200 admission, 다른 계정과 동의 경계를 포함한다. AI200의 이전 사용량은 합성 계정의
실제 admission 행으로만 구성하며 200회 모델 호출을 실행한 것으로 표현하지 않는다.

native 검사는 실제 SDK upload→03 processor→R2 원본 바이트와 05 실제 Docker PDF를
통과했다. PDF 본문은 합성 자료임을 명시하며 4페이지의 한국어·줄바꿈·표제·근거·쪽번호를
렌더해 확인했다. 저장된 PDF/예약 바이트와 암호화 바이트, 실제 held binding과 용량 합계의
일치도 읽기 전용으로 검사한다. 이 결과는 cloud Containers 물리 정지 증거가 아니다.
초기에 찾은 PDF 저장 query320 초과와 summary fragment 중단의 JSON400, fresh context
읽기의 503 경합은 PR675/677의 원인 수정과 CI/main 후 같은 실제 연결 검사에서 해소됐다.
제한을 늘리거나 실패 결과를 합성 성공으로 바꾸지 않았다.

main678의 서버 인증 neutral proof 이후 일반 대화와 `analyze_legal`, `prepare_report`,
`add_material` intent만 있는 대화의 실제 게시/완료를 각각 검사했다. 4개 모두 기존 분석과
리포트 ID를 유지하며 새 법률 모델·검색·리포트 생성0회를 통과했다. 이 증거는 사실·자료·
근거가 달라진 대화를 같은 basis로 취급한다는 뜻이 아니다.

실제 브라우저 통합14개는 CLI/실제 Astro/설치된 공유 클라이언트에 연결했다. 양 입장×
후속3경로6, 실제 응답 유실2, 검색 실패·처리 실패/원본 바이트 보존·AI200·동의 철회·
foreign 계정·peer context 수정6을 포함한다. 실행 중 다음 두 공통 결함을 발견해 담당자에게
전달하고 실제 회귀를 보존했다. 아직14개 통과로 기록하지 않는다.

- 00: 완료된 private 분석 작업이 구형 `chat_response`로 노출돼, 실제 공유 workspace
  클라이언트가 존재하지 않는 assistant 응답을 요구한다. 현재 응답 누락 검사는 유지하며
  서버의 인증된 private 작업 표시를 수정 중이다. 설치된 facade 단위 회귀도 같은 오류를
  재현한다. 독립 실패6개는 실제 API로 확인된 기존 사건을 준비하되 결과 DTO를 만들지 않는다.
- 01: 사건 확인 직후 자동 분석/리포트가 올린 기술 revision을 확인 receipt의 옛 revision과
  비교해 확인 화면이 CONFLICT로 남는다. 원래 receipt/request ID와 정본/source proof를
  검증하는 수정 중이며 전체6여정과 ACK2는 이 실제 초기 확인 UI를 계속 통과해야 한다.

이 검사는 실제 외부 모델/법률 API/OAuth/기기 촬영/운영 배포의 인수를 대신하지 않는다.

후속 PR684 exact `30f35a48b8e80b186f48847653fefb7976a35fb9`의 Quality41332285826,
Legal41332285860, PDF41332285862 성공과 main `b6020f9c` 병합을 확인해 통합했다.
실제 설치 workspace facade 회귀가 **1개/36 assertions 통과**로 바뀌었다. public currentJobId와
latest job은 null, 기존 active 사건·리포트 ID는 유지하고 추가 모델/검색0을 검사한다.
raw 내부 작업 lock과 명시 job GET, 일반 채팅의 assistant 누락 검사는 유지한다.

실제 브라우저의 정리 순서도 고쳤다. 브라우저 polling을 offline으로 중지하고 기존 route
handler를 실제 서버가 살아 있는 동안 drain한 뒤 서버를 닫는다. teardown 뒤 ECONNREFUSED를
제품 실패로 오인하지 않으며, 검사 중 실제 fetch 실패는 계속 실패한다. 이 변경 후 검색 실패/
AI200/동의 철회/foreign 계정/peer CAS **5개가 Chromium에서 통과**했다(12.3초).
`bun ci`와 `validate:quick`도 통과했다. quick에는 rework392개/3172 assertions와 기존 경계
674개/6291 assertions 및 모바일/도구 검사가 포함됐다.

남은 NLP 연결 검사에서 수치만 기록해 원인을 확인했다: 게시 후 conversation W15인데
서버 intent는 assistant admission W14를 반환해 현재 UI의 정확 게시 revision 조건과 맞지
않았다. 00에 중앙 projection 계약 검증을 전달했고 UI의 동등 비교를 임의 `>=`로 풀지 않는다.
임시 진단은 제거했다. 01 최종 확인 UI의 CI/main과 이 revision 계약을 소비한 뒤, 처리 실패와
전체6여정/ACK2를 재검증한다. 전체14 통과나 실제 외부 인수 완료는 여전히 주장하지 않는다.

PR683 exact `56b2fb5295c89909ae00ccfe0f890baf68d98c9a`의 Quality41333275468 성공과
main `341b795e`를 확인해 소비했다. 실제 초기 질문2×3→재조율 확정→Workspace 진입을
수동 이동 없이 통과하고, action ACK 유실과 ReportReview 자체 준비 ACK 유실 **2개가
Chromium에서 통과**했다(44.4초). 실제 commit 뒤 잃은 응답이며 원래 전체 입력과 key를
유지한다. 따라서 실제14개 중 NLP와 독립인 경계5+ACK2가 통과했다. 중앙 intent의 W는
검증된 동일 owner/operation/workspace의 completed job과 암호화 메시지를 통해 실제 게시
W로 projection한다고00과 확정했다. UI의 정확 비교와 과거 intent 차단은 유지한다.

WebKit의 NLP 독립7개 중6개가 통과했고, 동의 철회1개는 offline 상태의 route 종료를
기다리는 테스트 정리 단계가120초를 소진했다. proxy는 새 요청을 abort하는 route를
context 종료까지 유지하고 실제 upstream fetch만 drain하도록 수정했다. 같은 동의 철회는
2초에 통과했다(전체6.3초). 검사 중 실제 fetch 실패를 성공 DTO로 대체하지 않는다.
앞선 offline→unroute wait 정리 방식은 이 수정으로 대체했다. 01이 별도 관찰한 WebKit
summary200 이후 body 읽기 오류는 이 검사들에서 재현되지 않았으며 해결로 단정하지 않는다.

## 2026-11-02 실제 업로드 연결과 새 요청 source 경합

실제 SDK 업로드를 대화 전송으로 이어갈 때 최초 전송 전에 전체 사건/맥락/메시지/자료의
의미가 그대로인지 검증한다. 요약이 불완전하거나 pagination이 남으면 자동 전송하지 않고
입력을 보존한다. 기술 작업 revision만 진행한 경우에도 fresh Workspace/Case/conversation의
동일 revision, 원본 hash·파일명·크기·MIME와 처리 완료를 확인해야 한다. 업로드 전 원본 기준을
동결하며 새 자료 외의 사실·질문·다른 자료·맥락 변경은 명시 재검토로 돌린다. 이미 전송한
요청은 이 경로에서 새 revision으로 바꾸지 않는다. 관련 순수 경계21개/29 assertions와
실제 Workspace Chromium90개, 격리 에이전트 Chromium11개/WebKit11개가 통과했다.

실제 API 검사에서 upload ACK의 원본 hash가 사라지는 문제를00에 전달했다. 중앙 PR687
및 PR688(main `f17f7181`, exact `7a3919546ce52086071935b856374c133d85a154`,
Quality41339390069 성공)를 통합한 뒤 실제 SDK ACK→처리 ready의 동일 원본 hash와 R2 전체
바이트, 실제 Docker PDF/예약·저장 용량 일치 검사가1개/56 assertions로 통과했다.
제품에서 원본 hash를 재계산하거나 임의 기본값으로 대체하지 않는다.

실제 브라우저의 처리 실패와 원본 전체 바이트 검사가 통과했다. 실패한 자료는 대화에
반영됐다고 게시하지 않고 기존 파일 검토와 원본 다운로드를 제공한다. 전체 여정의 자료
업로드→대화 반영→inline 자료 검토까지 실제 서비스로 연결됐다. 320px 캡처는 열린 dialog
1개, 전경과 조상 opacity1/filter none/진행 animation0을 확인한 뒤 보존했고, 선명한 본문과
버튼을 직접 확인했다. 안정화 전 중첩·흐린 캡처는 시각 검증 증거로 사용하지 않는다.

새 자료 후 재확인 경합은 정확한 요청 수치로 좁혔다. 옛 재확인 취소는 expectedW36의
POST200/W37, 새 요청은 expectedW37/S3의 POST202/W38/pending, 직후 GET200은
같은 W38/stale였다. 명시 최신 읽기1회는 설명을 보존하지만 새 제안을 만들지 못했다.
이는 POST409나 UI revision 비교를 느슨하게 해서 해결할 문제가 아니다. 00·01에
실제 protocol을 전달했고 새 operation의 admission source와 옛 receipt의 immutable
source를 구분하는 중앙 수정 전에는 같은 실패를 반복하지 않는다. 전체6여정/14개 통과는
아직 기록하지 않는다. 독립 관련 검사169개와 검토 다운로드5개는 현재 main 통합 뒤 통과했다.

검사 head `1d1431966c23fac07dddb827ca00d8d74c6d84d8`의 `bun ci`,
`validate:quick`(Astro541파일 error0,534/415+4 opt-in skip/674개와 도구 검사),
`validate:build`와 실제 local production workerd 부팅이 통과했다. 격리 에이전트는
Chromium11개(7.2초)/WebKit11개(9.8초)를 다시 통과했다. 이 head의 Quality41341386680,
Legal41341386716, nativePDF41341386787도 모두 성공했다. 수정 전 실제202→stale의 원본
protocol/로그/화면은 `/tmp/baro-625-recon-202-stale-original`에 별도로 보존했다.

PR689 exact `dcfe45361db68b21441333b12298c4f1c59c6479`의 CI/main `cd05ff0e`와
PR690 exact `b871c9936b124c57cf6b0c5a2fd7b0772ea2c569`의 Quality41343082762 성공/main
`9800a92e`를 확인해 통합했다. 실제 새 요청은 expectedW37/S3의202/W38/pending→
GET W39/proposed→확정200/W40/confirmed(S4)→fresh W42~43에서 원래 confirmedW40/S4를
유지해 source 결함 해소를 확인했다. 첫 여정의 자료 반영 메시지는 실제 commit 응답1회를
유실한 뒤 명시 재전송에서도 전체 본문/key 동일, 첨부 메시지1개를 통과했다.

확인 후 `onChanged` 읽기가 경쟁 갱신으로 null을 반환하면 빈 재확인 영역에 남는04 조립도
수정했다.01이 이미 검증한 완료와 후속 상태 조회를 구분하고, 현재 mounted/epoch와 읽기
권한을 다시 확인한 뒤 analysis 또는 현재 report 읽기 화면만 연다. 확인 receipt나 revision
조건을 완화하지 않으며 POST/모델 호출을 추가하지 않는다. 실제 상태 조회503/parse와 부모
읽기 실패는 열린 영역 안에서 오류와 명시 `상태 다시 확인`을 제공한다. 무한 확인 중 문구를
남기거나 자동 retry를 늘리지 않는다. poll 중단/명시 복구/추가 action0을 포함한 격리 대화 UI
Chromium13개(8.7초)/WebKit13개(10.6초)가 통과했다.

후속 실제 여정은 자동 조사→NLP 리포트 요청→본문HTML까지 통과한 뒤 PDF200의 사후
freshness 검증에서 중지했다. 독립 실제 SDK/D1/native Docker 회귀에서도 같은 report
ID/revision2/basis/analysisReview와 같은 analysis.basis, summaryConfirmed=true인데
workspace W28→30만 바뀌며 analysis/report가 ready→stale가 됐다. guard는 올바르게
다운로드를 거절했고 browser 저장 성공은0이다.00/05에 숫자와 본문 없는 basis JSON을
전달했다. PDF 자체는52082B/A4 4쪽을 모두 렌더해 한국어·본문·인용·쪽번호의 잘림과 겹침이
없음을 확인했다. 이는 UI 저장/후속 완료의 증거가 아니며 중앙 수정 전 같은 실패는 반복하지
않는다. 전체14개 통과 기록은 계속 보류한다.

PR691 exact `90a42c57041a779add305f2bae09d7bfa3c0183b`의 Quality41345758917,
Legal41345758894, nativePDF41345758901 성공/main `fc00ee2f`를 확인해 통합했다. 중앙은
같은 저장 claim의 암호화 증명으로 PDF의 기술 revision을 판별하고 원래 report ciphertext와
권한/사후 guard를 유지했다.04 native 사후 검증91563dcc도 중앙에 반영돼 merge로 보존했다.

그 뒤 실제 UI PDF 다운로드가 발생했다. Playwright의 fulfilled PDF BrowserResponse.body가
0바이트인 관측 오류는 독립 binary transport probe로 구분했다: 실제 PDF 입력/upstream/
브라우저 저장은 각각52082바이트와 완전히 같은 내용이었고 BrowserResponse만0이었다.
테스트는 같은 URL의 실제 Hono upstream APIResponse 전체 bytes를 메모리에 보존해 저장
파일과 비교한다. 제품 PDF·다운로드 guard를 바꾸지 않는다. 이 비교로 실제 UI PDF51931B,
리포트revision4의 저장과 HTML/basis 보존이 통과했고 새 문서4쪽을 모두 렌더해 확인했다.

다음 직접 해결 선택은 PATCH200 뒤 `검토용 초안 준비`가 비활성이어서 여정을 중지했다.
06의 단일 독립 실제 진단은 선택 자체가 W를 바꾸지 않고, PDF 전부터 resolution이
not_ready/basis=null이었다고 확인했다. snapshot.status=ready와 report.analysisReview.status=
partial의 비교만 달랐으며 ID·scope·검토 시각·currentness·사실 수가 일치했다. 이는 선택이
기술 revision을 올려 freshness를 깨뜨렸다는 증거가 아니다.00의 공통 상태 표시 규칙과06
consumer의 선행 CI/main을 기다린다. 원래 실패의 PDF·HTML·protocol·DOM·로그는
`/tmp/baro-625-resolution-choice-red-original`에 보존했다. 전체 정상14개는 아직 미완료다.

다음 여정은 PDF 전/후와 선택 후의 숫자·enum·해시·합성ID만 `*-readiness.json`에 별도
보존한다. 사건/자료 원문·절차 설명·토큰/쿠키·stack/SQL은 포함하지 않으며 CI artifact 수집
대상에서도 제외한다. 일반 full을 원인 수정 전에 반복하지 않는다. main691 통합 및 이
테스트 관측 보강 뒤 quick(Astro542 error0, 기존674 포함)가 통과했다.

320px 자료 모달의 footer 아래20px에 원문이 드러나는 실제 배치도 측정해 수정했다. 수정 전
scrollport bottom823/footer bottom803의 띠에서 FileReview fieldset/label/본문이 hit-test됐다.
자료 전용 class의 bottom padding을 footer 내부로 옮긴 뒤 시작/중간/끝 모두 bottom823으로
일치하고, 같은 버튼 top631·총scroll437·마지막본문 bottom619를 유지했다. 버튼3개는 각각
44px 높이와44px 이상 너비이며 흰 opaque 배경이 하단까지 덮는다. 실제 route의 독립
Chromium/WebKit 회귀는44px·본문 접근·Escape/초점 복귀까지 통과했다. global Dialog/token과
03 FileReview는 수정하지 않았다.

공통 표시 helper PR692 exact `695a70f2f91a90d14a5a1263b9433b4d294ce935`의
Quality41347886953/nativePDF41347886991 성공/main `6869aa6c`,06 consumer PR693 exact
`4a2e76cac7a220d182554a181b881d818522db2c`의 Quality41348655199 성공/main `38be24aa`를
확인해 통합했다. photo 검증은 최종6여정의 respond_to_claim-save 한 경로만 기존 촬영 picker와
실제 합성 PNG로 준비한다. 다른5경로와 claim-self의 실제 큐 ACK 유실 검사는 유지한다.
실제 기기 카메라 성공이나 low_quality 관찰의 확정 사실 승격을 주장하지 않는다.

main693의 첫 실제 UI 여정은 self 선택→사실 정리 초안→명시 검토/저장→전체UTF8 다운로드
3831B까지 통과했다. PDF 전/후 W46→48에서도 A=ready/R stale=false/S4와resolution active를
유지했고, 선택은 같은 W48에서 resolution revision1→2만 바꿨다. 본문·자료·보고서 상태를
관측한 JSON과 실제 파일은 보존했다. 마지막 Escape/초점 검사에서04 패널의 두 경계를
독립 UI로 재현했다(수정 전2실패/외부초점1통과): body가 opener로 저장되면 닫은 후 입력창을
찾지 못하고, 완료된 자식 controls가 제거되면 초점이 패널 밖 body로 남는다.

ConversationPanel은 body/document를 복귀 대상으로 쓰지 않고, 작업 완료 후 현재 owner/epoch가
유효하며 다른 control이나 열린 native dialog가 초점을 갖지 않을 때에만 지속 heading으로
복구한다. 전역 Escape는 추가하지 않았다. 외부초점·nested native dialog의 Escape 우선순위·
계정 전환의 지연 결과/초점을 포함한 격리 UI Chromium16개/WebKit16개가 통과했다. 실제
전체 여정에는 임의 focus 이동을 넣지 않았으며 audit 전후 초점의 최소 metadata만 기록한다.
