# BARO 문서 지도

2026-11-08 후속 제품 결정은 [ADR-0019](./adr/0019-case-preparation-without-lawyer-platform.md),
[확정 범위·민사/형사 기획 제안](./product/CASE-PREPARATION-SCOPE.md), [전환 설계](./architecture/CASE-PREPARATION-TRANSITION.md)를 먼저 읽는다.
초기 변호사 연결·전용 사용자 단을 제외하며 기존 계정은 일반 사건 이용을 유지한다.
현재는 문서/기획만 변경하고 코드·원격 데이터·공개 기능·정책 버전·배포는 변경하지 않는다.
[민사·형사 준비/대응 상세 흐름 v0.1](./product/CASE-PREPARATION-JOURNEYS.md)은 초기 입력부터
질문·리포트·문서 초안과 실패 복구까지의 검토안이다. [Proposed ADR-0020](./adr/0020-procedure-aware-intake-and-working-reports.md)은
문서 우선 생성/확인·작업 중 보관·저장 snapshot의 구현 전 경계를 설명한다.
[사건 상세 화면 구조 v0.1](./design/CASE-WORKSPACE-LAYOUT.md)은 대화/리포트/문서 초안과
자료 보조 패널의 데스크톱/모바일 배치·주요 액션·원문/편집 왕복·직접 URL/보관을 구체화한다.

2026-11-08 로그인 이후 앱 개편의 단일 설계·소유권·인수 기록은
[앱 작업공간·고객용 리포트](./development/APP-WORKSPACE-REWORK.md)와 #751을 따른다.

[PRD](./PRD.md)는 공통 사건 사용자 중심의 새 목표다. 통합된 기존 두 역할 v2 구현, 보존된 v1 계약과
실제 외부 인수를 구분한다. 현재 공개 서비스를 유지하며 [ADR-0015](./adr/0015-maintenance-and-operating-policy.md)의
비용·릴리스·검색·문서 정비를 우선한다. 정책 초안 인수와 법률 승인은 별개다.

실제 진행 상태의 정본은 GitHub 이슈/PR·CI·배포이고, 이슈 선택은
[실행 기준](./development/EXECUTION.md)과 [작업 그래프](./development/work-items.json)를 따른다.
기존 [P0.2](./development/P0.2-VALIDATION.md)/[P0.3](./development/P0.3-VALIDATION.md) 검증은
그 당시 v1 범위의 증거이며 v2 완료로 재해석하지 않는다.

## 읽는 순서

현재는 [실행 기준](./development/EXECUTION.md), [인수표](./development/MVP-REQUIREMENTS-EVIDENCE.md),
ADR-0015를 먼저 읽는다. 동일 client/API mock과 5세션 sprint는 M6 완료 이력이며 실제
기능 인수와 구분한다. 두 역할의 이전 구현/인수는 이력이며 변호사 전용 기능은 새 목표에서 제외한다.

1. [PRD](./PRD.md): 핵심가치·대상·제품경계·한도·완료기준
2. [MVP](./product/MVP-SPEC.md), [UX](./product/UX-SPEC.md), [로드맵](./product/ROADMAP.md)
3. [실제 UI 시연 행렬](./product/UI-DEMONSTRATION.md): 기능/실패/역할별필수증거
4. [ADR](./adr/README.md): 기존 유지경계와 v2, 0019 초기 연결/전용 역할 제외, 0015 운영 정비·부분 대체
5. [시스템](./architecture/SYSTEM.md), [데이터](./architecture/DATA-MODEL.md), [API](./architecture/HTTP-API.md)
6. [실행계약](./architecture/DOMAIN-LIFECYCLE.md), [AI](./architecture/AI-PIPELINE.md), [공식자료](./architecture/LEGAL-RETRIEVAL.md)
7. [보안](./security/SECURITY-PRIVACY.md), [인증수명](./security/AUTH-LIFECYCLE.md), [테스트](./quality/TEST-STRATEGY.md), [AI 사전 검사 감사](./quality/AI-PREFLIGHT-AUDIT.md)
8. [배포](./operations/DEPLOYMENT-OPERATIONS.md), [환경](./operations/ENVIRONMENT-READINESS.md), [관측](./operations/OBSERVABILITY.md)
9. [삭제/복구](./operations/DELETION-RESTORE.md), [데이터키](./operations/CASE-DATA-KEYS.md), [운영 drill](./operations/BETA-DRILLS.md)
10. [이벤트](./analytics/EVENTS.md), [정책초안](./policies/), [공개문구감사](./product/PUBLIC-CONTENT-AUDIT.md)

v2 구현을 시작할 때는 [실행 계획](./development/V2-EXECUTION.md)과
[현재 검증 상태](./development/V2-VALIDATION.md), [상세 계약](./architecture/V2-CONTRACTS.md),
[v2 HTTP API](./architecture/V2-HTTP-API.md), [UI 증거 계약](./quality/V2-UI-EVIDENCE.md)을 함께 읽는다.
자료·미디어는 [파일 처리 운영](./operations/FILE-PROCESSING.md),
사용량과 비용 관측·정산은 [비용 운영](./operations/COST-CONTROLS.md)을 따른다.
현행은 [프리베타 비용 관측 전용](./operations/PREBETA-COST-POLICY.md)이다. 금액·가격/FX/funding
누락/만료·월할당·refresh·유지비·비용 IO로 기능/배포를 막지 않으며 사용자 재지시 전 재도입하지
않는다. 정책과 실제 구현/배포 잔여를 구분하고 [ADR-0015](./adr/0015-maintenance-and-operating-policy.md)를 우선한다.

2026-10-22 직접 요청한 모바일 개발은 [ADR-0017](./adr/0017-expo-mobile-and-shared-client-boundaries.md),
[공통 코드 구조](./architecture/MOBILE-CLIENT.md), [단계별 실행 계획](./development/MOBILE-EXECUTION.md)을 따른다.
웹 UI 개편은 기존 담당이 유지한다. [실제 실행·내부 전달 증거](./quality/MOBILE-NATIVE-RUNTIME-2026-10-23.md)의
source/OS·실행 범위와 미검증 항목을 구분하며 현재 모바일 문서를 전체 앱·실기기 인수로 확대하지 않는다.

제품 화면의 정보 위계·반응형 기준과 모바일에 인계할 토큰은 [제품 UI 개편](./design/PRODUCT-UI.md)을 따른다.

## 책임과 우선순위

| 정본 | 답하는 질문 |
| --- | --- |
| PRD/MVP/UX | 무엇을 누구에게 제공하며 어떤 UX·시연으로 완료하는가 |
| Accepted ADR | 기술결정을 왜 채택했으며 이전결정의 어느범위를 대체하는가 |
| Architecture/shared strict contracts | API shape·schema·owner/revision·crypto·state·quota·삭제가 어떻게 실행되는가 |
| Security/Quality/Ops | 실제환경에서 어떻게 검증·배포·보존·삭제·복구하고 증거를 남기는가 |
| Draft policies + human approval | 어떤사실/처리/게시범위가 검토됐으며 무엇이 아직 미승인인가 |
| GitHub/execution graph | 어떤 작업이 ready·진행·완료이며 선행과 소유자가 누구인가 |

기존코드가 좁은 v1 계약이라는 이유로 새제품범위를 조용히 축소하지 않는다. v1 데이터/
계약/읽기/삭제를 보존하면서 v2 목표를 별도버전·additive 구현으로 달성한다.
API·DB·Workflow·UI가 각자타입을 재정의하지 않으며 shared 계약선행을 병합한다.
법률/정책 검토근거는 사람이확정한 범위를 따르고 기술테스트로 만들어내지 않는다.

## 변경 규칙

범위변경은 PRD 버전/날짜·MVP/UX·시연행렬을 함께 갱신한다. Accepted 결정변경은 새 ADR 과
부분/전체대체 metadata로 기록한다. API/DB는 관련계약·migration·회귀 test를 함께 검증한다.
공개문구는 실제제품·승인정책·외부랜딩과 일치시키고 draft를 공개본으로 사용하지 않는다.
출시 전 `[PUBLICATION_BLOCKER: ...]` 해소와 실제승인 evidence가 필요하다.
문서링크·개행·ADRmetadata·작업그래프검사를 통과해도 실제시연완료를 주장하지 않는다.
