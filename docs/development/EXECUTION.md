# 에이전트 실행 기준

- Reviewed: 2026-10-06
- 목적: 사용자의 매 작업 지시 없이 이슈 선택부터 검증된 PR까지 진행할 수 있게 한다.

## V2 전체 서비스 실행

새 제품 범위와 이슈 #53~#71은 [V2 실행 계획](./V2-EXECUTION.md)을 따른다.
마일스톤 5는 실제 전 역할 UI·외부 연동·배포·승인된 공개까지 요구한다.
이하 기존 구현과 P0.3 exit는 역사와 현재 외부 gate로 유지한다. #53 명세 PR 병합 전
v2 제품 코드를 시작하지 않는다. P0.3의 사람/외부 blocker를 허위 종료하지 않고 사용자 Goal이
허용한 독립 후속 작업을 진행한다. 증거는 [V2 검증 기록](./V2-VALIDATION.md)에 누적한다.

## 현재 구현과 목표 구분

main은 P0.1의 shared 계약·암호화·OAuth/동의·도메인 repository·offline harness에 더해
P0.2의 admission/read/delete/answers/retry API, 공식 법령 검색, pinned AI Gateway,
암호화 checkpoint Workflow, 목록/입력/상세/결과 UI와 선택 비민감 지표/피드백을 포함한다.
schema는 additive `0005_deletion_cleanup`이며 기존 migration/인증/사건 데이터를 보존한다.
합성 adapter는 테스트에만 사용하며 제품의 모델/인증 fallback이 아니다. 선택 지표는
동의 후 해당 탭의 세션 저장소에만 기록하고 외부 공급자를 도입하지 않는다.
검증 경계와 인수 조건별 증거는 [P0.2 검증 기록](./P0.2-VALIDATION.md)을 따른다.
P0.3의 인수 조건별 구현/외부 미검증 증거는 [P0.3 검증 기록](./P0.3-VALIDATION.md)을 따른다.
P0.3 #18은 50개 제품 runner/상세 UI와 자동 접근성, dependency/secret/source/bundle
검사 및 AI 변경 감지 eval을 PR CI에 연결한다. 실행 명령과 합성/외부 검증 경계는
[테스트 전략](../quality/TEST-STRATEGY.md)에 기록한다. 실제 모델 품질은 여전히 #27이다.
계정 삭제와 settings, 공유 cleanup scheduler, restore journal 재적용의 offline 검증은
#17이며 [삭제/복구 절차](../operations/DELETION-RESTORE.md)를 따른다.
실제 모델 품질·platform Workflow timing·외부 OAuth/Turnstile/Gateway 성공,
복구/rollback 및 공개 정책은 P0.3 #18/#19/#20/#27이다. `Implementation-ready`는
목표 계약이며 외부 승인 완료를 뜻하지 않는다. 원격 schema는 배포 health로 확인한다.

실제 진행 상태의 정본은 GitHub 이슈/PR이며 의존성과 소유 경계는 [작업 그래프](./work-items.json)다. PR이 병합되어 선행 이슈가 완료되기 전에는 후속 제품 코드가 ready가 아니다. 마일스톤은 실행자 배정이 아니라 완료 게이트다.

## 작업 선택·인계

`bun run work:next`는 GitHub open 이슈, 실제 선행 상태, 열린 PR과 로컬 그래프를 비교한다. ready 중 P0와 번호 순으로 하나를 택한다. 시작 시 이슈에 브랜치와 작업 범위를 적고 `status:in-progress`를 붙인다. 이 라벨이 붙은 작업은 다른 에이전트가 시작하지 않는다. 작업을 멈출 때 재현 명령, 남은 인수 조건, blocker, PR을 남기고 라벨을 제거한다.

명세·테스트 대역으로 가능한 구현과 실제 콘솔/정책 승인 검증을 분리한다. 외부 승인 대기 때문에 offline 개발 전체를 멈추지 않는다. 독립된 ready 이슈가 없을 때만 구체적인 외부 blocker를 보고한다. 이 문서나 CLI는 모델을 자동 실행하거나 GitHub issue를 agent에게 자동 배정하지 않는다. 그런 상시 실행은 별도의 실행기·스케줄과 사용자 권한이 필요하다.

## 작업 경계

| 영역 | 소유 이슈/기준 | 충돌 방지 |
| --- | --- | --- |
| 인증 테이블·user_consents·세션 middleware | #10, PR #35 | #8은 기존 auth migration을 재작성하지 않음 |
| 도메인 DB·repository·migration | #8 | 모든 후속 schema 요청을 먼저 통합 |
| 암호화 | #9 | envelope 계약으로 #8과 독립 개발 |
| 사건 생성·quota·outbox | #11 | read/delete API #12와 파일 분리 |
| AI adapter | #15 | Workflow와 순환 의존 없이 shared contract와 대역 사용 |
| 법률 adapter | #14 | AI 생성과 독립, 공식 schema fixture로 검증 |
| screening·질문·Workflow | #13 | #11/#14/#15 통합 후 시작 |
| 사건 UI | #16 | 로그인·동의 UI는 #10 소유, UI 상태는 UX 명세 정본 |
| 상세·질문·결과 UI | #29 | #16은 목록·입력만 소유 |
| shared 계약 | #28 | 후속 모듈이 서로 다른 타입을 재정의하지 않음 |
| offline fixture/harness | #31 | #18의 출시 검증 도구를 선행 구축 |
| 성공 지표·선택 피드백 | #30 | opt-in과 allowlist, #20 정책과 동기화 |
| eval/E2E | #18 | 합성 fixture·harness는 즉시, live gate는 통합 뒤 |
| 배포·외부 검증 | #19 | 코드 완료와 환경 readiness를 구분 |
| 공개 정책/외부 랜딩 | #20 | 법률 승인과 사업자 사실은 human-required |

## 마일스톤 exit 기준

- P0.1: #8/#9/#10/#26/#28/#31 offline 인수 조건 + migration/암호화/세션/동의 통합 검증. OAuth 콘솔 승인·실제 callback은 #27이며 이 단계의 offline 개발을 막지 않는다.
- P0.2: #11~#16/#29/#30 계약·실패·중복·삭제 가드 테스트, 합성 흐름으로 입력→질문→검증된 결과 통합.
- P0.3: #17~#20/#27 완료, 실제 provider smoke와 eval 증거, 공개 정책 확정, 복구/삭제 drill. 여기서만 공개 베타 전환한다.

## 외부 readiness

| 항목 | 확인된 상태 | 완료 증거/담당 |
| --- | --- | --- |
| 도메인·D1·Workflow·KV | preview/prod scaffold 배포 완료 | #19의 health/ready smoke |
| 운영 OAuth | 운영 Worker secret 7개 등록, 실제 callback 미검증 | 환경 readiness 이슈, 공급자 callback·테스터 승인 |
| 개발/preview OAuth | preview signing secret 생성·양쪽 등록, auth origin 일치. 공급자 client 6개 미등록 | 별도 client/callback·tester·앱 승인과 성공/취소 검증. Google 콘솔 로그인 필요 |
| 법률 OC | `crenova` 승인 정보 수신 | #14 live schema/응답 검증; 요청 URL 로그에 OC를 남기지 않음 |
| Turnstile | preview 전용 widget·site key 변수·secret 등록, Managed/pre-clearance 없음 | case_create action과 실제 성공·실패·재사용 검증 |
| AI Gateway | baro-preview 생성, 인증 필수/logging·cache OFF/Unified Billing, 기존 credit $10/auto recharge OFF | preview binding 배포, 호출 한도 승인·live eval·provider ZDR 확인. 새 구매 안 함 |
| 암호화 키 | preview V1 생성·GitHub preview/Worker 등록, private 전달 파일 ACL 제한 | wrapper는 V1만 연결. 별도 복구 관리자·rotation 통합·live 복구 증거 필요 |
| 플랫폼 로그/백업 | invocationLogs false, observability enabled/sampling1/tail0. plan·보존 미확정 | payload 예외/retention·접근, D1 paid30/free7와 journal 목표35일 대조 |
| 정책/랜딩 | Draft blocker 유지. 별도 랜딩 PR 1 병합·Pages 반영, 범위 밖 주장 6종 제거 | 사업자 사실·법률 검토·게시/버전 승인 |
| #19 통합/drill | #18 완료, #27 OPEN이므로 BLOCKED | 독립 candidate/경보 계약·격리 runbook만 완료. 환경/합성 전용 자원/테스트 수신처·발송 권한 확보 뒤 통합 |

실제 관측 시각·필요 secret/담당 행동은 [환경 readiness](../operations/ENVIRONMENT-READINESS.md),
격리 복구·rollback·경보 절차는 [Beta drills](../operations/BETA-DRILLS.md)에 기록한다.
foundation health 성공은 OAuth→사건→Workflow→법령→결과→삭제 또는 live model 평가의
증거가 아니다. 기존 release checker의 boolean 형태를 새 candidate의 증거로 인정하지
않으며, #27 뒤 trusted receipt resolver와 배포 gate 통합이 필요하다. 정책은 Draft,
reviewedAt은 null, 모든 external check는 false다. P0.3 milestone과 Epic #6은 OPEN 유지한다.

## 표준 검증

```bash
bun ci
bun run check
bun run build
bun run cf:dry-run
bun run db:generate
git status --short
```

마지막 generate는 schema drift가 없으면 파일을 만들지 않는다. migration은 append-only다. #8의 적용 순서와 비민감 preview 검증 쿼리는 [도메인 DB 운영](../operations/DOMAIN-DATABASE.md)을 따른다. secret 없는 CI가 외부 서비스에 접속하거나 모델 비용을 발생시키지 않아야 한다. 리뷰 브랜치의 prod API는 `PUBLIC_BETA_ENABLED=false`로 닫히며 병합/배포 전 원격에 적용된 것으로 해석하지 않는다. framework health 확인은 공개 기능 인수 조건을 대신하지 않는다.

## 환경과 local 설정

`.env.example`을 `.env`, `.dev.vars.example`을 `.dev.vars`로 복사한다. `.env`는 브라우저에 노출 가능한 `PUBLIC_*`만, `.dev.vars`는 Worker 설정만 포함한다. 운영 OAuth 키가 입력된 현재 로컬 파일은 dev 전용 값으로 교체하기 전 실제 OAuth 개발에 쓰지 않는다. 현재 PC의 다른 앱과 4321 포트가 충돌하면 `bun run dev -- --port 4322`를 쓰고 개발용 `BETTER_AUTH_URL`과 callback도 같은 port로 맞춘다.

현재 consent 버전은 개발 검증용이며 공개 초안의 승인 버전이 아니다. #20의 공개 승인 시 게시 문서의 버전과 `CURRENT_POLICY_VERSIONS`를 함께 확정한다. release gate가 일치 여부를 검사한다.

## 사용자 개입이 필요한 범위

기능 구현·테스트 대역·PR 수정·기존 계약의 모호함 해소는 에이전트가 수행한다. 현재 사용자 Goal은
합의한 리소스와 월 기술100만원 내 실제 처리 비용, 검증된 PR 병합, preview/production 배포와
승인 요건 충족 후 최초 공개를 허용한다. 새 결제수단·자동충전·예산 확대는 별도 승인이다.
OAuth 테스터/공급자 앱 승인, 법률 검토·사업자 사실과 실제 공개 근거는 외부 책임으로 남는다.
`Quality gate`는 코드 게이트이고 법률/실서비스 승인 증거를 대신하지 않는다.
현재 GitHub production Environment는 `hyunhomon` 승인 1회가 필요하며 우회하지 않는다.
