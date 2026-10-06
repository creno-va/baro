# BARO
> **2026-10-06 사용자 개정 — 아래 이전 범위보다 우선한다.** MVP는 고객/변호사 두 역할이며 통합 로그인에서 선택한다. 변호사 승인 어드민·자격 심사·반려·승인대기 UX는 제외한다. 실제 제품 client UI 동일 구현체를 API mock adapter로 먼저 완성하고 기능 연결을 병렬 진행한다. 별도 /mock UI는 만들지 않는다. [5세션 계획](./docs/development/PARALLEL-UI-SPRINT.md)의 실제 착수부터 2시간 sprint를 적용하며 독립 UI는 DB/AI/OAuth/backend CI/A 이슈 종료를 기다리지 않는다. 완료된 코드/이슈/증거를 보존하고 새 DB/비용 선행 이슈를 추가하지 않는다. AI 품질 확대는 모든 UX 연결 뒤다. P0.3/#70/#71 외부·정책·production·공개 gate는 보존하며 mock 성공을 실제 외부 성공으로 표시하지 않는다. [ADR-0014](./docs/adr/0014-mvp-two-roles-and-api-mock-first.md)가 대체 범위를 기록한다.

[![CI](https://github.com/creno-va/baro/actions/workflows/ci.yml/badge.svg)](https://github.com/creno-va/baro/actions/workflows/ci.yml)

BARO는 사용자가 변호사의 프로필을 살펴보고 직접 연락하며, AI 와 사건의 사실관계·
자료·타임라인·준비할 행동을 정리하는 대한민국 웹 서비스입니다. 사용자가 확인한
PDF 리포트와 선택한 원본을 직접 전달해 변호사의 초기 사건 이해를 돕습니다.

> 현재 구현은 v1 개인 간 금전 대여 분석·저장·삭제입니다. v2 변호사 디렉터리·
> 적응형 질문·지속 채팅·자료 처리·리포트 전달은 전체 개발 목표입니다.
> P0.3 실제 외부 연동·운영·정책 승인과 v2 전체 시연은 미완료이며 공개 API는
> 기본 비활성화입니다. 문서 개정은 구현이나 법률 승인 완료를 뜻하지 않습니다.

2026-10-07 사용자 후속 지시에 따라 배포되는 preview와 production은 실제 same-origin API를
사용합니다. 예시 adapter는 명시적 local/격리 검증에 보존합니다. 실제 외부 설정이 없으면
기존 실패 상태를 표시하고 예시 응답으로 대체하지 않습니다. 현재 SHA별 배포·검증과 남은
외부·공개 조건은 [release journal](https://github.com/creno-va/baro/issues/71#issuecomment-6021564076)에 기록합니다.

초기 서비스는 무료이며 소개·중개 수수료를 받지 않습니다. 수수료가 없다는 이유만으로
적법성을 보장하지 않습니다. BARO는 변호사나 법률사무소가 아니며 승소 가능성·확정
법률 판단·소송 전략·사건 수임을 대신하지 않습니다. 변호사 선택과 실제 연락·자료
전달은 사용자가 직접 수행합니다.

## v2 전체 서비스 목표

대한민국 법률이 적용되는 만 14세 이상 개인과 기업을 대상으로 모든 사건 가족의
사실 정리와 변호사 탐색을 지원합니다. 기업 사건도 한 계정이 소유하며 팀 공동 편집은
제공하지 않습니다. 공개 디렉터리는 비로그인으로 탐색하고 사건은 로그인 후 이용합니다.

```text
변호사 목록·객관적 필터 → 공개 프로필 → 사용자의 직접 외부 연락
        ↘ 통합 로그인(고객/변호사)·동의 → 적응형 질문·모름/건너뛰기·저장/재개
              → 사용자 요약 확인 → 채팅·사실·자료·타임라인·다음 행동
              → 리포트 검토·마스킹/제외 → PDF·선택 원본 ZIP
              → 사용자 직접 전달 → 이후 정리와 리포트 갱신
```

변호사는 자기 프로필을 작성·저장·미리보기합니다. MVP에서 승인 어드민과 자격 심사 흐름은 제외합니다.
사건 분석 기반 AI 변호사 순위·유료 우선 노출·플랫폼 내부 상담은 만들지 않습니다.
기존 심사 backend는 보존하며 이번 MVP UI에 노출하지 않습니다. role 선택을 자격 확인으로 표시하지 않습니다.

문서·이미지·음성·영상의 실제 처리와 coverage, private 원본/파생물/리포트의 삭제,
사용량·기술 월 100 만원 예산을 검증합니다. 세부 한도와 완료 기준은 [PRD](./docs/PRD.md),
[MVP](./docs/product/MVP-SPEC.md), [실제 UI 시연 행렬](./docs/product/UI-DEMONSTRATION.md)이 정본입니다.

기존 v1 사건·schemaVersion 1·분석 결과·읽기·삭제는 보존하고 사용자 승인 없이 재분석하지 않습니다.
마일스톤 6은 같은 client UI의 API mock 시연, 마일스톤 5는 고객/변호사 실제 기능 연결입니다.
외부 연동·preview/production·법률/정책·최초 공개 gate는 #71에 남깁니다.

## 기술 방향

| 영역 | 선택 |
| --- | --- |
| Toolchain | Bun |
| Web | Astro 7, React islands, Tailwind CSS |
| Design system | shadcn 기반, blue primary, Lucide, Pretendard, shared SVG |
| API | Hono, Zod, Hono RPC |
| Runtime | Cloudflare Workers; 격리된 heavy file processor만 Containers |
| Database / jobs | D1·Drizzle, Workflows |
| Files / reports | R2 private 원본·파생물·리포트 / 승인된 public profile 자산 분리 |
| Authentication | Better Auth, Google/Naver/Kakao OAuth |
| AI | 기존 AI Gateway Unified Billing pinned model·medium 유지, Cloudflare Whisper ASR 확장 |
| Legal source | 공식 법령·공식 판례·공식기관 안내의 검증된 원문 |
| Delivery | GitHub Actions, fixed preview, approved immutable production release |

웹/API 제품 코드는 Workers Web API 와 binding을 사용합니다. Bun은 도구·테스트용이며
Node filesystem/process는 별도 Container 처리 서비스에만 허용합니다. v2 저장소/
처리/모델 capability는 아직 live 미검증입니다. [ADR](./docs/adr/README.md)이 기존
결정의 유지 범위와 v2 부분 대체를 설명합니다.

## 문서와 작업

에이전트는 [AGENTS.md](./AGENTS.md), [실행 기준](./docs/development/EXECUTION.md)을 먼저 읽고
`bun run work:next`로 실제 선행 상태와 다른 작업을 확인합니다.

1. [문서 지도](./docs/README.md)
2. [PRD](./docs/PRD.md), [MVP](./docs/product/MVP-SPEC.md), [UX](./docs/product/UX-SPEC.md)
3. [시연 행렬](./docs/product/UI-DEMONSTRATION.md), [로드맵](./docs/product/ROADMAP.md)
4. [ADR](./docs/adr/README.md), [시스템](./docs/architecture/SYSTEM.md)
5. [데이터](./docs/architecture/DATA-MODEL.md), [API](./docs/architecture/HTTP-API.md), [실행 계약](./docs/architecture/DOMAIN-LIFECYCLE.md)
6. [AI](./docs/architecture/AI-PIPELINE.md), [공식 출처](./docs/architecture/LEGAL-RETRIEVAL.md)
7. [보안](./docs/security/SECURITY-PRIVACY.md), [테스트](./docs/quality/TEST-STRATEGY.md), [배포](./docs/operations/DEPLOYMENT-OPERATIONS.md)

[공개 정책 초안](./docs/policies/)은 법률 검토·사업자 사실·게시 버전 승인 전 공개본으로
사용하지 않습니다. 기술적으로 production에 배포하는 것과 일반 사용자 공개 전환을 구분합니다.

## 로컬 개발과 검증

`.bun-version`의 Bun을 사용합니다. `.env.example`과 `.dev.vars.example`을 각각
로컬 파일로 복사하고 secret은 커밋하지 않습니다. 실제 OAuth 에는 개발용 client만 쓰고,
키 없는 개발·CI 에는 합성 test adapter를 사용합니다. 제품에 인증/모델 fallback을 추가하지 않습니다.

```bash
bun ci
bun run db:migrate:local
bun run dev
```

```bash
bun ci
bun run check
bun run build
bun run cf:dry-run
bun run eval:offline
bun run test:ui
bun audit
bun run build:production
bun run bundle:check
```

DB 변경은 generation drift·fresh/upgrade 검증을 추가합니다. Container·R2·ASR 와 모든
역할의 실제 시연은 downstream 이슈의 검증이며 기존 offline 통과로 대체하지 않습니다.

## 기여·배포

`main`에 직접 push 하지 않습니다. 이슈의 범위/인수 조건과 작업 시작을 기록하고
깨끗한 main 에서 `codex/<issue>-<purpose>` 브랜치를 만듭니다. 다른 작업자는 별도
worktree를 사용합니다. PR 검사·실패 시나리오와 리뷰를 마친 뒤 권한 범위에서 병합합니다.
설정은 [repository setup](./.github/REPOSITORY-SETUP.md)을 따릅니다.

- main CI 성공 후 고정 preview로 자동 배포합니다.
- production은 성공한 CI·preview smoke의 immutable SHA 와 Environment 승인을 요구합니다.
- foundation 코드는 공개 API를 닫고 배포할 수 있습니다. 공개 전환은 실제 연동·운영·정책/법률 조건을 충족한 후에만 합니다.
- preview: <https://preview.baro.site>, production: <https://baro.site>.
- 환경별 DB·Workflow·R2·Container·OAuth·Gateway·키와 secret은 분리합니다.
- 전체 개발은 [마일스톤 5](https://github.com/creno-va/baro/milestone/5)에서 추적하고 실제 시연 증거로 판정합니다.

## 보안 문제

실제 사건·자료·개인정보·OAuth token·secret을 공개 이슈/PR/artifact에 올리지 않습니다.
민감 취약점은 저장소 [Security](https://github.com/creno-va/baro/security), 일반 오류는
비민감 request ID 와 재현 절차만 사용합니다.
