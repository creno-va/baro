# BARO

[![CI](https://github.com/creno-va/baro/actions/workflows/ci.yml/badge.svg)](https://github.com/creno-va/baro/actions/workflows/ci.yml)

BARO는 사용자가 변호사의 프로필을 살펴보고 직접 연락하며, AI 와 사건의 사실관계·
자료·타임라인·준비할 행동을 정리하는 대한민국 웹 서비스입니다. 사용자가 확인한
근거 사진을 포함할 수 있는 PDF 리포트를 직접 전달해 변호사의 초기 사건 이해를 돕습니다.

고객/변호사 두 역할의 v2 기능은 main에 통합됐으며 기존 v1 데이터·읽기·삭제를 보존합니다.
현재 공개 서비스를 유지하면서 신규 기능 확장을 멈추고 비용 재개·저장·릴리스 증거·검색을
정비합니다. 질문은 최대 2차례×3문항, AI는 계정별 KST 하루200회이며 앱의 월 예산·재원·요청
금액뿐 아니라 가격/FX/funding 관측 누락·만료·월별 할당·수동 refresh·유지비·비용 IO 예약으로
기능이나 배포를 막지 않습니다. `APPLICATION_COST_LIMITS_ENABLED=false`는 비용 관측 전용입니다.
기존 결제·$10/$30 자동충전과 실제 비용·미정산 기록, 기술용량·사용자 quota·권한은 보존합니다.
[정책과 구현 진행 상태](./docs/operations/PREBETA-COST-POLICY.md)를 확인하며 새 직접 사용자 지시 전
비용 차단을 재도입하지 않습니다. 문서의 과거 예산 수치보다
[현행 비용 정책](./docs/adr/0015-maintenance-and-operating-policy.md)이 우선합니다.
[ADR-0015](./docs/adr/0015-maintenance-and-operating-policy.md)가 현재 운영 결정입니다.
정비 종료와 전체 MVP 실제 인수는 별개이며 [인수표](./docs/development/MVP-REQUIREMENTS-EVIDENCE.md)와 #71로 추적합니다.
2026-10-27 사용자 지시에 따른 전체 이슈 범위 종료와 API·스토어 보류, 실제 미해결 조건은
[최신 정비 인계](./docs/quality/MAINTENANCE-HANDOFF-2026-10-27.md)를 따릅니다.
이슈 종료를 보안 통과·구형 재분석 복구·실제 릴리스 완료로 해석하지 않습니다.

2026-10-07 사용자 후속 지시에 따라 배포되는 preview와 production은 실제 same-origin API를
사용합니다. 예시 adapter는 명시적 local/격리 검증에 보존합니다. 실제 외부 설정이 없으면
기존 실패 상태를 표시하고 예시 응답으로 대체하지 않습니다. 현재 SHA별 배포·검증과 남은
외부·공개 조건은 [release journal](https://github.com/creno-va/baro/issues/71#issuecomment-6021564076)에 기록합니다.

초기 서비스는 무료이며 소개·중개 수수료를 받지 않습니다. 수수료가 없다는 이유만으로
적법성을 보장하지 않습니다. BARO는 변호사나 법률사무소가 아니며 승소 가능성·확정
법률 판단·소송 전략·사건 수임을 대신하지 않습니다. 변호사 선택과 실제 연락·자료
전달은 사용자가 직접 수행합니다.

## 현재 MVP 범위

대한민국 법률이 적용되는 만 14세 이상 개인과 기업을 대상으로 모든 사건 가족의
사실 정리와 변호사 탐색을 지원합니다. 기업 사건도 한 계정이 소유하며 팀 공동 편집은
제공하지 않습니다. 공개 디렉터리는 비로그인으로 탐색하고 사건은 로그인 후 이용합니다.

```text
변호사 목록·객관적 필터 → 공개 프로필 → 사용자의 직접 외부 연락
        ↘ 통합 로그인(고객/변호사)·동의 → 적응형 질문·모름/건너뛰기·저장/재개
              → 사용자 요약 확인 → 채팅·사실·자료·타임라인·다음 행동
              → 리포트 검토·마스킹/제외·사진 선택 → HTML 구성·PDF 저장
              → 사용자 직접 전달 → 이후 정리와 리포트 갱신
```

고객과 변호사는 같은 사건 입력·AI 작업공간·파일·리포트 기능을 이용합니다. 로그인 후 시작은
`/app`이며, 변호사 사이드바는 변호사 찾기 대신 본인 프로필 관리로 연결합니다. 계정별 소유권,
필수 동의와 AI/저장 용량 한도는 동일하게 적용합니다. 프로필 작성·저장·공개는 변호사 계정의
본인 정보에만 허용합니다. MVP에서 승인 어드민과 자격 심사 흐름은 제외합니다.
사건 분석 기반 AI 변호사 순위·유료 우선 노출·플랫폼 내부 상담은 만들지 않습니다.
기존 심사 backend는 보존하며 이번 MVP UI에 노출하지 않습니다. role 선택을 자격 확인으로 표시하지 않습니다.

문서·이미지·음성·영상의 실제 처리와 coverage, private 원본/파생물/리포트의 삭제,
사용량·실제 비용 원장을 보존하고 비용 관측은 제품 실행·배포와 분리합니다. 세부 한도와 완료 기준은 [PRD](./docs/PRD.md),
[MVP](./docs/product/MVP-SPEC.md), [실제 UI 시연 행렬](./docs/product/UI-DEMONSTRATION.md)이 정본입니다.

기존 v1 사건·schemaVersion 1·분석 결과·읽기·삭제는 보존하고 사용자 승인 없이 재분석하지 않습니다.
마일스톤 6은 같은 client UI의 API mock 시연, 마일스톤 5는 고객/변호사 실제 기능 연결입니다.
외부 연동·운영 복구·최종 후보 검증·동일 SHA 배포 인수는 #71에 남깁니다.
정책 초안과 사업자 플레이스홀더는 #20/#70의 초안 인수 완료 범위이며 실제 법률 승인은 아닙니다.

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
| AI | AI Gateway Unified Billing Gemini 3.8 Flash, 생성 low·감사 medium, Cloudflare Whisper ASR |
| Legal source | 공식 법령·공식 판례·공식기관 안내의 검증된 원문 |
| Delivery | 최소 GitHub CI, 명령으로 요청하는 preview/production 수동 배포 |

2026-10-22 사용자 결정으로 모바일은 RN + Expo를 채택했습니다. 웹 UI 개편과 분리하여
[공통 코드 구조](./docs/architecture/MOBILE-CLIENT.md)와 [단계별 실행 계획](./docs/development/MOBILE-EXECUTION.md)을
따릅니다. `apps/mobile`의 Expo 기반·공통 계약/client를 인수했고, native 인증·동의/challenge와
고객 사건·질문/요약·작업공간을 연결합니다. 전체 네이티브 앱화는 [#334](https://github.com/creno-va/baro/issues/334)로 계속 추적합니다.
[모바일 개발 안내](./apps/mobile/README.md)에서 실행·검증 명령을 확인할 수 있습니다.
기존 계정을 보존하는 재인증과 자료 선택/업로드·검토/교정·원본 저장/공유·삭제를 연결합니다.
리포트 검토·사진/마스킹/제외·PDF/HTML/ZIP 저장/열기/공유를 연결합니다.
나머지 기능과 실제 제공자/기기·스토어 인수는 후속 단계입니다.

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

[공개 정책 초안](./docs/policies/)과 사업자 플레이스홀더는 합의한 초안 상태로 유지합니다.
초안 수용, 현재 공개 운영 허가, 독립 외부 검증과 실제 법률 승인을 각각 구분합니다.

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
bun run validate:quick           # 자동 CI와 같은 빠른 검사
bun run validate:changed         # origin/main 대비 커밋 + 로컬 수정의 관련 단위 검사
bun run validate:browser         # 필요한 브라우저·production CSP 검사
bun run validate:build           # production build·bundle·Worker dry-run
bun run validate:db              # DB 변경 때 drift·migration 검사
bun run validate:native          # 처리기 변경 때 Docker fixture 검사
bun run validate:security        # 의존성 audit·Gitleaks 전체 이력 검사
bun run validate:full            # 최종 후보 SHA의 수동 GitHub workflow에서 전체 검증

bun run deploy:preview           # 현재 원격 main을 수동 배포 요청
bun run deploy:production --sha <preview에서_검증한_full40sha>
bun run deploy:status            # 실행/승인 대기/실패 확인
```

검증 명령은 [테스트 전략](./docs/quality/TEST-STRATEGY.md), 배포 옵션·승인·준비 도구는
[배포 및 운영](./docs/operations/DEPLOYMENT-OPERATIONS.md)을 따른다.

DB 변경은 generation drift·fresh/upgrade 검증을 추가합니다. Container·R2·ASR 와 모든
역할의 실제 시연은 downstream 이슈의 검증이며 기존 offline 통과로 대체하지 않습니다.

## 기여·배포

`main`에 직접 push 하지 않습니다. 이슈의 범위/인수 조건과 작업 시작을 기록하고
깨끗한 main 에서 `codex/<issue>-<purpose>` 브랜치를 만듭니다. 다른 작업자는 별도
worktree를 사용합니다. PR 검사·실패 시나리오와 리뷰를 마친 뒤 권한 범위에서 병합합니다.
설정은 [repository setup](./.github/REPOSITORY-SETUP.md)을 따릅니다.

- PR/main CI는 빠른 검사만 자동 실행하며 병합이 배포를 시작하지 않습니다.
- preview/production 배포는 로컬 명령으로 GitHub 수동 workflow를 요청합니다.
- production은 성공한 CI·preview smoke의 같은 SHA와 #71의 운영자 승인 receipt를 요구합니다. 작성자는 hyunhomon 또는 hwangeunchan이며 최대24시간 유효합니다.
- 현재 공개 서비스는 유지합니다. 기존 정식 공개 checker의 미완료 정책·외부 조건은 그대로 검사하며 초안 인수를 법률 승인으로 바꾸지 않습니다.
- preview: <https://preview.baro.site>, production: <https://baro.site>.
- 환경별 DB·Workflow·R2·Container·OAuth·Gateway·키와 secret은 분리합니다.
- 전체 개발은 [마일스톤 5](https://github.com/creno-va/baro/milestone/5)에서 추적하고 실제 시연 증거로 판정합니다.

과거 제품·운영 기준은 [README 이력](./docs/development/README-HISTORY.md)에 보존합니다.

## 보안 문제

실제 사건·자료·개인정보·OAuth token·secret을 공개 이슈/PR/artifact에 올리지 않습니다.
민감 취약점은 저장소 [Security](https://github.com/creno-va/baro/security), 일반 오류는
비민감 request ID 와 재현 절차만 사용합니다.
