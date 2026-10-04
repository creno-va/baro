# BARO

[![CI](https://github.com/creno-va/baro/actions/workflows/ci.yml/badge.svg)](https://github.com/creno-va/baro/actions/workflows/ci.yml)

BARO는 대한민국의 개인 간 금전 대여 문제를 겪는 사용자가 자신의 상황을 정리하고,
확인할 쟁점·준비할 자료·일반적인 다음 행동을 이해하도록 돕는 웹 서비스입니다.

> 현재 상태: 제품·아키텍처 명세와 Cloudflare 기반 scaffold 완료, 기능 구현 시작 전

BARO는 변호사나 법률사무소가 아니며 법률 자문, 승소 가능성 판단, 사건 수임 또는
전문가 추천을 제공하지 않습니다. AI 결과는 공식 법령 출처와 함께 제공되는 일반
정보이며, 중요한 결정과 기한은 공식 원문 또는 자격 있는 전문가를 통해 확인해야 합니다.

## MVP

MVP는 대한민국에 거주하거나 대한민국 법률이 적용되는 만 14세 이상 사용자를 대상으로
다음 흐름을 제공합니다.

```text
Google/Naver/Kakao 로그인
  -> 필수 동의와 만 14세 이상 확인
  -> 개인 간 금전 대여 사건 입력
  -> 범위·긴급성 확인
  -> 필요한 경우 최대 5개의 추가 질문
  -> 공식 법령 검색과 인용 검증
  -> 사건 요약·쟁점·증거 체크리스트·일반 절차
  -> 저장·재열람·사건 또는 계정 삭제
```

다른 법역과 사건 유형, 승소 가능성, 확정적인 법률 판단, 변호사 연결, 제출 문서 자동
작성은 MVP 범위에 포함되지 않습니다.

## 기술 방향

| 영역 | 선택 |
| --- | --- |
| Toolchain | Bun |
| Web | Astro 7, React islands, Tailwind CSS |
| API | Hono, Zod, Hono RPC |
| Runtime | Cloudflare Workers (`workerd`) |
| Database | Cloudflare D1, Drizzle ORM |
| Long-running jobs | Cloudflare Workflows |
| Authentication | Better Auth, Google/Naver/Kakao OAuth |
| AI | Cloudflare AI Gateway Unified Billing, provider-keyless model access |
| Legal source | 국가법령정보 공동활용 Open API |
| Delivery | GitHub Actions, fixed preview, production environment |

Bun은 패키지 관리·스크립트·테스트에 사용합니다. 배포 코드는 `Bun.*` 또는 Node 전용
런타임 API에 의존하지 않고 Cloudflare Workers의 Web API와 binding을 사용합니다.

## 문서

구현 전에는 아래 순서로 읽는 것을 권장합니다.

1. [문서 지도](./docs/README.md)
2. [제품 요구사항](./docs/PRD.md)
3. [MVP 기능 명세](./docs/product/MVP-SPEC.md)
4. [UX 및 화면 상태](./docs/product/UX-SPEC.md)
5. [Architecture Decision Records](./docs/adr/README.md)
6. [시스템 설계](./docs/architecture/SYSTEM.md)
7. [데이터 모델](./docs/architecture/DATA-MODEL.md)과 [HTTP API](./docs/architecture/HTTP-API.md)
8. [AI 파이프라인](./docs/architecture/AI-PIPELINE.md)과 [법률정보 검색](./docs/architecture/LEGAL-RETRIEVAL.md)
9. [보안·개인정보](./docs/security/SECURITY-PRIVACY.md)와 [테스트 전략](./docs/quality/TEST-STRATEGY.md)
10. [배포·운영](./docs/operations/DEPLOYMENT-OPERATIONS.md)

공개 정책 문서는 [정책 초안 디렉터리](./docs/policies/)에 있습니다. 법률 검토와 문서에
표시된 publication blocker 해소 전에는 공개본으로 사용하지 않습니다.

## 로컬 개발

사전 요구사항은 [`.bun-version`](./.bun-version)에 고정된 Bun과 Cloudflare 계정입니다.
의존성을 설치하고 로컬 D1 schema를 적용한 뒤 개발 서버를 시작합니다.

```bash
bun ci
bun run db:migrate:local
bun run dev
```

품질 검사는 다음 명령으로 동일하게 재현할 수 있습니다.

```bash
bun ci
bun run lint
bun run typecheck
bun run test
bun run build
bun run cf:dry-run
```

환경 변수와 secret 이름은 [`.env.example`](./.env.example)과
[`.dev.vars.example`](./.dev.vars.example)을 참고하세요. 실제 값은 Git에 커밋하지
않습니다. CI는 `bun.lock`, package script, Wrangler 설정과 dry-run을 자동 검사합니다.

## 기여 흐름

`main`에 직접 push하지 않습니다.

1. GitHub Issue에서 범위와 인수 조건을 정합니다.
2. `codex/` 또는 작업 목적을 나타내는 브랜치를 만듭니다.
3. 작고 검토 가능한 Pull Request를 엽니다.
4. `Quality gate` 통과와 대화 해결 후 squash merge합니다.
5. 병합된 브랜치는 자동 삭제합니다.

PR과 Issue 작성 기준은
[GitHub repository setup](./.github/REPOSITORY-SETUP.md)을 참고하세요.

## 배포

- main의 CI가 성공하면 고정 `preview` Cloudflare Environment 배포가 시작됩니다.
- production은 GitHub Actions에서 명시적으로 실행하고 Environment 승인을 거칩니다.
- preview URL: <https://preview.baro.site>
- production URL: <https://baro.site>
- 환경별 D1, Workflow, OAuth client, 암호화 키와 API secret을 공유하지 않습니다.
- 현재 Accepted 설계에는 R2가 필요하지 않습니다. 사용 요구가 생기면 별도 ADR과
  개인정보 보존·삭제 정책을 먼저 승인합니다.

## 보안 문제

실제 사건 내용, 개인정보, OAuth token 또는 secret을 공개 Issue에 올리지 마세요.
민감한 취약점은 저장소의 [Security](https://github.com/creno-va/baro/security) 채널을
사용하고, 일반 버그에는 비민감 request ID와 재현 절차만 첨부해 주세요.
