# ADR-0002: 웹 스택과 Cloudflare 런타임

- Status: Accepted
- Date: 2026-10-04
- Owners: Engineering
- Related: [ADR-0001](./0001-mvp-system-boundaries-and-ai-pipeline.md)
- Partial supersession (2026-10-06): 격리 processor 런타임만 [ADR-0009](./0009-isolated-container-file-processing.md), UI 시스템은 [ADR-0012](./0012-shared-ui-system-and-brand-assets.md)를 따른다. web/API의 Workers 스택은 유지한다.

## 맥락

MVP는 작은 팀이 하나의 웹 제품으로 빠르게 배포하고 관측할 수 있어야 한다. 사용자
화면에는 정적 콘텐츠와 상호작용이 섞이고, 인증·API·장기 AI 분석은 서버 런타임이
필요하다. OAuth 콜백은 안정된 도메인을 요구하며 애플리케이션과 API의 배포 경계를
불필요하게 나누고 싶지 않다.

## 결정

1. 패키지 관리, 스크립트, 테스트의 표준 도구는 Bun이다.
2. 애플리케이션은 Astro 7과 필요한 부분의 React islands로 만든다.
3. API는 Astro의 `astro/hono` 통합과 Hono로 구성한다.
4. UI 스타일은 Tailwind CSS를 사용한다.
5. 요청·응답 계약은 Zod로 정의하고 Hono RPC 타입으로 클라이언트에 공유한다.
6. Astro와 Hono는 하나의 Cloudflare Worker로 배포한다.
7. 영속 데이터는 Cloudflare D1, ORM과 마이그레이션은 Drizzle을 사용한다.
8. 다단계·재시작 가능한 AI 작업은 Cloudflare Workflows로 실행한다.
9. 환경은 local, 고정 preview, production 세 가지다. preview는 OAuth 콜백 안정성을
   위해 PR별 임시 도메인이 아닌 고정 도메인을 쓴다.
10. GitHub Actions가 검사, 마이그레이션 검증, preview와 production 배포를 수행한다.

Bun은 개발 도구 체인이다. Worker에서 실행되는 제품 코드는 `workerd` Web API와
Cloudflare binding만 사용하며 `Bun.*`, Node 전용 파일시스템·프로세스 API에
의존하지 않는다.

## 고려한 대안

- 프론트엔드와 API 별도 배포: 독립 확장 이점보다 인증·CORS·관측 복잡도가 크다.
- Node 서버: 익숙하지만 채택한 Cloudflare 단일 런타임과 맞지 않는다.
- Next.js: 가능하지만 콘텐츠 중심 화면과 제한적 islands 요구에 Astro가 더 작다.
- Prisma 또는 원격 PostgreSQL: MVP의 운영 면적과 비용이 증가한다.

## 결과

- 하나의 배포와 도메인으로 UI, 인증, API를 운영한다.
- Worker 호환성을 CI에서 별도 검사해야 한다.
- D1의 SQLite 제약과 Workflow 한도를 설계에 반영한다.
- Hono RPC 타입은 저장소 내부 계약이며 외부 공개 SDK 호환성은 보장하지 않는다.

## 참고

- [Astro Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Astro Hono reference](https://docs.astro.build/en/reference/modules/astro-hono/)
- [Hono Web Standards](https://hono.dev/docs/concepts/web-standard/)
- [Drizzle with D1](https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit)
