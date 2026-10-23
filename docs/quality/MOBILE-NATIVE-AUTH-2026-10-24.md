# 모바일 native OAuth 진입 준비 관측

2026-10-24 KST, #346의 실제 계정 로그인 전 선행을 확인했다. [고정 필드 관측](./mobile-native-auth-2026-10-24/preview-start.json)은
2026-10-23T20:15:04.942Z에 시작한 단일 실행 결과다. 도구 기준 main은
`5b895b2af4ed63c225c4837fc6e9045206bfbfb0`이며 [CI40016427571](https://github.com/creno-va/baro/actions/runs/40016427571)이 성공했다.
실제 preview `/api/health/live`는200·preview·baro·ok와 API
`f91244151c94d871423e9f2fe6fda5a70bf0e668`을 반환했다.
native bridge 도입 `a1ad098288037f62ea0356a08d91d74f9b1ceb64`가 그 API SHA의 ancestor임을
확인했고, API SHA와 도구 기준 main 사이 `src/server/auth`,
`src/server/api/mobile-auth.ts`, `src/contracts/mobile-auth.ts`의 차이는 없었다.
과거 preview57121d2의 bridge 부재 기록은 당시 사실로 보존하며 현재 blocker로 사용하지 않는다.

## 방법과 결과

로컬 Node fetch에서 기존 계정 cookie 없이 Google·Naver·Kakao별 새 UUID/PKCE challenge로
`POST /api/auth/sign-in/social`을 각각1회 요청했다. 앱의 canonical HTTPS Origin,
`expo-origin: baro-preview://`, `x-skip-oauth-proxy: true`,
`disableRedirect: true`와 `baro-preview://auth/callback`의 attemptId/challenge 및
동일 오류 callback을 사용했다. 응답을 자동 추적하지 않았고 재시도하지 않았다.

| 제공자 | 로그인 시작 | authorization 검증 | 브라우저 프록시 | 브라우저 state |
| --- | --- | --- | --- | --- |
| Google | 200 | 통과 | 302·동일 목적지 | 설정 |
| Naver | 200 | 통과 | 302·동일 목적지 | 설정 |
| Kakao | 200 | 통과 | 302·동일 목적지 | 설정 |

`authorizationValid`는 기존 제공자별 정확한 HTTPS origin/path, 자격 증명/hash 부재,
단일 state의 존재 및 단일 redirect_uri가 preview의 해당 `/api/auth/callback/<provider>`와
일치함을 뜻한다. client ID의 유효성이나 제공자 설정 수용을 뜻하지 않는다.

세 시작 응답 모두 `better-auth.oauth_state`/`__Secure-better-auth.oauth_state` cookie는 없었다.
설치된 `@better-auth/expo`1.7.7 서버 구현의 state fallback에 따라 `oauthState` 없이
`GET /api/auth/expo-authorization-proxy`를 각각1회 요청했고, 제공자 authorization URL과
완전히 같은 Location 및 브라우저용 state Set-Cookie 존재를 확인했다. 이는 현재 서버의
정상 fallback 분기 관측이며 native cookie 저장이나 서명 cookie의 실제 callback 검증 증거는 아니다.

URL·cookie·state·client ID/key·PKCE verifier/challenge·시도 UUID·raw body/header는
메모리에서만 대조했고 출력/저장하지 않았다. 저장 결과는 위 고정 상태/boolean뿐이다.
기존 OAuth 임시 state는 정상 만료 정책에 맡기며 직접 삭제하지 않았다.

## 인수 경계와 다음 작업

이 실행은 로컬 HTTP transport가 현재 preview의 native 로그인 시작/브라우저 상태 설정 경로를
통과한 사실만 인수한다. 제공자 페이지 GET, 계정 선택/로그인/추가 인증/동의, callback,
one-use code 교환, SecureStore 갱신, cold/warm 앱 복귀 및 실제 역할·동의·challenge는 수행하지 않았다.
두 OS 앱/물리 기기 실행 증거로 사용하지 않는다. 웹 UI·앱·서버·공통 계약·배포는 변경하지 않았다.

테스트 계정의 제공자와 사용자의 로그인/추가 인증 진행이 정해지면, 전달한 두 OS preview 앱으로
시스템 브라우저 로그인·취소·cold/warm 복귀를 먼저 검증한다. 이후 같은 계정의 fresh session,
역할·필수 동의·실제 Turnstile 및 private 기능 여정으로 이어간다. 계정 식별자·token과
raw 화면/URL을 증거로 내보내지 않는다. #346/#334와 전체 기기/보안/릴리스 #339/#71은 OPEN이다.
