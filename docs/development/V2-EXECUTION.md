# BARO v2 전체 개발 실행 계획
> **2026-10-06 사용자 개정 — 아래 이전 범위보다 우선한다.** MVP는 고객/변호사 두 역할이며 통합 로그인에서 선택한다. 변호사 승인 어드민·자격 심사·반려·승인대기 UX는 제외한다. 실제 제품 client UI 동일 구현체를 API mock adapter로 먼저 완성하고 기능 연결을 병렬 진행한다. 별도 /mock UI는 만들지 않는다. [5세션 계획](./PARALLEL-UI-SPRINT.md)의 실제 착수부터 2시간 sprint를 적용하며 독립 UI는 DB/AI/OAuth/backend CI/A 이슈 종료를 기다리지 않는다. 완료된 코드/이슈/증거를 보존하고 새 DB/비용 선행 이슈를 추가하지 않는다. AI 품질 확대는 모든 UX 연결 뒤다. P0.3/#70/#71 외부·정책·production·공개 gate는 보존하며 mock 성공을 실제 외부 성공으로 표시하지 않는다. [ADR-0014](../adr/0014-mvp-two-roles-and-api-mock-first.md)가 대체 범위를 기록한다.

- Reviewed: 2026-10-06
- GitHub milestone: [BARO MVP — Customer/lawyer functional UX](https://github.com/creno-va/baro/milestone/5)
- 정본: 개정 PRD, Accepted ADR, [작업 그래프](./work-items.json), 실제 GitHub 이슈/PR

## 선행 작업과 현재 상태

P0.1/P0.2는 기존 완료 증거를 유지한다. P0.3 milestone 4의 #19/#20/#27은 OPEN이며
preview foundation 배포와 대역 회귀를 실제 OAuth·모델·법령·운영·공개 승인으로 취급하지 않는다.
이전 세션의 clean `345c085`와 실행 종료를 확인하고 변경을 인계받았다.
[PR #52](https://github.com/creno-va/baro/pull/52)는 안전한 법령 진단, 격리 AI 도구,
독립 경보/journal 계약과 현재 증거를 main `b41c00ce8d9955c5922b1e65d95d0c59cdc7b90b`에 통합했다.
[PR CI](https://github.com/creno-va/baro/actions/runs/37361905703)는 성공했다.
이 CI는 실제 외부 성공이나 새 main 배포의 증거가 아니다.

같은 main `b41c00ce8d9955c5922b1e65d95d0c59cdc7b90b`의
[preview 배포](https://github.com/creno-va/baro/actions/runs/37363116441)는 재실행 후 성공했다.
이는 foundation 배포·SHA smoke 증거이며 P0.3 전체 외부 연동 성공은 아니다.
#53 PR의 폴링 경계 검사는 테스트 clock의 자연 진행을 중단해 실제 지연 경계를
수동 검증하도록 수정했고, 해당 시나리오 5회 반복을 통과했다. 전체 CI 결과는 별도 확인한다.

#53 [PR72](https://github.com/creno-va/baro/pull/72)는
[exact-head CI](https://github.com/creno-va/baro/actions/runs/37365995710)를 통과해
main `b75429de3af2d04cf001041a3aafada631c2489a`에 병합되고 이슈도 CLOSED가 됐다.
#54 strict 계약과 #56 공통 UI 시스템을 별도 checkout에서 시작했다. 이 명세 완료는
P0.3 외부 gate나 v2 실제 전체 시연 완료를 뜻하지 않는다.

사용자 Goal은 가능한 P0.3 기술 작업을 우선 마무리하고 외부·사람 조건만 남으면 그 조건과
독립인 후속 문서·개발·preview 검증을 허용한다. #19 제품 운영 통합은 기존 #27 선행 조건을
유지한다. 새 제품 코드는 #53의 PR 병합과 완료 후 시작한다. v1을 재작성하거나 데이터를 삭제해
v2에 맞추지 않는다. additive 계약과 migration을 단일 DB 소유자가 순서대로 통합한다.

## 실행 순서와 소유권

2026-10-06 최신 지시: 고객/변호사 UX를 우선하고 승인 어드민을 MVP에서 제외한다.
#101~#106은 [동결 client 계약](./CLIENT-API-CONTRACT.md)과 [5세션 계획](./PARALLEL-UI-SPRINT.md)의
독립 API mock UI 범위이며 실제 5세션 착수부터 2시간 목표다. 기능 연결은 동일 client에서 병렬 진행한다.
#59/#60 구현은 PR89 (head `51e912fa93e9db2bcbc6b80ec2bca386fa47f1ed`)의
성공한 CI 후 main `e6bc711c9f55ee53f1b5d5efa489117ee4e8f60a`에 병합됐다.
해당 이슈의 실제 Container·모델·R2·비용 검증은 #71과 함께 OPEN으로 남기되
검토된 구현 병합이 후속 API/UI 개발을 시작할 수 있게 한다. #95 비용 계약의 미완료는
실제 유료 저장 I/O를 제한하며 독립 제품 화면·workspace 코드의 개발을 막지 않는다.

각 행은 하나의 실제 GitHub 이슈이며 완료 전에 선행 PR 병합을 확인한다. 외부 증거는
별도 gate에 남기되 adapter 검증을 live 성공으로 표현하지 않는다. 독립 계약/fixture는 이슈의
명시적 범위에서만 선행 완료 전에 준비할 수 있다.

2026-10-06 사용자는 빠른 기능 연결·검증·배포를 위해 선행 기준을 CI 성공·main 구현 병합으로
변경했다. #57은 PR88로 구현을 병합했지만 실제 비용·청구 검증 때문에 OPEN을 유지한다.
후속 #58은 이 병합을 사용해 시작하며 외부·법률·공개 gate나 전체 완료 기준은 바꾸지 않는다.
기존 Goal은 삭제됐고 재생성하지 않는다. 검토된 구현 PR은 작업 그래프의 `implementationPr`로
조회하며 이슈 종료, fixture 준비 또는 합성 시험을 실제 외부 성공으로 대체하지 않는다.

| 이슈 | 범위 | 선행 | 핵심 완료 증거 |
| --- | --- | --- | --- |
| #53 | PRD·ADR·전체 문서·실행 계약 | 독립 명세 | 전체 합의 반영, 승인/현재 구현 구분, 링크·DAG 검증 |
| #54 | v2 strict shared 계약·합성 fixture | #53 | 불가능한 상태·unknown field 거부, v1 계약 보존 |
| #55 | additive DB·repository·migration | #54 | 실제 SQL 소유권/CAS, fresh/upgrade/drift |
| #87 | 후속 실행 DB 계약 확장 | #55 | fresh source cache·유료 admission/lease 비용 hold·가격/funding/usage 근거·allocation/carryover, 새 primitive 사용 전 공유 PR 병합 |
| #93 | AI job 없는 원본/승인 공개 R2 비용 연결 | #55/#57/#87 | 실제 저장 intent·승인과 비용 예약/dispatch의 원자성, 가짜 job 없음, additive schema 및 늦은 receipt, 공유 PR main 병합 후 consumer 연결 |
| #56 | 디자인 시스템·공통 shell | #53 | shadcn/blue/Lucide/Pretendard/단일 SVG, 실제 화면·CSP |
| #57 | quota·월 예산·비용 ledger | #55 | 동시 예약/KST/중복/실패/실제 비용 정산 |
| #58 | private/public R2·자료 admission | #55/#57 | 크기/수량/소유권/동의/streaming/cleanup |
| #59 | Containers·Whisper·멀티모달 처리 | #58/#57 | 실제 처리 상태·coverage·취소/재시도/삭제, live는 #71 |
| #60 | 기존 역할·변호사 자격·프로필 API 보존 | #55/#58 | PR89 병합 구현 보존, MVP self-service 연결 #102/#62 |
| #61 | 디렉터리·객관적 필터·직접 연락 | #56/#60/#59 | 승인본만 탐색·실제 부족 상태·외부 연락/길찾기 |
| #62 | 변호사 자기 프로필 실제 기능 | #56/#60/#102/#106 | 자기 저장/미리보기/재접속·소유권; admin 제외 |
| #63 | 공식 법령·판례·기관 안내 | #54/#55 | source별 schema/date/hash/claim 검증, live는 #71 |
| #64 | 적응형 intake·확인·chat·행동 | #55/#59/#63/#57 | revision/재접속/근거·사실 경계·비용·지속 관리 |
| #65 | 고객 사건 실제 기능 연결 | #56/#58/#59/#64/#103/#104 | UI는 B/C, 같은 client 저장/재개/자료·실제 흐름 |
| #66 | 실제 PDF·선택 원본 ZIP API 연결 | #59/#64/#65/#105 | UI는 D, 다운로드한 한글 PDF 렌더/내용과 ZIP 원본 확인 |
| #67 | 확장 삭제·복구 후 재삭제 | #60/#58/#64/#66 | 늦은 처리 부활 방지·opaque journal·실제 drill #71 |
| #68 | 공개 콘텐츠·정책 초안·동의 | #53/#60/#59/#63/#66 | 실제 처리 경로와 Draft/게시/동의 버전 정합 |
| #69 | 고객/변호사 기능 E2E·보안·UI 증거 | #61/#62/#65/#66/#67/#68 | 두 역할·저장/권한/실패·모바일·키보드·CSP; AI 품질 확대 후순위 |
| #70 | 법률·사업자·정책 게시 승인 | #68 | 책임 있는 사람의 검토/사실/승인 증거 |
| #71 | live·drill·배포·공개 gate | #59/#63/#67/#69/#70/#19/#20/#27 | 같은 SHA의 실제 연동·두 역할 UI·preview/production·공개 승인 |
| #101 | 전체 API mock UX 추적 | #102~#106 | 실제 client 동일 UI, 5세션 착수부터 2시간 |
| #102 | A facade·mock/real adapter·역할 로그인·shell | 독립 | 첫 20분 최소 계약/adapter/shell PR, 통합·preview |
| #103 | B dashboard·intake·요약 | 독립 | 동결 계약으로 scaffold, mock 뒤 #65 기능 연결 |
| #104 | C workspace·chat·자료·timeline·actions | 독립 | D report route 링크, mock 뒤 #65 기능 연결 |
| #105 | D report·설정·사용량·삭제·help/policy | 독립 | mock UX 뒤 #66/#67/#68 실제 기능 |
| #106 | E 자기 lawyer portal·기존 directory | 독립 | 승인대기/admin 없음, mock 뒤 #62 기능 |

#55가 공유 schema와 migration 번호를 소유한다. 다른 이슈는 schema 변경 요청을 먼저 통합한다.
여러 작업자는 별도 checkout/worktree를 사용하고 같은 파일의 동시 수정을 피한다.
#55는 [PR86](https://github.com/creno-va/baro/pull/86)의 exact-head CI를 통과하고 main
`606987e040070932f263fbd0b6c6b2b4cf45266a`에 병합되어 CLOSED다. #57/#63의 기존
repository 기반 독립 경로를 시작한다. 후속 유료 실행·가격 근거와 최초 발견 source cache에
필요한 새 저장 primitive는 #87에서 단일 DB 소유자가 구현하며 해당 경로는 공유 PR 병합 후 연결한다.
이는 기존 #55 인수 조건을 취소하거나 전체 서비스 완료 기준을 낮추는 변경이 아니다.
#53은 제품/ADR, architecture/security/quality, operations/policy, execution/DAG로 문서 소유를
나누며 최종 통합자가 링크와 요구사항의 정합성을 직접 검토한다.

## 자율 실행과 승인 경계

허용된 작업은 이슈·마일스톤·브랜치·worktree·검증된 PR 병합, preview/production 코드 배포,
승인 요건 충족 후 최초 공개, 합의된 리소스와 월 기술 예산 100만 원 내 실제 처리 비용이다.
preview의 사건·파일·변호사·역할은 합성 테스트 전용으로 표시한다. production에 fixture나
인증 우회를 넣지 않는다. 외부 상담 메시지는 별도 지시 없이 발송하지 않는다.

새 결제수단·자동 충전·예산 확대·새 모델/공급자 결정·사업자 사실·법률/정책 승인은 별도 경계다.
합의한 Whisper·Containers 경로는 ADR에 명시하고 실제 계정 지원을 검증한다. 공개 수수료가
없다는 사실을 적법성 승인으로 대체하지 않는다. Environment 보호 규칙과 공개 게이트를 유지한다.
비밀번호/OTP가 필요한 콘솔은 사용자 로그인 상태를 확인하고 구체적인 조작을 인계한다.
production OAuth를 preview/local로 복제하지 않는다.

## 검증과 전체 완료

이슈별 mandatory check와 계약/실패/migration 검증을 수행한다. 실제 UI에서 확인하는 과정과
저장·재로그인·권한·다운로드·삭제 검증을 생략하지 않는다. 모델 기억이나 mock 출력으로 전체
사건군/공식 자료/미디어 성공을 주장하지 않는다.

[V2 검증 기록](./V2-VALIDATION.md)은 요구사항별 evidence ledger다. 성공에는 candidate SHA,
수행 환경, 실제 결과, 신뢰 가능한 run/receipt 또는 안전한 화면 증거가 필요하다. 기존 P0.3의
foundation·50개 개인 대여 합성 평가를 v2 전체 범위 완료 증거로 재사용하지 않는다.
milestone 6의 API mock UX와 milestone 5의 기능 연결, #70/#71 외부·공개 gate를 구분한다.
기존 Goal은 재생성하지 않는다. mock 증거는 실제 저장/외부/공개 증거를 대신하지 않는다.

막힌 조건은 이슈와 readiness 문서에 담당자·필드·필요 행동·마지막 결과로 기록한다.
독립 ready 작업을 계속하며 외부 blocker를 해소한 것으로 간주해 DAG를 우회하지 않는다.
