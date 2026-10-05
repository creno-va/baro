# 프로젝트 전체 리뷰 — 자율 개발 준비도

- Reviewed: 2026-10-05
- Tracking: [#26](https://github.com/creno-va/baro/issues/26)
- Scope: main `8e66629`, OAuth draft [PR #25](https://github.com/creno-va/baro/pull/25), open issues/milestones/protection/environments, 전체 docs, scaffold, CI/CD
- 수정은 리뷰 브랜치에 있으며 병합 전 main에 적용된 것으로 해석하지 않는다.

## 판단

기존 상태에서는 이슈 번호만 배정해 지속 개발하기 어려웠다. 의존성, 공유 계약, 삭제/중복 실행, 테스트 준비와 출시 권한이 서로 맞지 않았다. 이번 수정은 개발자가 매번 제품 결정을 다시 묻지 않고 **ready 이슈 → offline 검증 → PR**을 진행할 수 있게 하는 기반이다. 실제 제품 전체를 구현하거나 공개 출시가 승인되었다는 뜻은 아니다.

Astro + Hono + Drizzle, Bun 개발 도구 + Cloudflare Worker 런타임의 선택은 웹 MVP에 적합하다. D1을 정본으로 하고 AI/법령 adapter를 분리하는 ADR도 유지한다. 다만 managed Workflow를 DB transaction처럼 취급하거나 모델 과금을 exactly-once라고 전제하면 안 된다. [ADR-0005](../adr/0005-durable-execution-and-release-gates.md)는 기존 결정의 운영 제약을 보완한다.

GitHub 이슈는 작업 계약이며 agent 실행기 자체가 아니다. 모델 실행·스케줄을 별도 요청하지 않은 현재 상태에서 자동으로 에이전트들이 실행되지는 않는다. 공개 출시에는 공급자 심사, 사업자 사실·법률 승인, 비용/한도 결정, production 승인 경계가 남는다.

## 발견 사항과 조치

| 우선순위 | 문제와 영향 | 조치 / 남은 인수 조건 |
| --- | --- | --- |
| P1 | #8/#10의 consent schema 소유 중복, #16의 auth/전체 UI 중복, 선행 이슈가 글로만 표현되어 병렬 작업 충돌 | 번호 기반 DAG와 소유 경계 추가. #16은 목록·입력, #29는 상세·질문·결과. auth 먼저 #10, 도메인 DB #8 |
| P1 | 공통 strict schema가 없어 각 agent가 다른 AI/HTTP shape를 구현할 위험 | [실행 계약](../architecture/DOMAIN-LIFECYCLE.md), #28 shared Zod/fixtures 선행 작업 |
| P1 | D1 quota·idempotency·Workflow dispatch 사이 원자성/복구 계약 누락 | guarded batch + durable outbox, crash 시나리오와 reconciliation을 #8/#11에 명시. 구현은 후속 이슈 |
| P1 | revision/질문 만료/재시도/삭제 race와 backup 복구 시 원문 재등장 위험 | 한 묶음 최대5 질문, 24h, CAS, encrypted checkpoint, deletion journal와 복구 순서 정의. #13/#17에서 검증 |
| P1 | Workflow·Gateway 저장 state/log/cache까지 암호화·삭제 범위에 포함되지 않음 | Workflow params/events/step는 opaque reference, Gateway collectLog=false/skipCache=true. #9/#13/#15/#27 검증 |
| P1 | Drizzle SQL은 있으나 journal/snapshot이 없어 다음 generate가 기존 테이블을 다시 생성할 위험 | 기존 SQL 보존하며 meta baseline 복원. schema drift/fresh/upgrade 검사 추가 |
| P1 | 배포 대상이 mutable main이며 build 실패 전 migration이 적용될 수 있음 | build/dry-run 후 migration, exact SHA의 main CI+preview smoke 증거 확인, 오래된 preview 배포 차단 |
| P1 | foundation health 성공을 제품 출시 완료로 오해할 수 있음 | production API 기본 closed, foundation/public-beta 모드 분리. 정책·실서비스·복구 증거 release gate는 현재 의도적으로 실패 |
| P1 | offline D1/auth 테스트·eval 준비가 최종 마일스톤에 몰림 | real SQLite migration/session/consent 회귀 검사 추가. #31 offline harness 선행, #18 최종 eval/E2E 게이트 |
| P2 | OAuth 네트워크 실패 시 로그인 버튼 pending 고착, consent fetch 실패 시 무한 로딩 | 사용자 오류 상태·재시도, callback 실패 안내 추가. 실제 callback은 #27 |
| P2 | API 에러의 requestId 불일치, unknown route/default exception 일관성 부족 | safe error envelope, validated requestId, 64KiB body limit와 회귀 검사. Better Auth 응답은 별도 계약 |
| P2 | Better Auth 내부 로그와 자동 Worker invocation log에 요청 metadata가 남을 수 있음 | auth logger·invocation logging 기본 off, security headers. 비민감 관측/상세 CSP는 #19/#18 |
| P2 | 모든 ADR을 Accepted로 강제하여 향후 Proposed/Superseded 기록 불가, root 링크 검사 빠짐 | 유효한 ADR lifecycle 허용, root/.github/AGENTS 링크 검사 추가 |
| P2 | Windows CRLF와 scripts/tests 검사 누락으로 local과 Linux CI 결과 불일치 | .gitattributes LF, 도구 전용 TypeScript 범위, lint 범위 확장 |
| P2 | 배포 권한을 쓰는 third-party Actions의 태그가 이동 가능 | 공식 repository tag가 가리키는 commit SHA로 고정, YAML/pin/CD 순서 회귀 검사 추가 |
| P2 | PRD 완료/열람 지표와 analytics 정의 불일치, 수집 구현 담당 부재 | opt-in·중복 방지·시간/분모 정의 통일, #30 전담 이슈 |
| P2 | env/문서 상태가 실제 구현 완료로 읽히고 #19 observability 링크 오기 | 구현/목표/외부 readiness 표 분리, 정확한 경로와 마일스톤 exit 기준 명시 |

D1 `batch`는 SQL 오류 때 rollback하지만 conditional UPDATE의 0행은 오류가 아니다. 하위 INSERT까지 동일 admission predicate가 필요하다. [D1 공식 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

Workflow 실행 상태와 step 값은 플랫폼에 저장되므로 D1 원문 암호화만으로 충분하지 않다. 저장 상태 삭제와 at-least-once 전송을 고려한다. [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/), [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)

현재 선택한 `openai/gpt-6-sol` 모델은 공식 모델 목록에 있으며 모델명을 추측으로 바꾸지 않았다. Unified Billing은 provider API key 없이 사용할 수 있다. 실제 account/model 접근·credit·payload logging·spend gate는 #27의 검증 대상이다. [모델 문서](https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/), [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/), [Worker binding](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)

## 지금 가능한 개발

리뷰 수정과 OAuth 기반은 PR로 검증·병합해야 한다. 암호화 #9, shared contract #28은 독립 준비가 가능하다. auth #10 완료 후 #8, shared contract 후 #31/#15, 이후 그래프 순으로 통합한다. 실 OAuth key 없이도 fixture와 test-only auth/session으로 제품 구현이 진행되어야 한다.

소유 경계는 잠금이 아니라 충돌 예방 규칙이다. 공유 파일/schema 변경은 담당 이슈와 조율해 선행 PR로 통합한다. 완료된 issue가 아니라 단순 draft PR 존재만으로 선행 완료로 취급하지 않는다. [실행 지침](../development/EXECUTION.md), [작업 그래프](../development/work-items.json), [AGENTS](../../AGENTS.md)

## 남은 경계

- #10: 현재 draft는 OAuth/consent 기반이다. 실제 재인증 시각, token/IP/User Agent 최소화, 현재 정책 동의 gate와 negative callback 검증까지 인수 조건을 충족하기 전 닫지 않는다.
- #20: 법률 검토·사업자 사실·정책 공개 버전·외부 랜딩 감사. 승인이나 사실정보를 임의 생성하지 않는다.
- #27: production OAuth callback, 별도 preview clients, Turnstile, AI Gateway credit/로그/예산, 법령 live schema, 환경별 키와 복구 관리. 현재 로컬 OAuth 값은 운영용이며 dev 값으로 교체 전 실제 dev OAuth에 사용하지 않는다.
- #18/#19: 50 eval, 전체 E2E/accessibility, 안전/삭제 race, 실제 synthetic smoke와 복구/rollback/alert 증거. health만 확인하고 완료 처리하지 않는다.
- production Environment는 실제 `hyunhomon` 승인을 요구한다. main은 strict Quality gate/linear history/conversation resolution을 요구하지만 필수 approving code review는 현재 0명이다. 무인 코드 병합 정책과 공개 출시 승인은 구분한다.
- 원격 preview/prod health200/schema0000, 운영 auth secret7개·preview0개를 읽기 전용으로 재확인했다. 이번 auth migration0001·beta gate·SHA smoke 수정은 아직 운영 배포되지 않았다.

## 검증 범위

재현 명령: `bun run check`, `bun run build`, `bun run cf:dry-run`, isolated local workerd D1 migration, `bun run work:next`. 정적 검사·typecheck·23개 테스트·schema drift 검사가 통과했다. 실제 local workerd fresh migration 2개와 health live/ready200, 미인증 consent401, login/consent200 및 DENY frame header를 확인했다. preview/production 별도 빌드와 CD 명령의 SHA/flag override dry-run도 통과했다. workflow/template YAML 9개를 parse했다. `bun run release:check`는 미승인 정책·버전 불일치·미제출 증거로 의도대로 실패한다. 최신 branch CI 결과는 연결된 리뷰 PR에 기록한다.

추가한 테스트는 real SQLite SQL/upgrade, 실제 signed session+consent route, production closed gate, error/requestId와 release/work graph의 offline 회귀다. Cloudflare 실제 배포, 실제 계정 login callback, 유료 모델 호출, full browser E2E나 법률 승인을 수행한 것으로 해석하지 않는다.
