# 대화·법률 분석·리포트 개편 통합 기록

- 사용자 지시: 2026-11-01. 상위 [#620](https://github.com/creno-va/baro/issues/620).
- 단독 변경 소유자: **BARO-REWORK-00 통합**. 각 담당은 이 문서를 직접 수정하지 않고 변경 명세·검증 결과를00에 전달한다.
- 기준 main: `4a5bfe85d2f53d15812f592f9261a5b84767695c` / PR619 / main CI41289887458 SUCCESS. 실행 시 재확인한다.
- 통합 전용 checkout: `/Users/hwang-eunchan/.codex/worktrees/9cd5/baro`, 깨끗한 최신 main에서 `codex/621-conversation-report-contract` 생성.
- 기존 #600은 CLOSED, 열린 PR0개 확인. PR618/619까지의 UI·동의·DB 전환 변경을 보존한다. 다른 worktree·secret·이전 리포트·원장을 초기화하지 않는다.
- `bun run work:next`: 56 tasks, no cycles. pinned Bun1.4.0 설치 후 `bun ci` 통과.
- 계약 PR628: exact head `faa7bbd96256ee5e2439ad2e7ff28ee5aec23657`, CI41297706438·Legal41297706429 SUCCESS → main `b5b7de06554fa939bf4b61448240227c4008d311` 정상 병합.01~06에 전달하고 각 의존 구현을 시작했다.00 후속 브랜치는 `codex/621-rework-runtime`.
- 새 채팅·하위 에이전트·자동화 생성 없음. 사용자가 만든 아래 여섯 채팅과 이번 개편 메시지 교환만 허용된다. 메모리 자동 공유를 가정하지 않는다.
- GitHub 커넥터 이슈 생성은403, 인증된 GitHub CLI로 이슈를 생성했다. 채팅 도구가 불가하면 각 하위 이슈 댓글로 조율하고 개인정보는 쓰지 않는다.

## 요구사항과 유지 경계

1. `/app` 주 선택은 고소·청구 준비 / 상대방 주장 대응이다. `subjectContext` 개인/기업, 사건 분야·형민사, 절차 단계와 별개다. 옛 사건의 목적·단계를 추정해 확정하지 않는다.
2. canonical 요약 raw text 편집 대신 정확한지 확인하고, 수정/추가 설명을 받으면 AI 변경 제안을 만들고 사용자가 재확인한다. 제안 자체는 정본을 바꾸지 않는다.
3. 대화 종료 시 현재 사건과 증거에 기반한 검토 가능한 리포트를 준비한다. 법 조항·요건별 사실/자료·미확인 사항, 유사 판례의 구체적 공통점/차이점, 우리 측 약점과 보완 자료를 포함한다.
4. 법령/판례는 사건 맥락으로 자동 조사한다. 일반 판례 탐색 결과·readToken은 검증된 리포트 citation이 아니다. 공식 원문 검증·이용 권한·주장 binding·원문 hash·독립 감사·snapshot 저장 경계를02와 해결한다.
5. 자료 탭·대화·리포트가 같은 업로드·검토·사진 촬영 경로를 사용한다. 업로드 완료·분석 완료·사건에 반영은 각각 표시한다. 진단·인과관계·사진 시각·증거 진정성을 만들어내지 않는다.
6. 대화에서 조회·검토·확인·실행을 이어가고 리포트 후 직접 해결 / 변호사와 해결 / 리포트만 저장으로 분기한다. 직접 해결은 실제 절차·제출처·담당기관·검토용 문서 초안이며 사용자 대신 제출·연락하지 않는다.
7. 추가 증거·요약/목적 변경은 분석 기준 revision을 갱신하고 이전 리포트를 보존한다. 자료 부족·검색 실패·관련 판례 없음·공급자 오류를 빈 성공이나 근거 조작으로 숨기지 않는다.
8. 웹 우선, 설치된 네이티브/strict DTO·구형 사건/리포트 읽기·계정 전환·동의 철회·삭제·업로드 복구·실제 오류를 보존한다.

비용 관측 전용·AI200/일·초기 질문2×3·실제 물량/메모리/시간/시도 제한·owner/동의/암호화/삭제/revision/lease/독립 audit를 유지한다. 모델은 llm-gateway, 법률 조회는 legal-retrieval만 경유한다. 기존 공급자·모델·결제 경로만 사용한다. 실제 외부 키 없이 offline 구현/PR을 완료하되 실제 인수를 구분한다. main 직접 push·이번 production 배포는 없다.

## 채팅과 이슈·소유권

실제 thread 도구로 제목과 ID/host를 확인했다. 표의 브랜치는 담당의 최종 보고로 갱신한다.

| 세션 제목 | thread ID / host | 이슈·브랜치 | 소유 범위 | PR/상태 |
| --- | --- | --- | --- | --- |
| BARO-REWORK-00 통합 | `01a1969a-2358-7bc3-be20-f37be534c897` / local | #621 / `codex/621-conversation-report-contract` | 공통 계약/DB/중앙 client·gateway·router·전역 shell/token·실행문서/PRD/ADR | 인터페이스 조율·계약 준비 |
| BARO-REWORK-01 사건정리 | `01a1969a-845b-7381-9353-35f61e9a740e` / local | #622 / `codex/622-intake-reconfirmation` | CaseInput, IntakeQuestions, SummaryReview, 독립 재조율 UI/service/client/mock, 해당 CSS/tests | 인터페이스 회신·fixture 준비 |
| BARO-REWORK-02 법률근거 | `01a1969a-e609-7b53-b4fd-c005a5823052` / local | #623 / `codex/623-automatic-legal-analysis` | legal-retrieval/analysis/*, 전용 analysis prompt/helper·tests/fixture | 공식 원문/binding/분석 인터페이스 회신 |
| BARO-REWORK-03 자료분석 | `01a1969b-76c9-7223-94c1-619b8d81cef9` / local | #624 / `codex/624-evidence-capture` | FileReview, CaseMaterials, ChatAttachments, EvidencePicker/EvidenceUpload/useEvidenceUpload/evidence-state, evidence.css·tests | 기존 upload/vision 재사용·인터페이스 회신 |
| BARO-REWORK-04 대화에이전트 | `01a1969c-6a7f-71c2-9c1a-0f8e2743d9bd` / local | #625 / `codex/625-conversation-agent` | Workspace.tsx·대화 components/workspace service/context/pipeline/execution/stored-message·일반 prompts·영역 CSS/tests | 인터페이스 수용·독립 fixture/UI 준비 |
| BARO-REWORK-05 리포트 | `01a1969c-c6f0-7122-8f39-c6ac535fa494` / local | #626 / `codex/626-report-rework` | ReportReview/ReportReading·reports 독립 본문/HTML/PDF/service/helpers·CSS/tests | 인터페이스 수용·독립 PDF20쪽 렌더 검증 |
| BARO-REWORK-06 후속해결 | `01a1969e-174c-7280-81ac-eb9813ebffb2` / local | #627 / `codex/627-follow-up-resolution` | resolution 독립 서비스/재사용 UI·초안 prompt/helper·영역 CSS/tests | 인터페이스 수용·fixture/quick 통과 |

한 파일 한 소유자다.03/06은 Workspace.tsx·ReportReview.tsx를 수정하지 않는다. 공통 src/contracts/, src/server/db/, drizzle/, 공통 API/client·facade·export, gateway service/중앙 schemas/등록, router/runtime 조립은00만 변경한다. 기존 `src/server/api/v2/workspaces.ts`는00 소유이며01은 독립 재조율 서비스를 제공한다. handler 신설/위임은 정확 경로를 먼저 기록한다.

## 계약과 의존성

계약 버전: `conversation-report-v1`.01~06이 실제 파일을 읽고 필수 blocker 없음/수용을 회신했다. 기존 v1/v2 wire 객체에 새 필드를 무조건 추가하지 않는다. 명시적 새 경로/opt-in DTO에서만 새 기능을 노출하며 설치 클라이언트의 이전 응답을 보존한다. 첫 계약 PR은 DB migration/제품 실행 경로 변경을 포함하지 않는다. `src/contracts/v2/rework.ts`, `legal-analysis.ts`, `resolution.ts`, `conversation-state.ts`가 정본이며 기존 sourceClaim shape는 그대로 추출해 서버가 재사용한다.

HTTP 계획: 새 사건 `POST /api/v2/cases/rework`에서 목적과 사건을 같은 admission에 저장한다. 사건별 경로는 `/api/v2/cases/:id/rework` 아래 context, reconciliation, conversation/actions, resolution/draft로 분리한다. 기존 `api.cases.create`·reports.get 동작은 보존하며 `api.rework`에 새 client를 조립한다. 리포트 상태 조회는 `peek`으로 읽기만 하고 준비/생성은 명시적 액션이다.01 재조율(read/admit/claim/generate/audit/publish/fail/confirm/cancel),02 분석(plan/analyze/audit),04 오케스트레이터,05 readPreparedAnalysis/peek,06 load/authorize/saveCAS는 DI로 제공하고00이 DB/gateway/runtime/router를 연결한다.

| 계약 | 합의 방향 | 상태 |
| --- | --- | --- |
| 사건 맥락 | `casePurpose: prepare_claim / respond_to_claim / unconfirmed`; subjectContext와 별개, 구형 unconfirmed. 절차 단계는 사용자 확인 전 미확정 | 01/02 수용,06 확인 필요 |
| 재조율 | 요청·이유·exact before/after 제안·base workspace/intake/summary revisions·재접속·멱등성·취소·명시 confirm CAS. 확정 전 canonical summary 불변 | 01 인터페이스 수용,00 저장/중앙gateway 조립 |
| 법률 분석 | 기존 공식 citation/sourceClaim shape 재사용. 요건별 fact/evidence refs·공백/모순, 판례 commonalities/differences·exact sourceClaim IDs, 약점/대응점·추가자료 | 02 초안 수신,05/06 확인 중 |
| 분석 기준 | summaryRevision·관련 사건 revision·증거 fileRevision/hash digest·casePurpose·asOfDate. 비교 표시용 revision을 사실 변경과 구분 | 02와 구현 경계 조율 중 |
| 증거 | 기존 files strict DTO 유지. 명시적 requirement.fileIds와 현재 파일/관찰로 대기/처리/검토/반영 계산, 파일명 유형 추측 금지 | 03 인터페이스 수용 |
| 준비 상태 | pending/running/partial/ready/empty/unavailable/stale·실제 실패 구분. 완결성·부족 항목과 snapshot 기준 표시 | 04/05 확인 중 |
| 대화/후속 | 서버 action allowlist·입력과 확인·3개 분기·실제 절차/검토용 초안·citation/analysis 기준, 제3자 자동 실행 없음 | 04/06 확인 중 |

선행 계약의 CI 성공/main 병합→01/02/03/06 병렬 구현→필요한 공유 저장/gateway 조립→04/05 최종 통합 순서다.04/05는 명시적 독립 fixture/UI를 먼저 진행할 수 있다.02→06(근거 기반 안내/초안),01/02/03/06→04,02/03→05,04→05의 실제 의존성은 작은 인터페이스로 나누고 순환 구현 복제를 만들지 않는다. 기능 담당은 PR까지만 제출하고00이 CI·main/의존 PR 상태를 재확인한 뒤 순차 병합한다.

## 제품·정책·디자인

ADR-0006의 사실 준비 전용/완성 문서 일괄 거절, PRD/MVP·AI prompt의 blanket strategy refusal가 이번 요청과 충돌한다. 새 ADR과 PRD/MVP에 이번 범위의 근거 기반 분석·취약점/대응점·검토용 문서 초안을 명시한다. 확정 법률 판단·결과/승소 보장·근거 조작·불리한 자료 은폐·사용자 대신 제출/연락은 허용하지 않는다. 초안 인수·사용자 제품 방향 승인을 독립 법률 승인으로 바꾸지 않고 기존 공개 gate를 우회하지 않는다.

디자인 기준은 docs/design/PRODUCT-UI.md, CONVERSATION-UI.md와 현재 /app·Workspace·ReportReview다. #2364e8/#191f28/#f6f8fb, Pretendard, Lucide, 공통 버튼/Dialog/상태 UI, 주요44px 이상 터치 영역·읽기 열을 유지한다. 개인/기업 맥락과 목적을 혼동하지 않고 별도 브랜드나 디자인 체계를 만들지 않는다. 랜딩은 범위 밖, 담당별 영역 CSS를 사용한다. 코드·실제 기준 화면 비교는 담당 브라우저 검증과 최종 통합에서 기록한다.

## 검증과 미해결

| 범위 | 실행/결과 | 남은 일 |
| --- | --- | --- |
| 시작 상태 | main SHA/CI·열린 PR0·#600 CLOSED·work:next·clean branch·bun ci 확인 | 계약 구현/담당 확인 |
| 계약 PR | bun ci·validate:quick exit0. 계약/기존 v2 44개422assertions, 관련 retrieval/설치 cases/reports client135개729assertions 통과. 계약 타입·lint·diff 통과 | CI/main 병합 뒤 제품 구현 시작; build/DB 변경 없음 |
| 클라이언트/실행 연결 선행 | bun ci·validate:quick·validate:build 및 실제 local workerd 익명 로그인 부팅 통과. scope/owner/동의/취소/요청 복구·challenge 회전 검증 | PR CI/main 후 담당 UI가 새 namespace를 사용한다. 실제 서버 조립은 다음 PR |
| 최종 통합 | 미실행 | 양쪽 목적·후속3경로·자료/재조율/revision·실패/계정 전환·삭제를 브라우저 확인 |
| 실제 PDF | 미실행 | 웹/HTML/PDF 근거 일치·전체 페이지 렌더/시각 검토 |
| 최종 main | 미정 | 정확 SHA의 수동 validate:full, 기존 운영 증거·필요 제한 preview smoke. production 배포 없음 |
| 실제 외부 | 이번 작업에서는 미검증 | OAuth·공급자/공식 법률 API·실기기·정책/독립 법률 승인/공개 gate를 합성 결과와 구분 |

첫 계약 PR이나 fixture 성공을 전체 완료로 표시하지 않는다. 이 문서의 PR/CI/main SHA·검증·미해결을 최종까지 계속 갱신한다.

PR628 이후 실제 build 검사에서 export 문자열 상수가 Worker entry로 hoist되어 부팅이 실패했다. primitive export를 제거하고 `v2ReworkVersionSchema.value`를 사용한다. 그 뒤 별도 SSR 청크의 workspace schema 초기화 전 `.extend` 접근 실패를 확인해 새 create 요청은 공유 primitive로 독립 정의하고 응답의 workspace는 lazy로 읽도록 고쳤다. 두 초기 실패는 실제 Worker 부팅 검사로 발견했으며 bundling/dry-run만의 성공과 구분한다. 수정 뒤 같은 local workerd 검사는 성공했다. 이미지 blob 미리보기를 위해 CSP img-src에 blob:만 허용하고 외부 host는 추가하지 않았다.
