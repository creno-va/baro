# 대화 에이전트 통합 검증 (#625)

이 문서는 합성 사건의 검증 계약이다. 실행 결과는 검사 후 별도로 기록한다. 실제 외부
모델·법률 API·OAuth·배포 성공을 합성 결과로 대신하지 않는다. 공통 계약과 통합 상태의
정본은 `docs/development/CONVERSATION-REPORT-REWORK.md`이며 통합00이 관리한다.

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
