# BARO 문서 지도

[PRD v2](./PRD.md)는 사용자가 승인한 전체 서비스 방향이다. 현재 v1 구현과 v2 목표,
실제 capability·정책 승인·public 출시를 구분한다. Implementation-ready/Accepted는
기술 목표이며 구현·외부 검증·법률 승인 완료를 뜻하지 않는다.

실제 진행 상태의 정본은 GitHub 이슈/PR·CI·배포이고, 이슈 선택은
[실행 기준](./development/EXECUTION.md)과 [작업 그래프](./development/work-items.json)를 따른다.
기존 [P0.2](./development/P0.2-VALIDATION.md)/[P0.3](./development/P0.3-VALIDATION.md) 검증은
그 당시 v1 범위의 증거이며 v2 완료로 재해석하지 않는다.

## 읽는 순서

2026-10-06 최신 MVP 실행은 [동일 client/API mock 계약](./development/CLIENT-API-CONTRACT.md),
[5세션 실행·시작 프롬프트](./development/PARALLEL-UI-SPRINT.md), [ADR-0014](./adr/0014-mvp-two-roles-and-api-mock-first.md)를 먼저 읽는다.
고객/변호사 두 역할이며 승인 어드민은 제외한다. 기존 backend/증거와 외부 공개 gate는 보존한다.

1. [PRD](./PRD.md): 핵심가치·대상·제품경계·한도·완료기준
2. [MVP](./product/MVP-SPEC.md), [UX](./product/UX-SPEC.md), [로드맵](./product/ROADMAP.md)
3. [실제 UI 시연 행렬](./product/UI-DEMONSTRATION.md): 기능/실패/역할별필수증거
4. [ADR](./adr/README.md): 0001~0005 유지경계, 0006~0013 v2 목표, 0014 MVP 부분 대체
5. [시스템](./architecture/SYSTEM.md), [데이터](./architecture/DATA-MODEL.md), [API](./architecture/HTTP-API.md)
6. [실행계약](./architecture/DOMAIN-LIFECYCLE.md), [AI](./architecture/AI-PIPELINE.md), [공식자료](./architecture/LEGAL-RETRIEVAL.md)
7. [보안](./security/SECURITY-PRIVACY.md), [인증수명](./security/AUTH-LIFECYCLE.md), [테스트](./quality/TEST-STRATEGY.md)
8. [배포](./operations/DEPLOYMENT-OPERATIONS.md), [환경](./operations/ENVIRONMENT-READINESS.md), [관측](./operations/OBSERVABILITY.md)
9. [삭제/복구](./operations/DELETION-RESTORE.md), [데이터키](./operations/CASE-DATA-KEYS.md), [운영 drill](./operations/BETA-DRILLS.md)
10. [이벤트](./analytics/EVENTS.md), [정책초안](./policies/), [공개문구감사](./product/PUBLIC-CONTENT-AUDIT.md)

v2 구현을 시작할 때는 [실행 계획](./development/V2-EXECUTION.md)과
[현재 검증 상태](./development/V2-VALIDATION.md), [상세 계약](./architecture/V2-CONTRACTS.md),
[v2 HTTP API](./architecture/V2-HTTP-API.md), [UI 증거 계약](./quality/V2-UI-EVIDENCE.md)을 함께 읽는다.
자료·미디어는 [파일 처리 운영](./operations/FILE-PROCESSING.md),
사용량과 월 예산은 [비용 제어](./operations/COST-CONTROLS.md)를 따른다.

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
