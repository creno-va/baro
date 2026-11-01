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

자동 준비도 기존 ANALYSIS_ACCOUNT_LIMIT를 paid admission 전에 검사한다. 실제 rate 제한 중에는 미접수 의도를 보존해 다음 허용 시 재개하며 provider 호출/작업을 만들지 않는다. 이 검사 추가 뒤 중앙 actual dispatcher16 tests168 assertions 통과(기존 두 목적의 법령·판례/요건·비교/HTML 일치 포함). 가격·재원 관측을 이 경계에 섞지 않는다.

### 전체 검증 준비와 실제 네이티브 포트 (2026-11-02)

PR661 최종 head83d56e2f134e0e8038e892602a42b6b007e4f26d의 Quality41318509274/Legal41318509293/nativePDF41318509282 성공 후 main8f72e392f1996cba4ed963de8e84d0b6af4976f0에 병합했다. production build/local workerd 부팅도 성공했다. PR660 최종8174be4e859fc56f6c883bfbcc1a8ca20ea8bb57의 3개 CI 성공 후 maindcae393fc0bbb6f070e99a359cfeb9b0294d12a0, PR662 최종db225c75dfcf04410b22269eb602ceed881b8ccf의 Quality 성공 후 main8ff896a43f9786944a71dea3d69005df4f9c99ae에 병합했다. PR663 최종ee2a66b97601d9a54566ecee617b18f135af5d33의 Quality41320026615/Legal41320026562/nativePDF41320026548 성공 후 main04754d64c8f5fc38f65e05e65046b48c9fbe8ebe에 병합했다. PR664는 최신 main base로 갱신해 CI 재검증 중이다. 최종 main SHA는 아직 아니다.

660은 외부 모델 출력 포트만 제공하며 실제 initial 2×3/요약/native wire/audit를 소비하는 5 tests40 assertions를 통과했다. 663은 격리 Docker의 실제 제품 report.py를 실행하는 PDF transport이며 실제 native 4 tests17 assertions를 통과했다. 664의 byte/hash 기반 사진·텍스트 처리 포트는 8 tests115 assertions를 통과했으며 등록된 PDF bytes의 합성 페이지 처리를 실제 PDF parser 인수로 표현하지 않는다. 이 포트들은 DB/원장/admission/lease를 대체하지 않는다.

00의 `codex/621-rework-validation`은 전체 검사에서 발견한 기존 fixture drift를 test-only로 수정한다. 최초 unit 실행은 4,931 pass/29 fail이었다. 과거 consent 컬럼, SQL wall clock과 선언된 합성 fixture 월의 불일치, 삭제 journal 스케줄, 현재 한 개 선택 계약과 구형 30개 자산 보존 검사의 혼동이 원인이었다. native D1 복사는 source fixture의 선언 월로 초기화하고 파생 mirror는 실제 trigger로 재구성한다. retired consent 컬럼은 과거 migration target에서만 복원한다. 합성 cleanup schedule만 fixture 시간으로 맞추며 provider/funding/billing 관측 시각·금액·원장은 수정하지 않는다. 구형 30개 자산 보존과 D1 100 parameters 경계 검사를 유지하고 새 30개 선택 거절도 확인한다.

수정 후 전체 unit 4,965 tests180,888 assertions/0 fail, bun ci 및 validate:quick 전체 profile(마지막673 tests6,286 assertions 포함)이 성공했다. 관련 실제 native D1/삭제/자산 focused38 tests978 assertions도 성공했다. 이 변경은 제품 코드·schema·migration·비용 정책을 변경하지 않는다. 최종 main의 수동 full과 별개인 사전 검증이다.

04는 실제 서명 session/Hono/DB/AES→초기2×3→요약 확인→native plan/generation/independent audit·공식 citation binding→report ready의 첫 단일 경로를 확인했다. 6개 unknowns를 보존했으며 아직 전체 여섯 브라우저 경로나 최종 PDF 인수로 표시하지 않는다. 최종 전체 여정·실패 경계·모든 PDF 페이지 검토와 exact main 수동 full은 계속 진행한다.

PR664 최종c594432ab511f3b091ee7a07242501ff6bfd03b0의 Quality41320545184/Legal41320545090/nativePDF41320545311 성공 뒤 mainb8687a7ff9a0ccade0395d743482df0830629195에 병합했다. 04에 두 실제 native transport의 main 소비 가능 상태를 전달했다.

사전 broad browser 검사에서 #619의 단일 동의 체크/공통 app 진입/변호사 사건 접근을 구형 기대값이 반영하지 못한 것을 확인했다.00은 tests/browser/auth.e2e.ts·session.e2e.ts·design-system.e2e.ts와 tests/security-browser/csp.e2e.ts를 단독 정비한다.01에는 tests/browser/cases.e2e.ts·public-preview.e2e.ts,05에는 tests/browser/report-draft-revision.e2e.ts·report-retained-pdf.e2e.ts를 단독 위임했다. 키보드·서명 SQL session·로그아웃·owner·CSP·PDF draft/시간/소스 fence 검사를 보존한다. 현재 built CSP는 수정 뒤8 pass/정상 bundle에서 explicit fixture1 skip이며, 나머지 browser는 실패 원인 확인/수정 중이다. 이 사전 검사를 최종 성공으로 표시하지 않는다.

00 소유 인증/공통 shell 검사는 수정 뒤 Chromium27 tests 모두 통과했다. 실제 서명 SQL session의 동의 저장·로그아웃·쿠키 재사용 거절, 계정 역할 변경의 peer navigation, 단일 동의 체크의 on/off·실패 복구·keyboard, 허용된 복귀 경로와 부적절한 URL 거절을 유지한다.01에는 raw canonical 편집을 가정하던 tests/browser/customer-real.e2e.ts도 추가 단독 위임했다. 새 재조율 actual native/ACK 검증은04의 전체 fixture에서 수행하며 테스트를 위해 제품 원장을 대체하지 않는다.

### 통합 회귀의 공통 경계 보강

PR665 exacte517d146d82773b45bddba90ecd90460d95b8498의 Quality41321332843 성공 후 mainf2d2af8d31d7c64ab8a2d8414a9bbab87c09737a에 병합했다. PR666 exactfe7ec12d01b2fab497aa064fa118cb2339ef4ba3의 Quality41321903044 성공 후 main03cdd9dd36177ace7066fe3dc6e16b355c7654d3에 병합했다.666은 cases/public-preview 두 browser 파일만 변경하며 Chromium/WebKit 각7 검사를 통과했다.

00은 별도 clean main worktree의 `codex/621-rework-response-errors`에서 실제 통합이 드러낸 공통 응답 경계를 수정한다. shared JSON requester가 EXPORT_LIMIT_EXCEEDED/EXPORT_RETRY_EXHAUSTED를 일반 입력 오류로 바꾸지 않게 하고, 서버도 크기413/저장503을 보존한다. 사용자 action이 필요한 이 오류를 자동 재요청하지 않는다. 동기 POST /reports 생성만 기존 binary transfer와 같은 최대300초 기술 deadline을 사용하며 passive metadata·job admission은30초, 취소 signal과 export 시도 제한은 유지한다.

자동 게시 중 conversation GET의 source snapshot이 바뀌면 STALE_REVISION만 최대3회 fresh 읽기한다. 매회 signed session/owner와 실제 상태·출처 fence를 다시 확인하고 GET에서 admission/모델/법률 API를 실행하지 않는다. 새 암호화 assistant intent가 첫 workspace revision보다 앞서 게시될 때 기존 코드가 최종 revision fence 전에 wire schema를 검증해400을 반환하는 것을 deterministic actual Hono/DB/AES 회귀로 재현했다. fence를 schema parse 앞으로 옮겨 경합을409로 분류한 뒤 제한적으로 재조회한다. 영구 경합은409, 실제 저장/권한/입력 오류는 그대로 실패한다.

공통 경계 focused29 tests249 assertions 통과: 두 번의 실제 revision 변경 뒤 fresh snapshot, 계속 바뀌는 상태의 최대3회 실패, 재조회 전 logout의401, actual encrypted intent publication의400→fresh200, 실제 저장503/크기413와 provider/job0을 확인했다.48초 리포트 생성·metadata/admission 만료·사용자 취소·300초 binary 한계를 controlled transport로 검증했다. production build/dry-run/actual local workerd 부팅도 통과했다. 초기 테스트 fixture의 잘못된 DB 컬럼/저장 메시지 필드와 타입/포맷 오류는 제품 보호 조건을 변경하지 않고 수정했다.

05의 shared mock 통합에서 ReportMockError가 generic WorkspaceMockError 경계에서 UNAVAILABLE로 바뀌는 추가 문제를 확인했다. 정식 typed export 두 code만413/409로 보존하며 arbitrary 오류를 공식 성공/실패 코드로 승격하지 않는다. 실제 explicit mock의 초과 자료→명시 report 준비에서 크기 오류 전달·빈 report 저장 없음·원본 내용 보존을 포함해 공통 focused38 tests333 assertions를 통과했다. mock에서도 분석 unavailable 고지는 유지한다.

추가 단독 test 소유권:01은 customer-real/recovery-real/human-review와 test-only customer-browser-server의 실제 createReworkApi mount 조립,03은 workspace-shared/customer-completion,05는 report-draft-revision/retained-PDF/real-download/account-session-recovery/reports-integrated다.04의 Workspace 및 workspace.e2e.ts는 계속04 소유다.00은 app-experience/product-ui/shell-integration 등 공통 browser corpus를 정비한다. broad 사전 검사 중 같은 구형 UI 전제로 반복 대기하는 customer-recovery-real/product-ui batch는 실패를 보존하고 중단했으며, 미실행·중단을 성공으로 기록하지 않는다. 최종 manual full은 모든 수정 병합 후 별도 실행한다.

### 실제 스트림 경합과 최종 소비 준비

PR667 exact9661c52adb44542a9074efa63983324eb2eff94c의 Quality41322634194 성공 후 main1bfc35f479196bec34028a5ae0bec641bf4b706e, PR669 exactb844120ad7d1f11156f37e5f4fe16db96bdce77e의 Quality41323091671/Legal41323091688/nativePDF41323091692 성공 후 main929297bbaa440bae5a4cb78bcb901863f0b4630a에 병합했다. PR668 exactd11c33ae5d9dbdd5f0549f4045b3580b2cb4702f의 Quality41323480193/nativePDF41323480138 성공 후 main864f7994db7538898ae1cff6f8dcafe7e6339555, PR670 exact17f25796da42c4ea78c910a2f2d6291409607921의 Quality41324004833 성공 후 maind534c04ad1669fcac2fcbea91720ab66e48b279a에 병합했다.668의 공통 수정 의존 actual Astro22개가 모두 통과했다.670은 명시 peer 무효화 중 재조율 private Dialog를 숨기면서 동일 owner의 임시 장애 초안을 보존한다.

04의 실제 runtime fixture PR672는 아직 draft다. 실제 TXT 처리/원본과 Docker의52,064 bytes PDF 렌더는 실행됐지만 PDF 저장은 계획320 queries/실제321번째 조회에서413으로 실패한다. 실제900 hard bound·물리 용량·lease·원장을 바꾸지 않고,05의 optional scoped authoritative read 포트 PR673과00 공통 binding으로 반복 full 조회를 줄이는 검증을 진행한다. 이 실패를 빈 PDF 성공이나 실제 공급자 인수로 표시하지 않는다.

672의 Quality/Legal CI는 추가 source 조회 경합의400으로 실패했고 native PDF CI만 성공했다.04와 finite category 진단으로 summaryFragments가 revision 변경 시 stream을 중단하고 소비자가 빈/중간 JSON을 파싱하는 원인을 좁혔다. 진단은 원복했으며 원문·stack·SQL·민감 입력을 이슈에 게시하지 않는다.00의 `codex/621-rework-summary-read-fences`는 분석/재조율 소비자가 파싱 전에 실제 current owner/revision/summary source를 확인하게 한다. 재조율 passive GET도 STALE_REVISION만 최대3회 fresh session으로 재조회하고 다른 실패는 그대로 반환한다. 제품 stream·설치 client DTO·유료 admission을 변경하지 않는다.

새 deterministic 회귀4개는 실제 암호화 요약 stream의 첫 fragment 전/중간에 SQLite revision을 변경한다. 수정 전 SyntaxError를 재현했고 수정 뒤 STALE_REVISION과 최신 상태 재읽기를 확인했다. 관련 source/state/actual Hono/runtime44 tests363 assertions, bun ci/validate:quick과 production build/dry-run/local workerd 부팅이 통과했다. 테스트 binding proxy의 타입 오류는 수정했고 검사 기대나 제품 보호를 완화하지 않았다.672의 실제 정상/검색실패 반복 안정성 검사는 이 변경의 CI/main 뒤 다시 수행한다.

01의 key-order 동등 DTO와 실제 값/출처/revision 차이 거절 PR674,03의 shared originals/customer-completion corpus PR671,05의 scoped read PR673은 각각 최신 main CI 뒤 순차 통합한다. 최종 전체14 실제 브라우저 경로·actual PDF 전 페이지·exact main manual full은 계속 미완료로 보존한다.

PR675 exact85093766b851e40b35d40b7e2e4d08fbe902fb39의 Quality41324914769/Legal41324914750/native41324914761 성공 후 main26427659ac8a386334a545e0bf32b4cd3ba1073c, PR673 exact887187a9b22c58e4b589d3dec7dd5dde01cf3949의 Quality41325273600/native41325273571 성공 후 main32abc5f79bf04fede1dfdce19c13f967e90c92a3, PR674 exactcb97649d5472ac6a86188a548e755ab14f507d0d의 Quality41325723886 성공 후 main38dd0f086a6f6e3935dbaeb70806215d3c4896e2에 병합했다. PR676 exact93f28fc0cf4439da5846d21b0dfc7ae91d13a5e6의 Quality41326268025/Legal41326267945/native41326267903 성공 후 maina86862e037aa39caccec26b947f64438126e8666에 병합했다.676은 사용자가 편집한 mock 리포트의 기존 source identity와 checkedAt을 보존하되 검토 필요 상태를 유지한다. 편집 사실을 새 검증 분석으로 승격하지 않고 자료/요약/입장/마스킹/제외 범위 변경은 계속 stale이다.

00의 `codex/621-rework-scoped-current-read`는673의 private scoped read를 실제 opt-in report runtime에 연결한다. 요청 범위와 실제 현재 범위를 먼저 비교하고, owner/audit/원문/binding/TTL을 검증하는 full authoritative read를 한 번 실행한 뒤 현재 범위를 다시 확인한다. export 전후 검증, 최종 source SQL fence, 구형 fallback과900 hard limit는 유지한다. 범위 변경 중 검증 거절과 mismatch 시 full read 미실행을 실제 SQLite 저장/조회로 검증했다. 실제 PDF 저장 성공 여부는04/05의 같은 runtime 재실행 뒤 기록한다.

재조율 source의 독립 context 읽기에서도 summary의 최종 revision fence가 바뀌면 null로 끝나는 경합을 확인했다. 캡처한 owner/revision/암호문/summary ID/snapshot ID가 실제 바뀐 경우에만 STALE_REVISION으로 분류하고 unchanged-source DB 오류는 그대로 실패한다. 기존 DB adapter·stream 계약·범용503 재시도는 변경하지 않는다. 수정 전 deterministic source-change 회귀 실패와 unchanged DB-error 보존을 확인했고, 수정 후 관련37 tests321 assertions·bun ci·validate:quick(673/6286)·production build/local workerd를 통과했다.

04는 실제 일반 대화1회에서 workspace chat/audit 이후 법률 plan/analysis/audit가 추가 실행되는 문제도 재현했다. 의미 변경 없는 turn의 서버 인증과 research revision 계약을00/04가 함께 정리 중이며 현재 미해결이다. 이 회귀와 전체14여정·최종PDF·최종main manual full을 완료로 표시하지 않는다.

PR677 exactcc87f0337204d7745678945fd6d18582f71a934b의 Quality41326734507/Legal41326734552/native41326734560 성공 후 mainec292cbbe7c2486480cba67850bf879ef2795f14에 병합했다.04가 이 main으로 actual signed Hono/native TXT→R2 원본→Docker PDF 저장/다운로드를3회 반복했고 양 입장/재조율/검색 실패/AI200·권한을 포함한15 tests864 assertions를 통과했다. 이전400/503/413은 재현되지 않았다.00은 `/tmp/baro-625-runtime-report.pdf` 실제4페이지를 Poppler로 렌더해 전부 확인했다. 법조항/요건-사실·증거, 판례 공통점/차이점, 약점/보완 자료, 공식 링크와 검증 시각·범위, 합성 출처/모델 고지가 읽히며 잘림·겹침은 없었다. 아직 최종 Workspace14 브라우저 여정의 PDF는 아니다.

00의 `codex/621-rework-neutral-basis`는 DB atomic response publication에서 검증된 사실·당사자·unknowns·행동·완료·타임라인·tool·공식 인용 변경이 전혀 없을 때만 private encrypted unchanged-research-v1 증명을 직접 만든다. 모델이나 요청이 증명을 전달할 수 없다. 실제 completed job/operation과 사용자·assistant revision, 현재 confirmed summary, 선택자료·lookup 부재가 일치한 경우에만 research basis가 대화 admission/publication 두 revision을 건너뛴다. 제안 전용 conversationIntent는 실제 후속 action의 CAS와 분리하며 자체로 사건 변경으로 취급하지 않는다. 구형 unmarked 응답·실패/미완료 job·identity 불일치와 unknowns 빈 배열 clear 등 실제 변경은 경계를 유지한다. public projection이 증명을 제거하므로 설치 client strict DTO는 그대로다. schema/migration·공급자·모델·가격 관측·실제 AI 한도를 변경하지 않는다.

DB 실제 publication/반복 대화/strict public DTO/unknowns clear·action 변경/구형·summary·revision·operation·failed·foreign-owner의 proof 거절과 기존 원문/audit publication39 tests281 assertions를 통과했다.04의 추가 실제 neutral/intent-only4종 회귀는 이 변경 CI/main 뒤 소비한다. DB drift/fresh/upgrade와 quick/build 검증을 별도 수행하고 최종 결과를 기록한다.

이 tree의 bun ci·validate:quick 전체 profile·validate:db drift/fresh/upgrade·validate:build 및 built local workerd 부팅이 모두 성공했다. 최초 quick은 pinned Node PATH가 빠져 보안 baseline probe가 실패했으며, 지정된 Node24.19.0 경로를 사용한 재실행에서 보안 원본 실패/패치 후 거절 검사를 그대로 통과했다. 이를 제품 보호 완화로 해결하지 않았다.

PR671은 변경된 base의 required Quality gate expected로 첫 병합이 거절되어 base를 갱신했다. exact4420b9dd070565a3287ec92fa45ba22a42bee7ea의 Quality41327186274 성공 뒤 main14727d98a108dcf8a8390ec04356a6350a9fc3c6에 병합했으며 보호 규칙을 우회하지 않았다. PR678 exact4bc3a8d15a07c98d8d65026f639760bb467f55bb의 Quality41327474613/Legal41327474628/native41327474743 성공 뒤 main5d3bda3c168551ac42dc468abc8077b2d70fb5da에 병합했다.04의 actual API neutral/intent-only4종138 assertions가 이 main에서 통과했다. 마지막 모델 실행은 chat/audit2개뿐이고 공식 조회·report 생성 증가0, 기존 snapshot/report ID·ready 상태를 유지했다.

PR672 exact5d37bbce2e543174d16cf823ed84560e73c9a82b의 Quality41328012807/Legal41328012753/native41328012730 성공 뒤 mainef58bcc880cbf5b1e6911ab107c382b1f641bb59에 병합했다. fixture foundation만 통합하며 최종 Workspace CLI/14브라우저와 neutral4종 회귀는642에서 소비한다. 실제 마지막 receipt-run은 PDF52,068bytes, blob cipher52,713bytes·stored1, reservation stored1/52,068bytes, PDF binding held/stopped1/52,713bytes, capacity held59,739=totals59,739=held bindings8개 합계이고 writer8개 stopped였다.05가 동일 PDF hash와 JSON 쌍을 독립 확인했고 이전52,070bytes 관측 run과 분리 보존했다. 비용 금액/시각·hold·원장을 조작하지 않았다.

00은 scripts/development-checks.ts와 해당 test를 단독 정비한다. 새 conversation-agent11개, shared-mock2개, actual rework14개를 default server에서 제외하고 담당의 전용 config로 순차 실행한다. shared/integrated의 명시 opt-in을 설정해 skip guard 때문에 실제 검사가 빠지지 않게 하며, 실제14 선택 시 기존 office-runtime Docker image를 먼저 빌드한다. 현재 full의 native build는 browser 뒤이므로 실제 기술 선행 조건을 명시한 것이다. build/브라우저 실패는 기존대로 모아 전체 실패로 남기고 다른 group 검사를 숨기지 않는다. 선택·routing·guard·Docker 순서와 실패 보존25 tests565 assertions가 통과했고, 최종 main manual full의 실제27개 실행은 별도로 확인한다.

PR675 exact85093766b851e40b35d40b7e2e4d08fbe902fb39의 Quality41324914769/Legal41324914750/nativePDF41324914761 성공 후 main26427659ac8a386334a545e0bf32b4cd3ba1073c에 병합했다. 실제 fixture의 Syntax400은 반복 검사에서0으로 해소됐지만 재조율 context read의 별도503은 남았다.04가 임시 enum 진단으로 readWorkspaceContext의 readIntake→summary unavailable 경합까지 좁혔으며 원복 완료했다.00은 실제 source proof가 바뀐 경우만 stale로 분류하고 unchanged source의 실제 오류는 보존하는 후속을 진행한다. DB corruption 거절을 완화하거나 unknown503을 반복해 성공으로 만들지 않는다.

PR673 exact887187a9b22c58e4b589d3dec7dd5dde01cf3949의 Quality41325273600/nativePDF41325273571 성공 후 main32abc5f79bf04fede1dfdce19c13f967e90c92a3에 병합했다. private scoped read 포트만 추가됐으며00의 실제 current-scope 전후 확인/runtime binding은 아직 남아 있다.

00의 `codex/621-rework-report-edit-binding`은 explicit mock에서 본문 편집 후 새 report ID가 기존 정확한 parent analysis identity를 잃어 PDF를 불필요하게 stale로 막던 문제를 수정한다. 동일 case source revision·제외 목록·mask scope의 parent만 identity를 이어받고, userEdited=true/review_required를 별도 보존해 검증된 새 분석으로 승격하지 않는다. source/context/evidence 변경은 기존 전체 source hash 검사에서 stale이며, scope 변경은 binding을 이어받지 않는다. 최초 canonical 준비는 사용자 편집 표시를 붙이지 않는다. 원래 analysis.checkedAt와 이전 immutable 본문은 그대로 보존하고 사건 삭제 시 두 private map도 지운다.

관련 mock/overflow/shared reports27 tests177 assertions, bun ci/validate:quick·production build/dry-run/local workerd 부팅 통과. 처음 추가 테스트의 넓은 fixture callback 타입을 실제 intersection으로 좁혀 타입 오류를 수정했다. 이 검증은 실제 provider/PDF native 인수와 구분하며05의 shared browser 전체는 이 후속의 CI/main 뒤 다시 검증한다.
