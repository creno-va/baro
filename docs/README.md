# BARO 문서 지도

이 디렉터리는 구현 전 제품 결정과 구현 계약의 기준이다. 중복된 내용을 여러 문서에
복사하지 않고 아래 책임에 따라 연결한다.

실제 구현 상태와 이슈 선택은 [에이전트 실행 기준](./development/EXECUTION.md), 목표 계약의
리뷰 결과는 [전체 프로젝트 리뷰](./quality/PROJECT-REVIEW.md)에서 확인한다. 아래
`Implementation-ready` 문서는 구현 완료를 뜻하지 않는다.

## 읽는 순서

1. [PRD](./PRD.md) — 제품 목적, 범위, 성공 기준
2. [MVP 명세](./product/MVP-SPEC.md) — 기능과 인수 조건
3. [UX 명세](./product/UX-SPEC.md) — 경로, 화면, 상태, 문구
4. [ADR](./adr/README.md) — 되돌리기 어려운 결정과 근거
5. [시스템 설계](./architecture/SYSTEM.md) — 런타임과 모듈 구조
6. [데이터 모델](./architecture/DATA-MODEL.md) 및 [HTTP API](./architecture/HTTP-API.md)
   — 원자성·revision·질문·삭제는 [사건 실행 계약](./architecture/DOMAIN-LIFECYCLE.md)
7. [AI 파이프라인](./architecture/AI-PIPELINE.md) 및 [법률정보 검색](./architecture/LEGAL-RETRIEVAL.md)
8. [보안·개인정보](./security/SECURITY-PRIVACY.md), [테스트](./quality/TEST-STRATEGY.md)
9. [배포·운영](./operations/DEPLOYMENT-OPERATIONS.md), [관측](./operations/OBSERVABILITY.md)
10. [이벤트](./analytics/EVENTS.md) 및 [공개 정책 초안](./policies/)

## 문서 책임

| 문서 | 답하는 질문 | 변경 권한 |
| --- | --- | --- |
| PRD | 왜 만들며 MVP에 무엇이 포함되는가 | Product |
| Product spec | 사용자가 무엇을 할 수 있고 완료 조건은 무엇인가 | Product + Design |
| ADR | 어떤 선택을 왜 채택했는가 | Engineering + 관련 owner |
| Architecture | 구현 계약과 데이터 흐름은 무엇인가 | Engineering |
| Security/Quality/Ops | 어떻게 안전하게 검증·출시·운영하는가 | Engineering + Security |
| Policy draft | 사용자에게 무엇을 고지하는가 | Legal review 필수 |

## 우선순위와 충돌

- 제품 범위는 PRD, 구체적 동작은 MVP/UX 명세가 우선한다.
- 채택된 기술 결정은 Accepted ADR이 우선한다.
- 런타임 구현 계약은 아키텍처 문서가 기준이며 코드가 생긴 뒤에는 테스트와 타입이
  실행 가능한 최종 계약이 된다.
- HTTP 스키마는 초기에는 이 문서가 기준이고, 구현 후 Zod 스키마와 Hono RPC 타입을
  정본으로 삼는다.
- 실행의 공통 한도·상태·멱등성·revision은 DOMAIN-LIFECYCLE, 네트워크 shape는 HTTP-API,
  저장 표현은 DATA-MODEL이 소유한다. 충돌이 있으면 셋과 계약 테스트를 함께 고치고
  기존 코드와 다르다는 이유만으로 명세를 조용히 무시하지 않는다.
- 법률 또는 개인정보 관련 초안은 법률 검토 결과가 우선한다.

## 변경 규칙

- 범위·지표 변경: PRD 버전과 변경일을 갱신한다.
- 되돌리기 어려운 기술 결정 변경: 기존 ADR을 수정하지 말고 새 ADR로 대체한다.
- 사용자 지시로 0003/0004에 적용한 2026-10-05 amendment는 기록된 예외다. 이후에는
  새 ADR로 변경 범위만 대체하고 유효한 나머지 결정을 유지한다.
- API·DB 변경: 관련 문서, 마이그레이션, 계약 테스트를 같은 변경에 포함한다.
- 공개 문구 변경: UX 명세와 정책 초안의 일치 여부를 확인한다.
- 모든 문서는 상대 링크가 유효하고 `[PUBLICATION_BLOCKER: ...]`가 공개 배포 전에
  0개여야 한다.
