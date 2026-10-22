# BARO mobile — M2/M3 진행

Expo SDK 58 / React Native 0.88.0 / React 19.3.0 / Expo Router 기반 iOS·Android 앱이다.
현재 시작·이용 안내·공개 변호사 목록/이름 검색·잘못된 경로 화면을 제공한다. 공개 목록은
설정된 API를 실제 조회하며 화면에 예시 데이터를 대체 표시하지 않는다. 기존 3사 로그인·
고객/변호사 선택·필수 동의·내 계정·로그아웃을 native 화면으로 연결한다. 사건 저장은
M4에서 계속한다. 프로필 상세·기타 필터·직접 연락은 후속 기능 단계에서 계속한다.

## 개발

저장소 루트에서 `.bun-version`의 Bun과 이 폴더 `.node-version`의 Node를 사용한다.
workspace는 단일 `bun.lock`과 hoisted 설치를 사용한다. 개별 폴더에서 별도 lockfile을
만들지 않는다. 이전 isolated 설치가 남아 Expo doctor가 중복 native 모듈을 보고하면
해당 checkout의 root/app `node_modules`만 제거하고 `bun ci`로 재설치한다.

```sh
bun ci
bun run mobile:check
bun run mobile:bundle
bun run mobile:start
```

개발 클라이언트를 먼저 기기/시뮬레이터에 설치한다. Expo Go를 인수 기준으로 사용하지 않는다.
Android SDK·JDK 17이 있는 환경에서 `bun run --cwd apps/mobile android`, macOS의 Xcode와
CocoaPods가 있는 환경에서 `bun run --cwd apps/mobile ios`로 생성·컴파일·실행한다.
생성된 `android/`, `ios/`, `.expo/`, `dist/`는 Git에 추가하지 않는다.

## 공개 환경 설정

`apps/mobile/.env.example`을 참고해 필요한 공개 값만 `.env.local`에 설정한다.
`EXPO_PUBLIC_*`는 bundle에 노출된다. secret·토큰·사건 원문을 넣지 않는다.

| 환경 | EXPO_PUBLIC_APP_ENV | 기본 API | 앱 식별자 / scheme |
| --- | --- | --- | --- |
| 로컬 | local (기본) | http://127.0.0.1:4321 | site.baro.app.dev / baro-dev |
| Preview | preview | https://preview.baro.site | site.baro.app.preview / baro-preview |
| Production | production | https://baro.site | site.baro.app / baro |

`EXPO_PUBLIC_API_URL`은 preview/production에서 해당 origin만 허용한다. local에서는
loopback·사설 LAN 주소만 허용하며 Android emulator는 `http://10.0.2.2:4321`을 사용한다.
실기기는 개발 PC의 LAN 주소와 접근 가능한 로컬 서버가 필요하다. 목록 화면은 이 주소의
실제 API를 조회한다. 식별자는 스토어 등록 전 잠정값이며 OTA는 비활성화되어 있다.

## 소유 경계와 UI 변경

- `src/app`: Expo Router와 화면 조합.
- `src/features/foundation/model.ts`: 플랫폼과 화면에서 독립된 상태·공통 계약 소비.
- `src/features/foundation/ui`: props와 명령 callback을 받는 RN 화면.
- `src/ui`, `src/theme`: 기본 컴포넌트와 임시 시각 토큰. 웹 디자인 인계는 M7에서 반영.
- `src/composition`: 검증된 공개 설정·환경별 SecureStore와 HTTP adapter 조립.
- `src/platform/auth`: 기기 cookie 저장·고정 Origin·갱신/만료·세션 generation 격리.
- `@baro/contracts`: 기존 `src/contracts` 정본의 명시적 public export. 서버 pipeline 제외.
- `@baro/api-client`, `@baro/client-core`: 웹과 같은 HTTP/오류/DTO/계약. 플랫폼 cookie·저장은 adapter 소유.
- `src/features/directory`: 요청 취소·새 검색 우선·기존 페이지 보존·cursor 재시도의 순수 model과 RN 목록.

웹의 `src/pages`, `src/components`, `src/layouts`, `src/styles`, `src/client`는 이 작업에서
변경하지 않는다. 공유 package/lock/CI 변경은 기반 PR을 먼저 통합한다. 전체 단계는
[실행 계획](../../docs/development/MOBILE-EXECUTION.md)을 따른다.

## 인증 저장 경계

SecureStore는 환경별 keychain service/namespace와 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`를 사용한다.
고정 Better Auth Expo1.7.7의 공개 cookie codec/storage adapter를 공유하고 session cache를 권한으로
사용하지 않는다. native HTTP가 Cookie/Origin을 직접 설정하고 credentials omit·redirect error를
사용한다. 성공/실패 응답의 Set-Cookie를 한 경로에서 저장하며 SDK에 전달하는 응답에서는 제거해
중복 writer를 만들지 않는다. Expo native response의 원본 IO·clone을 보존하고 RN의 legacy
Response 생성자로 stream을 재구성하지 않는다. 로그인 연결에서는 `disableCache: true`와 `disableRedirect: true`를
사용해야 하며 SDK 자동 cookie callback 경로를 사용하지 않는다.

credential 교체/로그아웃은 `credentials.reset()`으로 scope를 먼저 폐기한 뒤 인증 cookie/cache만
지운다. 오래된 네트워크/기기 IO는 다음 jar에 쓸 수 없고, 저장 오류·readback 불일치 시 private
요청은 실패한다. reset이 실패하면 성공을 표시하지 않으며 재시도로 복구한다. 미해결 사건 작업
key 저장소는 별도이며 지우지 않는다. 공개 목록은 이 저장소와 독립된 익명 transport다.
`getNativeLogin`은 기기에 먼저 저장한 nonce/verifier·시스템 브라우저·고정 proxy·일회용 code
교환과 실제 owner/role 확인을 조립한다. callback에는 code/attemptId만 받고 foreign/중복/
extra cookie/token 필드를 거절한다. 응답 유실 시 code를 자동 재전송하지 않으며 새 서버
세션으로만 복구한다. `/session`의 역할/로그인·동의·내 계정 화면은 독립 model을 소비한다. `+native-intent`는
정확한 callback을 최대4개의 임시 handoff에만 담고 query/fragment를 router로 넘기지 않는다.
foreground에서는 실제 세션을 다시 확인하고 background/로그아웃/변경에서 개인 요청을
폐기한다. 시스템 브라우저 인증 중에는 이미 폐기한 개인 IO와 현재 인증 교환을 구분한다.
로그아웃은 저장된 cookie를 먼저 제거한 뒤 캡처한 원래 세션만 서버에서 폐기하며 늦은
응답 cookie를 받지 않는다. 원격 폐기/로컬 저장 실패는 구분한다. reauth와 실제 제공자/기기
검증은 #346의 후속 단계다.

`mobileSecurityToken(signal)`은 새 사건 생성의 공통 challenge port다. 별도 Hono HTML
`/api/mobile/challenge`만 WebView로 열고 auth cookie·사건 입력을 전달하지 않는다. 시도별
32바이트 비밀값은 native 주입 뒤 메시지에서 대조하고 URL/초안/로그에 저장하지 않는다.
요청 취소·계정 scope 폐기·120초 만료 시 위젯을 닫는다. 허용 URL 밖 이동은 차단하며
라이브러리의 자동 외부 브라우저 열기를 피하도록 모든 URL을 자체 guard에 전달한다.
실제 서버 siteverify를 그대로 사용한다. 고객 사건 화면에서 이 port를 소비하는 작업은 M4다.

## 검증

`mobile:check`는 계약·앱·설정·테스트 타입, import 경계, 계약/환경 실패 시나리오와 RN
컴포넌트 동작과 공통 client/계정 generation·검색 취소/페이지 회귀를 검사한다. RN Jest 테스트는
`tests/*.ui.tsx`에 두어 root Bun 테스트와 분리한다.
`mobile:bundle`은 두 OS의 실제 Metro/Hermes bundle을 만든다. `bunx expo-doctor`는 이
폴더에서 실행한다. 기존 웹 회귀는 루트 `validate:quick`, `validate:build`로 확인한다.

수동 GitHub workflow `Mobile native builds (manual)`는 정확한 main SHA를 받아 preview
설정으로 Android debug APK와 iOS simulator Debug 앱을 컴파일한다. Android는 기본 debug
키를 사용하며 스토어 서명·업로드·배포를 하지 않는다. 성공 시 platform/SHA를 포함하는
receipt를 artifact로 남긴다. 로컬에서도 다음 명령으로 같은 컴파일을 실행할 수 있다.

```sh
EXPO_PUBLIC_APP_ENV=preview bun run mobile:native android
EXPO_PUBLIC_APP_ENV=preview bun run mobile:native ios
```

타입/단위 테스트, Metro 번들, native 컴파일, 실제 기기 실행은 각각 다른 검증이다.
M1의 실제 결과와 미완료 native 항목은 [#330](https://github.com/creno-va/baro/issues/330)에
기록한다. 실제 OAuth·기기 키보드/접근성·서명·스토어 인수는 완료로 간주하지 않는다.
