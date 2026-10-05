# BARO v2 전체 개발 실행 계획

- Reviewed: 2026-10-06
- GitHub milestone: [BARO v2 — Full service delivery](https://github.com/creno-va/baro/milestone/5)
- 정본: 개정 PRD, Accepted ADR, [작업 그래프](./work-items.json), 실제 GitHub 이슈/PR

## 선행 작업과 현재 상태

P0.1/P0.2는 기존 완료 증거를 유지한다. P0.3 milestone 4의 #19/#20/#27은 OPEN이며
preview foundation 배포와 대역 회귀를 실제 OAuth·모델·법령·운영·공개 승인으로 취급하지 않는다.
이전 세션의 clean `345c085`와 실행 종료를 확인하고 변경을 인계받았다.
[PR #52](https://github.com/creno-va/baro/pull/52)는 안전한 법령 진단, 격리 AI 도구,
독립 경보/journal 계약과 현재 증거를 main `b41c00ce8d9955c5922b1e65d95d0c59cdc7b90b`에 통합했다.
[PR CI](https://github.com/creno-va/baro/actions/runs/37361905703)는 성공했다.
이 CI는 실제 외부 성공이나 새 main 배포의 증거가 아니다.

사용자 Goal은 가능한 P0.3 기술 작업을 우선 마무리하고 외부·사람 조건만 남으면 그 조건과
독립인 후속 문서·개발·preview 검증을 허용한다. #19 제품 운영 통합은 기존 #27 선행 조건을
유지한다. 새 제품 코드는 #53의 PR 병합과 완료 후 시작한다. v1을 재작성하거나 데이터를 삭제해
v2에 맞추지 않는다. additive 계약과 migration을 단일 DB 소유자가 순서대로 통합한다.

## 실행 순서와 소유권

각 행은 하나의 실제 GitHub 이슈이며 완료 전에 선행 PR 병합을 확인한다. 외부 증거는
별도 gate에 남기되 adapter 검증을 live 성공으로 표현하지 않는다. 독립 계약/fixture는 이슈의
명시적 범위에서만 선행 완료 전에 준비할 수 있다.

| 이슈 | 범위 | 선행 | 핵심 완료 증거 |
| --- | --- | --- | --- |
| #53 | PRD·ADR·전체 문서·실행 계약 | 독립 명세 | 전체 합의 반영, 승인/현재 구현 구분, 링크·DAG 검증 |
| #54 | v2 strict shared 계약·합성 fixture | #53 | 불가능한 상태·unknown field 거부, v1 계약 보존 |
| #55 | additive DB·repository·migration | #54 | 실제 SQL 소유권/CAS, fresh/upgrade/drift |
| #56 | 디자인 시스템·공통 shell | #53 | shadcn/blue/Lucide/Pretendard/단일 SVG, 실제 화면·CSP |
| #57 | quota·월 예산·비용 ledger | #55 | 동시 예약/KST/중복/실패/실제 비용 정산 |
| #58 | private/public R2·자료 admission | #55/#57 | 크기/수량/소유권/동의/streaming/cleanup |
| #59 | Containers·Whisper·멀티모달 처리 | #58/#57 | 실제 처리 상태·coverage·취소/재시도/삭제, live는 #71 |
| #60 | 역할·변호사 자격·프로필 API | #55/#58 | 수동 자격 확인·모든 공개 revision 승인·권한 |
| #61 | 디렉터리·객관적 필터·직접 연락 | #56/#60/#59 | 승인본만 탐색·실제 부족 상태·외부 연락/길찾기 |
| #62 | 변호사·운영자 portal | #56/#60/#59 | 반려/재신청/승인/공개·사건 원문 접근 금지 |
| #63 | 공식 법령·판례·기관 안내 | #54/#55 | source별 schema/date/hash/claim 검증, live는 #71 |
| #64 | 적응형 intake·확인·chat·행동 | #55/#59/#63/#57 | revision/재접속/근거·사실 경계·비용·지속 관리 |
| #65 | dashboard·workspace·자료 UI | #56/#58/#59/#64 | 초기 입력부터 지속 사용까지 실제 브라우저 시연 |
| #66 | PDF·선택 원본 ZIP | #59/#64/#65 | 다운로드한 한글 PDF 렌더/내용과 ZIP 원본 확인 |
| #67 | 확장 삭제·복구 후 재삭제 | #60/#58/#64/#66 | 늦은 처리 부활 방지·opaque journal·실제 drill #71 |
| #68 | 공개 콘텐츠·정책 초안·동의 | #53/#60/#59/#63/#66 | 실제 처리 경로와 Draft/게시/동의 버전 정합 |
| #69 | 전 기능 E2E·보안·UI 증거 | #61/#62/#65/#66/#67/#68 | 전 역할·실패·모바일·키보드·200%·CSP 시연 |
| #70 | 법률·사업자·정책 게시 승인 | #68 | 책임 있는 사람의 검토/사실/승인 증거 |
| #71 | live·drill·배포·공개 완료 | #59/#63/#67/#69/#70/#19/#20/#27 | 같은 SHA의 실제 연동·전 역할 UI·preview/production·공개 승인 |

#55가 공유 schema와 migration 번호를 소유한다. 다른 이슈는 schema 변경 요청을 먼저 통합한다.
여러 작업자는 별도 checkout/worktree를 사용하고 같은 파일의 동시 수정을 피한다.
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
milestone 5와 Goal은 기능·실제 시연·외부 연동·운영·배포·공개 조건이 모두 충족될 때만 완료한다.

막힌 조건은 이슈와 readiness 문서에 담당자·필드·필요 행동·마지막 결과로 기록한다.
독립 ready 작업을 계속하며 외부 blocker를 해소한 것으로 간주해 DAG를 우회하지 않는다.
