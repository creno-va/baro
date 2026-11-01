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
