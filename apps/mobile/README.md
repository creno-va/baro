# BARO mobile — M5 자료 연결

Expo SDK 58 / React Native 0.88.0 / React 19.3.0 / Expo Router 기반 iOS·Android 앱이다.
현재 시작·이용 안내·공개 변호사 목록/이름 검색·잘못된 경로 화면을 제공한다. 공개 목록은
설정된 API를 실제 조회하며 화면에 예시 데이터를 대체 표시하지 않는다. 기존 3사 로그인·
고객/변호사 선택·필수 동의·내 계정·로그아웃과 고객 사건/질문/요약·작업공간을 native 화면으로
연결한다. v1 저장 분석의 읽기와 v1/v2 사건 삭제를 제공하며 프로필 상세·기타 필터·직접 연락은
후속으로 계속한다. 실제 제공자/기기 인수는 구현과 별개다.

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
- `getMobileApi().lawyers`: 공통 프로필 JSON client. 공개 조회는 익명 transport, 본인 저장/공개 전환은 native credential transport를 사용. 파일 선택/캐시/공유는 M5/M6에서 source/upload/download port에 연결.
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
실제 서버 siteverify를 그대로 사용한다. 고객 사건 생성이 이 port를 소비하며 실제 위젯/기기
인수는 합성 fixture와 구분한다.

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

## 고객 사건 연결

`/cases`는 fresh 고객 세션·동의 gate 아래 사건 목록/생성·서버 저장분 재개·차례별 질문·
모름/건너뛰기·요약 text/사실 수정·확인을 제공한다. 처리 중인 작업만 활성 화면에서 조회한다.
서버 revision 충돌은 미저장 입력을 보존하고 명시적인 최신 내용 사용으로 해결한다.
다른 화면으로 이동하거나 앱을 종료하면 미저장 입력은 사라진다. v1은 저장된 분석의
사용자 진술/AI 정리/미확인·타임라인·쟁점/한계·자료·다음 단계·당시 출처와 범위/긴급 안내·
불완전/실패를 읽으며 자동 재분석하지 않는다. 자료는 `/files`에서 관리하며 리포트 화면은 M5 잔여다.

불확실 mutation key와 owner/revision metadata는 `.case-operations` SecureStore service에
별도로 보관한다. 물리 key는 fingerprint이며 UUID/허용 metadata 이외의 값·잠김·손상·
silent write는 실패한다. 인증 reset에서 지우지 않으며 사실/답변/보안 token은 저장하지 않는다.

공통 `createWorkspaceClient`의 native `recovery` port는 같은 저장소의 fingerprint/UUID
형식을 사용한다. `onAcknowledged`와 화면 재조회 완료를 구분하고, `includeActionRevisions`와
원래 action revision으로 편집 재시도를 묶는다. job 저장은 opaque hint이며 실제 서버 job이
정본이다. `/workspace?caseId=<opaque ID>`는 같은 fresh 고객 gate 아래 대화·검증 실패/
명시적 재시도·사실/모순/근거·타임라인 편집·다음 행동 체크와 기록 추가 조회를 연결한다.
자료는 공통 metadata reader로 이름/상태를 읽고 준비된 자료를 대화에 선택한다. 추가·검토·
원본 저장은 `/files`로 연결한다. 새 요약은 `/cases` 검토·확인으로 이어진다.
응답 유실 때 입력과 원래 revision을 메모리에 보존하며 명시적인 같은 요청 재시도만
허용한다. 확정 ACK 뒤 조회 실패는 해당 입력을 비우고 최신 조회를 제공한다. background/
blur에서 IO·poll을 중단한다. background 대기는 같은 fresh owner만 입력을 복원하며,
세션 구독이 끝나는 화면 이탈에서는 입력을 버려 이탈 중 로그아웃 뒤 되살리지 않는다.
실제 기기 인수는 별도다.

v1/v2 사건 삭제는 `DELETE` 직접 입력 후 공통 case-deletion client로 보낸다. 빈 본문·원래
opaque UUID를 필수 저장/readback하고 응답 유실·feature 재생성에도 같은 key로 확인한다.
확정 ACK에서 선택 사건·분석/입력을 비우고 scope를 폐기한 뒤 fresh 세션/목록을 읽는다.
후속 조회나 key cleanup 실패로 이미 접수한 삭제를 다시 새 작업으로 보내지 않는다.
물리 자료 정리 완료를 접수와 혼동하지 않으며 미정산 원장/hold와 다른 미해결 작업 key를
지우지 않는다. 계정 탈퇴는 이 사건 삭제와 별개인 M6 잔여다.

## 같은 계정 재인증

계정 화면의 `재인증 로그인 수단 확인`은 실제 연결된 provider를 읽는다. 동의 전에도
사용할 수 있으며 재인증은 기존 cookie·역할을 보존한다. 서버 준비 receipt를 nonce/PKCE와
SecureStore에 저장한 뒤 외부 브라우저를 열고, 복귀 시 정확한 새 OAuth 세션의 proof를
검증한다. 응답 유실·cold 복귀·marker 쓰기 실패도 이 proof 없이 성공으로 처리하지 않는다.
취소는 기존 로그인을 유지하고 로그아웃은 인증 cookie/pending/marker를 지운다. 미해결
사건 작업 key는 보존한다. 기기 marker만으로 계정 삭제 권한을 부여하지 않으며 서버의
fresh access가 정본이다. 합성 제공자·SQL/HTTP·RN 검증과 실제 두 OS OAuth 인수는 별개다.

## 파일 IO 기반 (M5 진행)

`getNativeUploadSources()`는 OS document picker와 전용 private cache snapshot을 제공한다.
선택 객체의 name/size/type 뒤 실제 URI는 숨긴다. `openUpload`는256KiB 이하 범위 읽기와
incremental SHA256으로 서버8MiB part를 검증한다. reader close 뒤에도 명시적 재시도에 쓸
snapshot은 유지되며 소유 화면은 완료/취소/이탈 때 `release`, 계정 전환/다음 시작 때
`clear`를 연결해야 한다. clear는 열려 있는 reader부터 닫고 삭제 실패를 재시도 대상으로
보존한다. 인증 key나 `.case-operations`를 지우지 않는다. 로컬 합성100MB/1GB byte/hash
검사는 통과했으며 native 기기 IO·선택 권한/공간 부족·전체 메모리 인수는 별도다.
`/files?caseId=<opaque ID>`는 이 adapter로 선택·진행·유실 복구·명시적 충돌 재시작을 연결한다.
공통 files client에는 opt-in `recovery`가 있으며 `.case-operations`는 예약/완료 UUID·원래
revision·file ID·입력 hash만 필수 저장한다. token·manifest·파일 이름/원문을 저장하지 않는다.
완료 응답 유실 뒤 같은 서버 file ID로 확인하고 ordinary retry에서 CAS를 바꾸지 않는다.
확인된 충돌/만료/정확한404 뒤 사용자의 명시적 재시작에만 `resolveConflict: true`를 전달한다.
완료 ACK와 후속 목록 조회를 구분해 접수한 파일을 새 업로드로 재전송하지 않는다.
로컬 합성 디스크 검사는 루트에서 `bun scripts/mobile-file-io-probe.ts --large`로 재현한다.
기본은100MB이며 `--large`는100MB와1GB를 순차 생성/검사한 뒤 임시 파일을 지운다.
출력은 byte 수·일치/메모리 관측·handle 수치뿐이며 실제 사용자 자료를 읽지 않는다.

## 자료 화면·원본 다운로드

자료 화면은 실제 files client·sealed credential/owner/generation transport를 사용한다.
기존 자료는 동의 갱신 전에도 조회/원본 저장/삭제할 수 있고 추가·처리·교정은 최신 동의가
필요하다. 서버 처리 중 상태만 활성 화면에서 갱신하며 명시적 처리 재시도를 제공한다.
문서 페이지·영상 표본·음성 구간의 coverage는100개씩 교체 표시하고 관찰의 원본/교정·
불확실성/제외·위치를 구분한다. 한 관찰씩 원래 file/workspace revision으로 저장하며 서버의
미완료 교정은 이어서 저장/남은 교정 중단으로 처리한다. 삭제는 DELETE 확인을 요구한다.

원본은 `expo/fetch`의 redirect:error/credentials:omit과 기존 cookie writer를 거쳐 받는다.
응답 body를 앱 전용 무작위 경로에256KiB 이하 write로 순차 기록하며 전체 binary의
arrayBuffer/blob/base64 변환을 하지 않는다. 길이·실제 디스크 크기와 네트워크/디스크 재읽기의
증분 SHA256을 대조해 같은 길이의 저장 손상도 공개 전에 거절한다.
파일 URI는 adapter 내부에만 두고 화면은 opaque handle로 명시적 File.preview/Expo Sharing을
호출한다. 외부 앱에 전달한 복사본은 서버 삭제로 회수하지 못한다. 취소/이탈·startup·
로그아웃/계정·역할·동의 변경에서 private cache를 정리하고 IO/presentation 완료를 기다린다.
background checking은 신원을 숨기고 fresh 같은 계정만 source를 복원한다. native handoff는
외부 앱이 읽는 동안 유지한 뒤 앱 복귀 시 handle을 폐기하며 실패한 삭제는 재시도한다.
root의 캐시 정리 실패는 파일 기능에서 재시도하고 공개 탐색/로그인을 막지 않는다.

합성 Hono/SQL/AES·바이트/컴포넌트 검증과 실제 기기의 선택 권한·외부 앱·저장 공간·native
SDK 메모리 검증은 구분한다. 리포트 편집/사진 선택/PDF·HTML·ZIP 화면은 M5 후속이다.
