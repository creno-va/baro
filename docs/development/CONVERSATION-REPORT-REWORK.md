# 대화·법률 분석·리포트 개편 통합 기록

- 사용자 지시: 2026-11-01. 상위 [#620](https://github.com/creno-va/baro/issues/620).
- 단독 변경 소유자: **BARO-REWORK-00 통합**. 각 담당은 이 문서를 직접 수정하지 않고 변경 명세·검증 결과를00에 전달한다.
- 기준 main: `4a5bfe85d2f53d15812f592f9261a5b84767695c` / PR619 / main CI41289887458 SUCCESS. 실행 시 재확인한다.
- 통합 전용 checkout: `/Users/hwang-eunchan/.codex/worktrees/9cd5/baro`, 깨끗한 최신 main에서 `codex/621-rework-state` 생성.
- 기존 #600은 CLOSED, 열린 PR0개 확인. PR618/619까지의 UI·동의·DB 전환 변경을 보존한다. 다른 worktree·secret·이전 리포트·원장을 초기화하지 않는다.
- `bun run work:next`: 56 tasks, no cycles. pinned Bun1.4.0 설치 후 `bun ci` 통과.
- 계약 PR628: exact head `faa7bbd96256ee5e2439ad2e7ff28ee5aec23657`, CI41297706438·Legal41297706429 SUCCESS → main `b5b7de06554fa939bf4b61448240227c4008d311` 정상 병합.01~06에 전달하고 각 의존 구현을 시작했다.00 후속 브랜치는 `codex/621-rework-runtime`.
- 공통 client/intent·Worker 부팅 수정 PR630: head `3d517033fe596556d814335e27006eacab03a3a9`, CI41298727259 SUCCESS → main `3df82be88250aba72b9b8018c668e4e7a46f1d55`, main CI41299045604 SUCCESS. 자료 PR629: head `dec7cc2f1e66ab087fe22535ef205d73be07e470`, CI41299129134 SUCCESS → main `b56c000b55c65e42aef23038e162fdaa2cc1c677` 정상 병합.04/05에 실제 재사용 컴포넌트 import 선행 충족을 전달했다.
-00의 저장 후속 브랜치: `codex/621-rework-storage`, 원격 main의 위 두 PR을 통합했다.0022는00만 배정한다. 기존 목적 enum을 무관한 report/summary snapshot으로 위장하지 않기 위해 필요한 암호화 메타데이터 기록/조각 두 테이블만 추가한다. 기존 사실·자료·리포트 DB를 복제하지 않는다.
- 새 채팅·하위 에이전트·자동화 생성 없음. 사용자가 만든 아래 여섯 채팅과 이번 개편 메시지 교환만 허용된다. 메모리 자동 공유를 가정하지 않는다.
- GitHub 커넥터 이슈 생성은403, 인증된 GitHub CLI로 이슈를 생성했다. 채팅 도구가 불가하면 각 하위 이슈 댓글로 조율하고 개인정보는 쓰지 않는다.

- 저장 PR634: head `03eff2aa696335c5f28faad38b4a0b5f50f6a571`, Quality41299707708 SUCCESS → main `bffb5887a64b472e5fb8a39e03a29c10a2ab4761`.0022 적용은 로컬 fresh/upgrade 검증만 수행했고 원격 DB/배포는 하지 않았다.
- 대화 코어 PR633: 최신 main 통합 head `6ea899cea93acdbf5d01222731ced5750365ea55`, Quality41300231923·Legal41300231955 SUCCESS → main `4fc4db00` 정상 병합. 법률 분석 PR631: head `57ad8db31b20442f60451d054b4784647e692e14`, Quality41300646086·Legal41300646132 SUCCESS → main `7a97be35` 정상 병합.
-00 후속 `codex/621-rework-api`: opt-in 사건 생성/context 변경을 같은 암호화 DB admission/CAS에 연결한다. 기존 사건의 목적/절차는 미확정이며 기존 strict workspace 응답은 확장하지 않는다. context 변경·멱등 영수증·revision bump가 원자적으로 저장되고 동의 철회 후 mutation은 차단된다. 기존 raw payload를 덮어 목적을 추정하지 않는다.
- 중앙 gateway는 02의 `workspace_legal_plan / workspace_legal_analysis / workspace_legal_audit` 세 단계를 등록한다. 동일 모델·기존 attempt ledger를 유지하며 generation LOW / 독립 audit MEDIUM이다. 04의 trusted conversation prompt는 중앙 registry에서만 선택한다. 신규 strict provider wire는 `conversationIntent: null` 또는 허용 intent를 필수로 보내되 구형 저장 parser는 누락을 계속 읽는다.
-02 후속 `analysis/runtime-adapter.ts`는 실제 gateway/retrieval adapter(게시/DB 저장/dispatch 없음),06 후속 `resolution/runtime-adapter.ts`는 주입된 trusted source/authority와 실제 암호화 record adapter만 소유한다. DB/Hono/runtime 조립과 최종 source/basis CAS는00 소유를 유지한다. 각 후속은 선행 CI/main 뒤 별도 PR이다.

- 후속 해결 PR632: 최신 head `295c3f5edc882aad9a9f0c40e36049b470bbb52e`, Quality41300962279 SUCCESS → main `bcd37aea`. 자료 연결 PR635: 최신 head `a358ab1b2dd0c4b510607be1b26970e001a02948`, Quality41301290682 SUCCESS → main `11f398fba847f55634634babf339e5b4bf0bf8db`. 공통 API PR637: 최신 head `477ea968f352af964f2fa7b17e59e773faf96875`, Quality41301615008·Legal41301614807 SUCCESS → main `c629d6cc`.
-00 `codex/621-rework-orchestration`의 공통 저장 포트: `prepareReworkJobAdmission`이 기존 chat_response DTO를 유지하며 domain record/job/quota/paid hold/outbox를 같은 최종 claim에 게시한다. 분석은 active/confirmed, 재조율은 최초 reviewing_summary와 active/confirmed 양쪽을 허용한다. `prepareReconciledSummary`는 큰 요약을 봉인한 뒤 canonical 요약과 확인 영수증을 같은 claim에 게시한다. 취소·실패한 이전 미게시 staging은 정본·이전 리포트와 구분하며 폐기된 staging이 다음 확인을 막지 않는다. 구형 정본과 immutable 제안 이력은 보존한다.
- 분석 task는 서버가 암호화한 job/operation/target/before/summary identity가 일치할 때만 technical revision을 연구 기준에서 제외한다. 다른 mutation·요약/자료 변경·구형 일반 chat은 제외하지 않는다. queued/running 작업 중 UI receipt/continuation은 제한된 metadata capability만 쓰며 analysis/정본 게시, revision bump, SQL hook에는 사용할 수 없다. 재조율 취소의 job/hold/receipt 원자 처리는00 runtime 포트가 전담한다.

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
| BARO-REWORK-00 통합 | `01a1969a-2358-7bc3-be20-f37be534c897` / local | #621 / `codex/621-rework-integration` | 공통 계약/DB/중앙 client·gateway·router·전역 shell/token·실행문서/PRD/ADR | 계약/공통 저장/작업 admission·gateway 선행 병합; 실제 runtime·Hono 통합 중 |
| BARO-REWORK-01 사건정리 | `01a1969a-845b-7381-9353-35f61e9a740e` / local | #622 / `codex/622-intake-reconfirmation` | CaseInput, IntakeQuestions, SummaryReview, 독립 재조율 UI/service/client/mock, 해당 CSS/tests | PR636/646/649/654/655 병합; failed primary 재설명 retire 보강 후속 중 |
| BARO-REWORK-02 법률근거 | `01a1969a-e609-7b53-b4fd-c005a5823052` / local | #623 / `codex/623-automatic-legal-analysis` | legal-retrieval/analysis/*, 전용 analysis prompt/helper·tests/fixture | PR631/638/644/652 병합; 공식 binding·관찰 certainty·같은 bounded round의 절차 조회 보존 |
| BARO-REWORK-03 자료분석 | `01a1969b-76c9-7223-94c1-619b8d81cef9` / local | #624 / `codex/624-evidence-capture` | FileReview, CaseMaterials, ChatAttachments, EvidencePicker/EvidenceUpload/useEvidenceUpload/evidence-state, evidence.css·tests | PR629/635 병합; 재사용 업로드·대화 callback·44px 검증, 실제 카메라 기기/provider 별도 |
| BARO-REWORK-04 대화에이전트 | `01a1969c-6a7f-71c2-9c1a-0f8e2743d9bd` / local | #625 / `codex/625-conversation-agent` | Workspace.tsx·대화 components/workspace service/context/pipeline/execution/stored-message·일반 prompts·영역 CSS/tests | PR633 core 병합; PR642 Workspace·대화 실제 통합/6여정 harness 진행 중 |
| BARO-REWORK-05 리포트 | `01a1969c-c6f0-7122-8f39-c6ac535fa494` / local | #626 / `codex/626-report-rework` | ReportReview/ReportReading·reports 독립 본문/HTML/PDF/service/helpers·CSS/tests | PR641 병합; 6문서28쪽 실제 PDF 렌더·고정 Linux CI 성공, PR657 ACK 유실 전체 요청 보존 병합; 최종 통합 별도 |
| BARO-REWORK-06 후속해결 | `01a1969e-174c-7280-81ac-eb9813ebffb2` / local | #627 / `codex/627-follow-up-resolution` | resolution 독립 서비스/재사용 UI·초안 prompt/helper·영역 CSS/tests | PR632/639/643/645/648/651/653 병합; 순수 source builder·실제 저장·위임 handler 준비 완료 |

한 파일 한 소유자다.03/06은 Workspace.tsx·ReportReview.tsx를 수정하지 않는다. 공통 src/contracts/, src/server/db/, drizzle/, 공통 API/client·facade·export, gateway service/중앙 schemas/등록, router/runtime 조립은00만 변경한다. 기존 `src/server/api/v2/workspaces.ts`는00 소유이며01은 독립 재조율 서비스를 제공한다. handler 신설/위임은 정확 경로를 먼저 기록한다.

전용 `llm-gateway/intake-prompts.ts`는01, `conversation-prompts.ts`는04, `analysis-prompts.ts`/analysis-schema.ts는02, resolution-prompts.ts는06이다. Phase/중앙 registry가 섞인 기존 `prompts.ts`는00 소유로 정리하고04가 작성한 일반 prompt 변경은 독립 helper와 패치 명세로 전달받는다.05는 `scripts/report-regressions.ts`·합성 리포트 QA script/Python과 `.github/workflows/report-rendering.yml` 단일 파일도 소유하며 기존 고정 Linux/PDF 보안 검사를 유지한다.

## 계약과 의존성

계약 버전: `conversation-report-v1`.01~06이 실제 파일을 읽고 필수 blocker 없음/수용을 회신했다. 기존 v1/v2 wire 객체에 새 필드를 무조건 추가하지 않는다. 명시적 새 경로/opt-in DTO에서만 새 기능을 노출하며 설치 클라이언트의 이전 응답을 보존한다. 첫 계약 PR은 DB migration/제품 실행 경로 변경을 포함하지 않는다. `src/contracts/v2/rework.ts`, `legal-analysis.ts`, `resolution.ts`, `conversation-state.ts`가 정본이며 기존 sourceClaim shape는 그대로 추출해 서버가 재사용한다.

HTTP 계획: 새 사건 `POST /api/v2/cases/rework`에서 목적과 사건을 같은 admission에 저장한다. 사건별 경로는 `/api/v2/cases/:id/rework` 아래 context, reconciliation, conversation/actions, resolution/draft로 분리한다. 기존 `api.cases.create`·reports.get 동작은 보존하며 `api.rework`에 새 client를 조립한다. 리포트 상태 조회는 `peek`으로 읽기만 하고 준비/생성은 명시적 액션이다.01 재조율(read/admit/claim/generate/audit/publish/fail/confirm/cancel),02 분석(plan/analyze/audit),04 오케스트레이터,05 readPreparedAnalysis/peek,06 load/authorize/saveCAS는 DI로 제공하고00이 DB/gateway/runtime/router를 연결한다.

| 계약 | 합의 방향 | 상태 |
| --- | --- | --- |
| 사건 맥락 | `casePurpose: prepare_claim / respond_to_claim / unconfirmed`; subjectContext와 별개, 구형 unconfirmed. 절차 단계는 사용자 확인 전 미확정 | 01~06 수용·계약 병합 완료 |
| 재조율 | 요청·이유·exact before/after 제안·base workspace/intake/summary revisions·재접속·멱등성·취소·명시 confirm CAS. 확정 전 canonical summary 불변 | 01 인터페이스 수용,00 저장/중앙gateway 조립 |
| 법률 분석 | 기존 공식 citation/sourceClaim shape 재사용. 요건별 fact/evidence refs·공백/모순, 판례 commonalities/differences·exact sourceClaim IDs, 약점/대응점·추가자료 | 02/05/06 소비 검증 완료·실제 원문 권한/binding/TTL 유지 |
| 분석 기준 | summaryRevision·관련 사건 revision·증거 fileRevision/hash digest·casePurpose·asOfDate. 비교 표시용 revision을 사실 변경과 구분 | 02와 구현 경계 조율 중 |
| 증거 | 기존 files strict DTO 유지. 명시적 requirement.fileIds와 현재 파일/관찰로 대기/처리/검토/반영 계산, 파일명 유형 추측 금지 | 03 인터페이스 수용 |
| 준비 상태 | pending/running/partial/ready/empty/unavailable/stale·실제 실패 구분. 완결성·부족 항목과 snapshot 기준 표시 | 04/05 수용·독립 구현 병합, 중앙 실행 조립 중 |
| 대화/후속 | 서버 action allowlist·입력과 확인·3개 분기·실제 절차/검토용 초안·citation/analysis 기준, 제3자 자동 실행 없음 | 04/06 수용·독립 구현 병합, 중앙 실행 조립 중 |

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
| 암호화 상태 저장 선행 | bun ci·validate:quick·validate:build·validate:db 통과. drift/fresh/upgrade·실제 local D1 import/재적용 확인. multi-part/CAS/소유/철회/삭제/변조/lease 만료/원자 receipt·0021→0022 보존9개34 assertions, 관련 저장/fixture72개436 assertions 통과 | PR CI/main 뒤 도메인 adapter 연결. 실제 원격 DB 변경/배포 없음 |
| 최종 통합 | 미실행 | 양쪽 목적·후속3경로·자료/재조율/revision·실패/계정 전환·삭제를 브라우저 확인 |
| 실제 PDF | 미실행 | 웹/HTML/PDF 근거 일치·전체 페이지 렌더/시각 검토 |
| 최종 main | 미정 | 정확 SHA의 수동 validate:full, 기존 운영 증거·필요 제한 preview smoke. production 배포 없음 |
| 실제 외부 | 이번 작업에서는 미검증 | OAuth·공급자/공식 법률 API·실기기·정책/독립 법률 승인/공개 gate를 합성 결과와 구분 |

첫 계약 PR이나 fixture 성공을 전체 완료로 표시하지 않는다. 이 문서의 PR/CI/main SHA·검증·미해결을 최종까지 계속 갱신한다.

PR628 이후 실제 build 검사에서 export 문자열 상수가 Worker entry로 hoist되어 부팅이 실패했다. primitive export를 제거하고 `v2ReworkVersionSchema.value`를 사용한다. 그 뒤 별도 SSR 청크의 workspace schema 초기화 전 `.extend` 접근 실패를 확인해 새 create 요청은 공유 primitive로 독립 정의하고 응답의 workspace는 lazy로 읽도록 고쳤다. 두 초기 실패는 실제 Worker 부팅 검사로 발견했으며 bundling/dry-run만의 성공과 구분한다. 수정 뒤 같은 local workerd 검사는 성공했다. 이미지 blob 미리보기를 위해 CSP img-src에 blob:만 허용하고 외부 host는 추가하지 않았다.


### 통합 경과 (2026-11-01)

00이 exact head CI 성공을 확인해 squash 병합한 PR: #628 계약/ADR, #630 공유 client와 Worker 부팅, #629 자료 UI, #634 암호화 불변 상태, #633 대화 core, #631 법률 분석, #632 후속 해결, #635 자료 callback, #637 사건 목적 API/gateway, #636 사건 정리/재확인, #638 법률 runtime adapter, #639 후속 저장 adapter, #640 원자 작업/요약 저장, #641 웹·HTML·PDF 리포트, #644 관찰 확실성, #643 공식 절차 근거. 현재 기준 main은 #643 병합 결과이며 최종 SHA가 아니다. #646 저장 adapter와 #645 후속 UI는 순차 최신 main CI 후 병합한다. #642는 통합 중 draft다.

00 공통 상태 PR은 소유자에 한정된 passive conversation/report peek, 전체 확정 요약·증거 hash와 관찰 qualifier를 보존하는 분석 입력, 정확 scope·공식 citation binding/TTL의 로컬 currentness 검사, 입장별 모델 맥락과 재조율 phase 등록을 제공한다. 동의 철회는 새 처리/수정을 막으며 기존 저장본의 currentness 읽기를 새 동의 gate로 막지 않는다. explicit mock은 실제 domain service를 재사용하지만 법률 결과를 unavailable로 명시하며 실제 provider/공식 검증 성공으로 표현하지 않는다. 초기/실행 JSON 입력 순서 차이로 저장된 wire 증명이 맞지 않던 회귀를 수정했다.

현재 검증: 공통 focused51 tests367 assertions, 네이티브 workerd의 기존 원장/업그레이드 보존4 tests1480 assertions, Chromium/WebKit 요청 Blob 원본 바이트·reload·owner별 삭제2 tests 통과. 네이티브 fixture는 과거 consent column/디렉터리 epoch를 해당 migration 이전 형태로 복원하고 실제 업그레이드 뒤 현재 원본과 일치함을 확인했다. 실제 consent 관측 시각이나 원장은 수정하지 않았다. 이 검증은 실제 외부 호출과 무관하다.

남은 구현은 중앙 분석/재조율 job 실행·자동 리포트 continuation, 원자 취소/receipt·동의/lease fencing, 대화 actions·후속 API의 실제 Hono 조립이다. 최종 6여정 브라우저와 exact main 수동 full 검증은 아직 미실행이다. 06이 확인한 실제 EasyLaw 원문들은 update_pending/image_omitted 제한을 유지하므로 현재 실제 formal complaint/answer/appeal 작성 가능 근거로 승격하지 않는다. 합성 fixture에서 검증된 작성 지원과 실제 원문 조건을 구분한다. production 배포는 하지 않는다.

후속 소유권: 06에 `src/server/modules/resolution/source-loader.ts`와 `tests/resolution-source-loader.test.ts`만 명시 위임했다. 네트워크/DB/Hono 조립 없이 authoritative analysis input·현재 snapshot·readonly report·재검증된 procedure 결과로 ResolutionSource를 만드는 pure helper이며 PR648로 제출됐다. fileNames/maskingTokens는00의 현재 owner 읽기에서 주입한다. 공통 기록/취소/receipt/실행·router는00 소유를 유지한다.

PR645의 정확 업데이트 head09cd9790 CI41306228656 성공 뒤 병합했다. PR647 첫 통합 CI에서 HTML/PDF native rendering41306517710이 구형 report-download-work 2개 호환 회귀로 실패했다. 모든 사건에 prepared analysis DI를 연결한 root 분기 누락이었다. 기존 fixture 기대값과 저장된 본문은 보존하고, 실제 암호화 case context의 명시 purpose가 있는 사건에만 per-case factory가 새 DI를 선택하도록 수정했다. 구형 기본 factory는 기존 source format을 유지한다. native D1 billing metadata 누락은 STORAGE_UNAVAILABLE로 실패하며 계정/소유/CAS/처리 동의 gate를 완화하지 않는다. 실패 2개 포함21검사597 assertions 및 factory/동의철회/native meter8검사75 assertions 재통과했고 전체 report285 회귀·quick/build를 재검증한다. 최종 CI 성공 전 이 PR은 병합하지 않는다.


### 중앙 실행 계층과 재개 검증

PR647은 최종 head8302c034의 Quality41307390432/Legal41307390403/native PDF41307390421 성공 후 main43d21cff에 병합했다. 이어 PR648/650/649/651/652/654/653을 각각 exact head의 CI 성공 후 순차 병합했다. 현재 통합 기준 main은13f2d51276070549831d9dd251a9147d5e9ccf37이며 최종 main SHA는 아니다. 개별 담당의 메모리 공유를 가정하지 않고 확인한 인터페이스·검증·의존 main을 해당 채팅으로 전달했다.

00의 codex/621-rework-execution은 실제 native gateway/원장에 분석 3단계와 재조율 생성·독립 감사를 연결한다. 예약과 실행이 같은 투영 입력·달력·고정 invocation을 사용하며, 원래 admission의 시간/금액을 새로 꾸미지 않는다. 재조율의 실제 발급 메시지 암호문·소유자·operation을 확인하고, 별도 isolate의 취소도 현재 job/lease/fencing과 정본 불변을 같은 claim에서 처리한다. summary 전체와 자료 coverage를 읽으며 일반 대화의 8개 fact window로 정본을 잘라내지 않는다.

분석 완료 후 report continuation은 원래 report revision CAS를 암호화한 등록 영수증으로 보존한 뒤 기존 reports.generate를 호출한다. 모델/법률 API를 export에 넣지 않는다. ACK 유실 재요청은 원래 report를 반환하며 이후 사용자가 수정한 리포트는 덮어쓰지 않는다. unavailable/empty와 실제 provider failure를 분리하고, 법률 근거가 준비되지 않은 리포트에는 그 한계를 표시한다. 사용자 편집 보고서는 검증된 새 analysis report로 재승격하지 않는다.

현재 focused 실행20 tests194 assertions, 기존 실제 workerd/D1/원장/업그레이드4 tests1480 assertions 통과. DB drift/fresh/upgrade 및 production build/local workerd 부팅 통과. quick 첫 검사에서 새 테스트의 nullable 타입 오류를 발견해 검사를 유지하며 명시적인 존재 확인으로 수정했고 quick 최종673 tests6286 assertions를 포함한 전체 profile이 성공했다. 이 계층의 callback/port 검증과 최종 중앙 Hono/브라우저 6여정 완료는 구분한다. 아직 중앙 action/후속 handler 조립·서버 자동 준비/재개·최종 browser/PDF/manual full은 남아 있다.


### 실제 중앙 API·자동 준비 조립

PR656 head6c148074f31ca801b6545a168c2cef4ba971b6cc의 Quality41313917239/Legal41313917258/nativePDF41313917231이 모두 성공해 mainb4c51583468c160d9b5b6277bed759decabea13a에 병합했다. PR657은85357f281b03b9c5bd2a0a40f6c9cb6f5ab7ee57의 Quality41314569832/nativePDF41314569810 성공 뒤 mainae054f493f1eb0ce64d739e15c7c874e8645fcdc, PR658은8299c97c8c91dcd475f3ee3a647d92eabd3878fd의 Quality41315267820/Legal41315267814 성공 뒤 main5a1e00748bddc2fcd1a285e2bb2375fc4d63c207, PR655는 최신 base 갱신 후 e40900d8e827286a8e8cb62a0741a0edc8546ecd의 Quality 성공 뒤 main708dbff143b8c42169a490f2e2a72435a3694083에 병합했다. PR659의374b05981846519cf8aec35783a73c02609b426b Quality41316730651/nativePDF41316730663 성공 뒤 main36211308eecc901a9ef5681d415c47cd1e9232ab에 병합했다. 모두00이 exact head로 순차 병합했으며 관리자 우회·main 직접 push·배포는 없다.

00 단독 소유 중앙 파일은 modules/rework/runtime.ts·resolution-runtime.ts와 기존 rework API/workspace API/runtime/dispatch 조립이다. 실제 Workflow는 기존 chat_response DTO와 outbox를 유지하면서 private analysis/reconciliation record에 따라 실행을 분기한다. 목적 opt-in이 없는 옛 사건은 자동 분석 대상으로 추정하지 않는다. 최초 요약·재조율 확인, 목적/절차 변경과 자료 처리 완료 뒤 준비를 재개하고, 브라우저가 닫혀도 기존 제품 dispatch scheduler의 bounded4/rotating scan으로 미완료 의도를 복구한다. GET/poll은 새 작업을 접수하지 않는다.

자동 의도는 사건 basis와 기술 설정만 구분한다. 가격/FX/funding/allocation 관측은 fingerprint나 실행 gate가 아니다. 같은 조건의 provider 실패는 자동 반복하지 않고 실제 AI 일일 한도 초기화만 새 일자의 별도 요청/CAS로 재개한다. 공급자 실패·필수 기술 설정 누락은 실패로 남기고, 준비 가능한 사실 리포트에는 법률 분석 미완료를 표시한다. 사용자 편집·추가 증거·절차/목적 변경은 원래 요청의 report CAS로 구분한다. 새 근거의 새 리포트와 이전 immutable 보고서를 보존한다.

대화 actions는 owner/case/request 전체 hash와 HTTP key 바인딩을 유지하고 durable paid receipt를 expectedRevision보다 먼저 재확인한다. 후속 handler는 실제 resolution 저장 adapter, 현재 report/analysis/source/input/scope와 최종 시각의 binding·TTL·권한·session/CAS를 사용한다. 저장 citation·원문·리포트 snapshot identity를 그대로 동결하고 새 시각을 만들어 승격하지 않는다. 재조율의 늦은 사용자 확정도 공식 출처를 재검증하며, 감사 뒤 TTL이 만료되면 같은 live request/job/lease에서 실패 metadata만 기록한다. 삭제된 correction source의 취소와 terminal Workflow 실패 후 retire는 정본을 바꾸지 않는다. 해당 private job은 구형 chat retry로 다시 실행하지 않는다.

현재 actual signed Hono/DB/AES의 두 입장×후속3선택, 실제 초안/저장 handler·멱등 replay·동의철회 저장본 읽기/새 쓰기 차단·계정 전환, 자동 준비/실패/AI 일자 복구·증거 변경·이전 report 보존·실제 native plan/analyze/independent audit/공식 파서·binding→report/HTML 일치15 tests162 assertions를 통과했다. 재조율 actual native·독립 audit·other-isolate cancel·issued source 삭제·actual terminal recovery·사용자 지연 확정 TTL·감사 뒤 자연 만료9 tests86 assertions를 통과했다. native workerd/기존 복구51 tests1896 assertions, quick 전체 profile(마지막673 tests6286 assertions 묶음 포함), DB drift/fresh/upgrade를 통과했다. 초기 중앙 분기 반환 type이 기존 내부 stageTimings 추론을 좁히는 typecheck 실패를 보존하고, 실제 metadata 타입을 유지하는 반환 선언으로 수정했다. 현재 tree production build/local workerd 재확인 중이다.

최종 검증용 test-only 파일 소유권을 명시 배정했다.04는 tests/helpers/rework-native-model.ts(외부 모델 출력만)·rework-runtime-fixture.ts(같은 중앙 제품 factory에 서명 session/Hono/DB/AES/원장을 그대로 조립)·기존 loopback/browser harness를 소유한다.03은 tests/helpers/rework-native-processor.ts의 외부 native probe/process transport만 소유하고 DB/job/admission/cost를 대체하지 않는다.05는 tests/helpers/rework-pdf-processor.ts의 격리 Docker에서 제품 report.py를 실제 실행하는 PDF transport만 소유한다.04가03/05 helper를 재사용하며 도메인 로직·DTO 응답을 복제하지 않는다. 실제 PDF 파싱/카메라/provider 인수와 정확 bytes의 합성 upstream 처리를 구분한다. 중앙 제품 파일은 계속00 소유다.

전체 intake2×3→재조율/확인→자료/사진→공식 근거 분석→report→후속6여정 browser와 실제 최종PDF 생성·렌더·검토, exact 최종 main manual validate:full은 아직 남아 있다. 합성 native/공식 source·model 검증은 실제 계정 provider/OAuth/법률 승인·공개 gate 성공이 아니다.

중앙 Workflow dispatcher에 HTTP에서 선택할 수 없는 5번째 constructor options를 연결해 offline source transport와 같은 report factory를 실제 production dispatcher가 소비한다. 기본4인자 운영 동작은 같다. 최종 fixture가 private job 선택 분기를 복제하거나 실제 외부 법률 API로 유출되지 않도록 하는 포트이며, signed Hono 검사의 모든 job drain도 이 dispatcher로 바꿨다. 기존 runtime9+새중앙15 =24 tests240 assertions 재통과. PR661은 이 작은 포트까지 포함한 새 head로 CI를 다시 확인한다.
