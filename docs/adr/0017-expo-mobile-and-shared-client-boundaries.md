# ADR-0017: Expo 모바일 앱과 공통 클라이언트 경계

- Status: Accepted
- Date: 2026-10-22
- Owners: Mobile, Web UI, Authentication, API
- Decision scope: 사용자가 RN + Expo 및 모바일 개발 준비를 승인했다. 이번 산출물은 구조·실행 계획이며 앱 구현·실기기·외부 로그인·배포 완료를 뜻하지 않는다.
- Partial supersession: ADR-0002의 웹 단일 클라이언트에 RN 모바일 클라이언트를 추가하고, ADR-0012의 UI 공유 범위를 플랫폼별 컴포넌트와 공통 디자인 토큰으로 확장한다. ADR-0015의 신규 확장 중단에는 이 직접 요청의 모바일 준비·후속 구현 범위만 예외를 둔다. 웹/API Workers, 기존 제품·보안·비용 관측 정책은 유지한다.

## 맥락

웹 UI 전면 개편은 다른 채팅에서 진행 중이다. 모바일은 기존 고객·변호사 기능을
iOS/Android에서 사용할 수 있도록 개발하고, 이후 디자인 변경이 통신·인증·사건 로직의
재구현으로 이어지지 않아야 한다. 현재 `src/client/api`에는 순수 변환과 함께 DOM,
sessionStorage, browser File/Blob, same-origin cookie 의존성이 있어 통째로 공유할 수 없다.

## 결정

1. 모바일은 React Native + Expo + TypeScript + Expo Router를 사용한다. Expo development
   build를 기준으로 하며 SDK에 맞는 RN/React 버전은 기반 구현 시 호환 검증 후 고정한다.
2. 기존 웹/API는 루트 `src/`에 유지한다. Bun workspace에 `apps/mobile`, `packages/*`,
   `src/contracts`를 점진적으로 추가한다. 웹을 `apps/web`으로 옮기는 작업은 포함하지 않는다.
3. 공유 wire 계약의 정본은 계속 `src/contracts`다. 이 디렉터리를 `@baro/contracts`
   workspace package로 노출하고 공개 클라이언트용 export를 명시한다. 계약 사본은 만들지 않는다.
4. `@baro/api-client`는 HTTP 계약·응답 검증, `@baro/client-core`는 플랫폼 독립 상태·변환,
   `@baro/design-tokens`는 시각 토큰을 담당한다. React·DOM·Expo·Workers binding을
   공통 클라이언트 패키지의 필수 의존성으로 넣지 않는다. 서버 권한 판정은 서버에 남긴다.
5. 모바일 route → feature model/controller → 공통 client → 플랫폼 adapter로 책임을 나눈다.
   화면은 props/명령으로 동작하며 fetch·세션 저장·파일 IO·서버 권한 로직을 직접 갖지 않는다.
6. 웹 shadcn/HTML 컴포넌트와 모바일 RN 컴포넌트는 각각 구현한다. 토큰·상태 의미·브랜드
   원본을 공유하되 navigation·접근성·키보드·파일 선택은 각 플랫폼에 맞춘다.
7. 인증·동의·역할·Origin/CSRF·Turnstile을 첫 실연결 검증으로 삼는다. 앱 추가를 이유로
   기존 보호를 끄지 않는다. 인증 plugin 도입만으로 기존 모든 API가 모바일 대응됐다고 보지 않는다.
8. 앱과 서버는 독립 배포하므로 출시한 앱 버전과 API의 호환표를 유지한다. 기존 웹의
   동일 SHA preview/production 인수는 유지하고 모바일 build·대상 서버 SHA를 별도 기록한다.

## 고려한 대안

- Capacitor: 웹 UI 재사용에는 유리하지만 사용자가 RN을 선택했으며 별도 모바일 UX를 개발한다.
- Flutter: 가능하지만 기존 TypeScript 계약·클라이언트 로직 공유 이점을 줄인다.
- 모든 웹을 React Native Web으로 전환: 진행 중인 웹 개편 및 Worker 배포 경로의 변경 범위를 늘린다.
- 웹/API 전체 이동과 모노레포 도구 일괄 도입: 초기 앱 연결에 필요하지 않다. Bun workspace부터 시작한다.
- 기존 browser client 직접 import: 인증·파일·DOM 의존성이 모바일로 전파되므로 adapter 추출을 선행한다.

## 결과

웹 UI와 모바일 UI를 독립적으로 바꿀 수 있고 계약은 한 곳에 유지한다. 대신 native 인증,
파일·앱 수명과 웹/모바일 양쪽의 회귀 검증이 추가된다. 공유 패키지 전환 PR은 웹 담당과
경로 소유권을 정한 뒤 순서대로 병합한다. 초기 기능은 기본 RN UI로 검증하며 최종 시각
디자인 인수는 후속 단계다. 외부 키가 없어도 합성 구현·PR은 진행할 수 있다.

## 후속 및 미결 사항

[구조 명세](../architecture/MOBILE-CLIENT.md)와 [실행 계획](../development/MOBILE-EXECUTION.md)이
추출 순서·단계별 인수를 정의한다. OAuth 제공자별 실기기 복귀, mutation 인증 전달,
Turnstile, 대용량 업로드, iOS 로그인 심사 요구, 앱 식별자·서명·배포 계정은 실제 확인이
남아 있다. 새 로그인 공급자가 필요하면 기존 공급자 변경 경계에 따라 별도 결정한다.
이 미결 사항으로 독립적인 계약·합성 화면 작업을 막지 않는다.

## 참고

- [React Native 시작](https://reactnative.dev/docs/environment-setup)
- [Expo monorepos](https://docs.expo.dev/guides/monorepos/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
