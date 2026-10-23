# BARO mobile — M5 자료·리포트 연결

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
- `src/ui`, `src/theme`: 웹 정본의 @baro/design-tokens를 소비하는 native primitive. 밀도·48dp target·type scale은 native adapter가 소유하며 폰트/실제 기기 시각 인수는 M7에서 이어 간다.
- `src/composition`: 검증된 공개 설정·환경별 SecureStore와 HTTP adapter 조립.
- `src/platform/auth`: 기기 cookie 저장·고정 Origin·갱신/만료·세션 generation 격리.
- `@baro/contracts`: 기존 `src/contracts` 정본의 명시적 public export. 서버 pipeline 제외.
- `@baro/api-client`, `@baro/client-core`: 웹과 같은 HTTP/오류/DTO/계약. 플랫폼 cookie·저장은 adapter 소유.
- `getMobileApi().lawyers`: 공통 프로필 JSON client. 공개 조회는 익명 transport, 본인 저장/공개 전환은 native credential transport를 사용. `/profile`의 본인 편집·공개/철회·자산 업로드/비공개 미리보기/참조 해제·삭제는 공통 client와 native IO port로 연결. 아래 프로필 경계를 따른다.
- `src/features/directory`: 요청 취소·새 검색 우선·기존 페이지 보존·cursor 재시도의 순수 model과 RN 목록.
- `src/features/settings`: 두 역할의 서버 사용량·정책·같은 계정 재인증·literal 삭제와 미확정/접수/로컬 정리 상태. `/session`에서 진입한다.

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
불완전/실패를 읽으며 자동 재분석하지 않는다. 자료는 `/files`에서 관리하며
리포트는 `/reports`에서 검토·저장·다운로드한다.

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
지우지 않는다. 계정 탈퇴는 이 사건 삭제와 별개이며 설정 화면의 fresh reauth·literal 확인 경로를 따른다.

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

원본과 PDF/HTML/ZIP은 captured cookie frame·Origin/owner/epoch를 native disk lease에
연결한다. 원본은 공통 client의 fetch 전 포트를 사용해 JS HTTP body/byte-event queue를
만들지 않는다. native 파일을 앱 소유 무작위 경로로 이동한 뒤 고정 SDK의 별도 SHA256
streaming API(read64KiB)와 실제 크기로 다시 검증한다. 파일 크기는 기존 기술 상한을
유지하며 큰 binary의 arrayBuffer/blob/base64 변환이나 SDK-byte fallback을 사용하지 않는다.
리포트 signature·HTML marker/최대30MB text 검증도 기존 공통 client에서 수행한다.
파일 URI는 adapter 내부에만 두고 화면은 opaque handle로 명시적 File.preview/Expo Sharing을
호출한다. 외부 앱에 전달한 복사본은 서버 삭제로 회수하지 못한다. 취소/이탈·startup·
로그아웃/계정·역할·동의 변경에서 private cache를 정리하고 IO/presentation 완료를 기다린다.
background checking은 신원을 숨기고 fresh 같은 계정만 source를 복원한다. native handoff는
외부 앱이 읽는 동안 유지한 뒤 앱 복귀 시 handle을 폐기하며 실패한 삭제는 재시도한다.
root의 캐시 정리 실패는 파일 기능에서 재시도하고 공개 탐색/로그인을 막지 않는다.

합성 Hono/SQL/AES·바이트/컴포넌트 검증과 실제 기기의 선택 권한·외부 앱·저장 공간·native
SDK/IPC 메모리 검증은 구분한다. 리포트 편집/사진 선택/PDF·HTML·ZIP 연결은 아래를 따른다.

## 리포트 검토·다운로드

`/reports?caseId=<opaque ID>`는 fresh 고객 세션에서 저장 본문·출처/기준 버전, 자료 제외·
사진 선택·자동 가림을 편집한다. 본문 편집과 제외 변경이 겹치면 본문을 원래 revision으로
먼저 저장하고, 남은 제외를 다음 저장에서 적용해 재구성된 본문을 다시 확인한다. 충돌/응답
유실 시 입력을 유지하고 자동 재전송하지 않는다. 저장 상태 다시 읽기/새 초안 교체는 확인을
거친다. 초기 GET 기술 한도 시 직접 자료를 제외하고 null absence CAS로 첫 초안을 요청한다.

저장된 내용을 확인한 뒤 PDF/HTML을 private cache에 저장하고 OS 열기·공유를 명시적으로
선택한다. 선택 원본 ZIP은 별도의 가림 없는 원본 전달 확인이 필요하며 마스킹은 원본을
가리지 않는다. 사진은 native 원본 열기로 확인하고 최대12개/서버 실제 한도로 선택한다.
동의 갱신이 필요해도 저장 HTML/이미 만들어진 PDF/ZIP을 읽으며 새 생성·저장·패키지는
최신 동의가 필요하다. 잠시 background로 가면 화면을 숨기며 같은 계정·권한과 서버 저장
버전을 다시 확인한 뒤 현재 화면의 메모리 편집을 복원한다. 버전이 바뀌면 입력을 보존하고
충돌로 안내한다. 로그아웃·계정/권한 변경·화면 이탈·앱 종료에서는 미저장 초안을 버린다.
private 경로/token은 화면이나 URL에 노출하지 않는다. 실제 공유·기기 메모리/권한과 API
호환 배포는 fixture/Metro/컴파일과 별도로 #361/#334에서 인수한다.

## 사용량·설정과 계정 삭제

`/settings`는 fresh 계정의 실제 기술 한도·예약 사용량·KST 일일 초기화와 정책 문서를
표시한다. 저장 공간은 일일 초기화 대상이 아니다. 동의 갱신 중에도 기존 정책 확인과
인증된 계정 삭제는 가능하다. 연결된 provider로 같은 계정을 재인증하고 `DELETE`를
직접 입력해야 삭제한다. 미확정 요청은 새 서버 OAuth 시각과 별도 명시적 재확인을
요구하며 자동 전송하지 않는다. 401/익명 상태만으로 삭제 성공을 만들지 않는다.

검증된 ACK와 기기의 파일/credential 정리를 구분한다. 실제 NativeLogin cancel/reset은
cookie/cache·재인증 proof·대기 로그인만 정리하며 다른 미해결 작업 key는 보존한다.
파일 정리 실패도 credential 정리 시도를 건너뛰지 않고, 새 auth generation이 시작되면
그 계정의 저장소를 지우지 않는다. 잠시 화면을 떠난 뒤에도 관측한 접수/정리 결과를
구분하고 새 계정에서는 이전 상태를 숨긴다. 실제 기기의 Keychain/Keystore·OAuth와
서버 삭제 job·스토어/릴리스 인수는 합성 RN/HTTP/SQL 검증과 별개다.

## 대용량 native 네트워크 IO

`modules/baro-private-download`는 네트워크 응답을 JS byte-event queue 대신 native private
디스크로 받는 로컬 Expo 모듈이다. PR370의 exact 두 OS compile/main 통합과 공통 원본
포트 PR374 뒤 composition에서 소비한다. 단순 JS write 상한으로 네트워크 큐 메모리를
입증하지 않으며 지원 파일 크기를 줄여 대체하지 않는다. reset은 native 전송·파일 이동/검증
종료 뒤 cache를 정리하며, 모듈이 없으면 startup orphan 정리 후 최신 개발 앱 설치를 안내한다.

`bun run mobile:native:probe`는 macOS의 Swift 코어로 실제 local HTTP 100MB/1GB와 독립
해시·RSS·취소·리다이렉트/쿠키 격리·gzip·오류/시작 정리를 검사한다. Android 코어 JUnit은
native-module PR workflow에서 128MiB JVM 힙으로 같은 바이트를 검사한다. 이 workflow는
모듈/해당 fixture 변경 PR에만 두 OS 앱을 컴파일한다. [모듈 안내](./modules/baro-private-download/README.md)의
borrowed fileId·cancel/release/clear 계약을 따른다. 메인 앱/두 OS 기기·API 메모리와 실제
provider 시연, 서명·스토어 인수는 별개다.


## 본인 변호사 프로필

변호사 계정의 내 계정 → 내 변호사 프로필 관리에서 소개·사무소·연락처·지역/분야·
사진·글/링크/파일 포트폴리오를 편집한다. 저장과 공개/철회는 별도 동작이다. 공개에는
저장 완료·필수 입력·노출 항목 동의와 명시적 확인이 필요하며 역할 선택은 자격 확인이 아니다.

파일 선택은 SDK cache의 불변 스냅샷을 소유하며 native PUT에는 생성 UUID basename·크기·
SHA-256만 전달한다. 선택 파일의 JS 전체 body/SDK fetch fallback은 없다. source lease는
native 취소/종료를 기다린 뒤 삭제한다. 작은 JSON 응답도 owned cache에 옮겨 독립 hash를
검사한 뒤 읽고 지운다. 구형 개발 앱은 최신 개발 앱 설치 안내로 실패한다.

업로드 완료와 처리 완료를 구분한다. `ready` 자료만 연결/비공개 열기·공유할 수 있고,
연결 후 프로필 저장이 필요하다. 현재 저장본·입력에서 참조한 자료는 참조 해제와 저장 후
literal `DELETE`로 삭제한다. 삭제 접수와 원격 purge 완료는 구분한다.

저장/공개/삭제 ACK 유실은 자동 재전송하지 않는다. 화면 메모리의 원래 body/revision을
보존하고 새 조회로 결과를 확인하거나 사용자가 같은 요청을 직접 확인한다. 앱/화면 재시작은
현재 서버 값을 읽으며 미확정 업로드 key/revision은 환경별 SecureStore에 보존한다.
프로필 본문·파일명·기기 URI는 그 복구 레코드에 저장하지 않는다. 세션 확인 중에는 private
입력을 숨기고 같은 소유자의 fresh 세션에만 복구한다. 다른 계정/역할·접근 거부·route 이탈은
본문·handle을 버린다. picker의 일시 background 복귀는 fresh 같은 소유자를 기다리며 자동
업로드하지 않는다. 동의 갱신 중에는 기존 프로필/ready 자료 읽기만 유지한다.

`mobile:check`는 순수 모델·captured native transport/Hono/SQLite·RN 화면·합성 SDK composition을
검사한다. native core/compile 증거와 실제 앱 IPC·두 OS 기기/API·스토어 인수는 구분한다.


## 공통 시각 표현

`theme/tokens`는 @baro/design-tokens의 product blue/ink/subtle/line·surface/status·20dp card
의미를 소비한다. 화면 바탕은 subtle이며 밀도·type scale·최소48dp 조작 영역은 native에서
정한다. 좁은 화면은16dp, 일반20dp, 태블릿32dp 좌우 여백과 최대720dp 읽기 열을 사용한다.

Button 기본은 보조 행동이며 primary/secondary/danger로 저장·검색·계속/삭제의 위계를
표시한다. disabled/pressed에서 label opacity를 낮추지 않고 대비를 유지한다. Choice는
체크/선택 symbol·완전한 label·checked/disabled 상태를 함께 제공한다. 입력의 유일한
경계는 장식 구분선보다 진하게 표시하고 focus border·multiline 상단 정렬·readonly 상태를
보존한다. Text/TextField 기본은 OS 글자 확대를 허용하고 최대 배율/줄 수/높이를 제한하지
않는다. Card와 조작 영역도 고정 높이를 두지 않는다.

Screen은 Stack의 상단 inset과 별도로 좌우/하단 safe area, 문서 스크롤 또는 FlatList의
단일 스크롤 소유, 입력 처리·drag 키보드 닫기를 유지한다. 추가 header overlay가 있는
화면은 keyboardOffset을 전달할 수 있다. 실제 두 OS 키보드·회전/큰 글자·VoiceOver/TalkBack과
글꼴/브랜드·최종 화면 검토는 RN renderer의 props/이벤트 검사와 구분해 #379에서 추적한다.


## 로컬 폰트·브랜드

기존 `public/fonts/PretendardVariable.woff2`와 OFL, `public/brand/logo.svg`는 정본으로 읽기만
한다. 모바일 [폰트](./assets/fonts/README.md)와 [브랜드](./assets/brand/README.md) 산출물을
생성하고 `mobile:assets:check`에서 source/output hash·TTF 이름/굵기/한글·OFL·PNG 형식/
크기를 검사한다. fonttools의 별도 `--check`는 실제 재생성 결과와 전체 byte를 비교한다.

native font family는 BaroMobile이며 원본 cmap/굵기 축·named instance를 유지한다. 원래
copyright/OFL은 복사본과 TTF license metadata에 보존한다. 설치된 expo-font58의 config
plugin으로 앱에 포함하고 Text/TextField·Stack header에 사용한다. 웹/CDN 요청이나 폰트
비동기 대기 gate는 추가하지 않는다. 로고는 원본에서 만든 density PNG와 opaque app icon을
사용하고 접근 가능한 BARO 이름 옆 장식 이미지로만 출력한다. 설정 변경 뒤 개발 앱을 새로
빌드해야 하며 Expo Go/기존 설치의 성공으로 대신하지 않는다.

`mobile:native`는 실제 compiled APK/app에서 TTF byte와 license를 대조하고 Android400/600/700
선언·iOS UIAppFonts를 확인해 receipt에 `compiled-resource-only`, `appRuntimeVerified:false`를
남긴다. 이는 실제 기기 폰트·큰 글자·스크린리더나 API/OAuth 성공의 증거가 아니다.


## 읽기와 선택적 관리

리포트는 검토할 본문과 저장된 가림/사진/자료 제외 설정을 먼저 읽고, 본문·출력 설정을
선택해 편집한다. 미저장 수정·충돌·다운로드 준비 한도 복구·저장 중에는 편집을 펼쳐 두며,
모델이 새 저장 revision을 확인한 뒤 읽기로 돌아간다. 가림 경고·오류/진행 상태·새 초안/
불러오기 확인·원본 ZIP 고지와 준비된 파일 열기·공유는 편집 안에 숨기지 않는다.

설정은 사용량·정책을 우선 보여 주고 계정 삭제 관리를 선택해 연다. 미확정/재인증·삭제
진행·literal 입력·오류가 있으면 관리를 펼쳐 두고, 삭제 접수/정리 결과는 별도 화면 상태로
계속 표시한다. 펼치기/접기는 표시 상태만 바꾸며 저장/삭제/재인증이나 복구 key 제거를
실행하지 않는다. owner·동의·원래 revision·동일 요청 확인은 기존 모델과 client가 소유한다.

## 수동 로컬 runtime 검증 (#385)

`Mobile local runtime (manual)` workflow는 main의 full40 SHA만 받고, 해당 커밋의 별도
임시 worktree에서 `site.baro.app.dev` 개발 앱을 빌드한다. 기본 `mobile:native`의 preview
제약은 유지한다. `mobile:runtime android|ios`만 `--runtime-local`과 정확한
`http://127.0.0.1:8765` 환경으로 빌드를 호출한다. Android는 새 소유 AVD와 adb reverse,
iOS는 새 소유 Simulator를 사용하고 실행 후 제거한다. 개인 기기/기존 simulator는 선택하지 않는다.

제품의 `expo-router/entry`와 home 코드를 먼저 실행한다. 임시 checkout에서만 원래 home을
동일 상대 import 깊이에 복사하고 onLayout wrapper를 씌워 실제 native layout과 합성 화면
스크린샷을 기록한다. 이는 계측된 공개 home의 mount 증거이며 전체 화면 조작/로그인 인수가 아니다.
그 뒤 임시 manifest의 main만 `runtime-probe/entry.tsx`로 바꾼다. 정본 manifest/router는
바뀌지 않고 probe는 일반 앱 bundle의 import 그래프에 들어가지 않는다.

probe는 실제 Expo SecureStore/파일 SDK·등록된 native module을 사용한다. synthetic picker
결과만 주입하고 실제 private snapshot/reader·100MB native PUT·1GB native download·SDK
독립 hash/readback·401/Origin fence·계정 변경·전송 중 source clear/취소·파일 정리를 검사한다.
loopback fixture는 nonce control과 synthetic cookie/Origin/owner를 구분하고 받은 전체 byte/hash를
독립 대조한다. credentials reset 뒤에도 미확정 operation key가 남는지 확인한 후 자기 probe key만
제거한다. 실제 사건/토큰/공급자/유료 호출은 사용하지 않는다.

성공한 workflow는 source·OS/모델·앱/entry/overlay hash·compiled font·전송 결과·관측 RSS와
두 합성 스크린샷만 내보낸다. process RSS 표본의 최대값을 전체 peak나 JS heap 한도의 증명으로
확대하지 않는다. raw runtime/Metro 로그는 artifact에 넣지 않는다. `mobile:check`의 offline fixture/
receipt 회귀와 이 실제 OS 실행은 구분하며 실행 전에는 runtime 성공을 선언하지 않는다.
실제 DocumentPicker UI·열기/공유 sheet·OAuth/원격 API·물리 기기·접근성/전체 사용자 여정·
내부 preview 전달·스토어 서명/배포는 이 실행의 미검증 항목으로 유지한다.

Metro localhost는 Node DNS 순서에 따라 IPv6에만 열릴 수 있어, runner가 IPv4 우선 옵션으로
native/adb reverse의 `127.0.0.1` 주소에 맞춘다. native compile 전에 실제 `/status` 준비를
확인하고 서버를 닫는다. 서버의 자동 TS 파일 수정은 격리 검증에서 끄며 별도 strict typecheck는
유지한다. 제품/probe Metro 준비와 제품 home layout 대기는 각각의 phase로 기록한다.
소유 AVD에는 RAM2048MiB·2코어·SwiftShader/Vulkan 비활성 설정을 명시하고, 조기 종료를
즉시 실패로 감지한다. 실패 receipt에는 boot 여부/exit code와 정해진 시작 문제 코드만 포함한다.
이 설정은 Android boot 성공을 가정하거나 기존 실패를 지우지 않으며 실제 재실행으로 확인한다.
AVD home/user/emulator 경로는 소유 output directory로 맞추고 SDK가 만든 AVD를 emulator가
실제로 탐색하는지 compile 전에 확인한다. 수동 development-client URL에도 Expo의
onboarding/FAB/자동 메뉴 숨김 flag를 붙인다. adb device shell의 URL 구분 문자는 literal로
보존한다. PR의 좁은 SDK host 검사는 실제 signature fixture·소유 AVD 탐색만 확인하며
emulator 부팅·BARO UI/native IPC는 별도 manual runtime에서 인수한다.

## 내부 preview 개발 앱 전달

`Mobile native builds (manual)`에 main의 full40 `target_sha`를 넣는다. 일반 preview 앱을
컴파일하고 `mobile-preview-development-<platform>-<sha>` artifact에 APK 또는 Simulator 앱 ZIP과
`receipt-<platform>.json`을 남긴다. 이는 Metro에 연결하는 development client이며 standalone
release/스토어 제출물이 아니다. 로컬 runtime probe 앱/entry를 포함한 전달물로 바꾸지 않는다.

| 전달물 | 설치 대상 | 실제 산출물에서 확인하는 항목 | 남은 인수 |
| --- | --- | --- | --- |
| `baro-preview-android-<sha>.apk` | 지원 API/ABI의 Android 기기·Emulator | applicationId/versionCode/versionName·최소 API·포함 ABI·debuggable·서명 인증서 hash·전체 APK byte/hash | 실제 물리 기기·원격 API/OAuth/전체 여정 |
| `baro-preview-ios-simulator-<sha>.zip` | macOS/Xcode의 호환 iOS Simulator | Info.plist의 Simulator platform·최소 OS/version/build·Mach-O ABI·실제 none/ad-hoc 서명 상태·ZIP byte/hash | 물리 iPhone 서명/배포·원격 API/OAuth/전체 여정 |

기본 식별자는 `site.baro.app.preview`다. iOS Simulator ZIP은 iPhone 설치용 IPA가 아니다.
새 Apple/Google 배포 identity·EAS 계정/서비스·자동 배포는 도입하지 않는다. 실제 min OS/ABI는
receipt를 따르며 소스의 기대값만으로 실행 지원을 선언하지 않는다.
Android 인증서는 설치된 SDK apksig API의 실제 서명 검증 결과와 DER certificate hash를
JSON으로 읽는다. 같은 인증서만 합치고 다른 인증서는 거부한다. SDK API 준비·공식 합성
fixture 검사는 실제 BARO APK 검증과 다른 report kind로 구분하며, 전달 receipt에는 사용한
build-tools 버전을 기록한다. 실제 APK 검증은 manifest의 지원 범위를 그대로 확인한다.

1. artifact를 내려받아 압축을 풀고 receipt의 `sourceSha`와 파일 이름·byte/hash를 확인한다.
   macOS/Linux에서는 `shasum -a 256 <apk-or-zip>`으로 비교한다.
2. 별도 checkout을 해당 SHA로 맞추고 `bun ci`를 실행한다. Metro도 같은 source여야 한다.
   `EXPO_PUBLIC_APP_ENV=preview EXPO_PUBLIC_API_URL=https://preview.baro.site bun run mobile:start --lan`
   으로 개발 서버를 연다. 기기는 개발 서버에 연결할 수 있는 네트워크를 사용한다.
3. Android는 원하는 기기를 명시해 `adb -s <device-serial> install -r <apk>`로 설치한다.
   서명/버전 불일치를 우회하거나 앱을 자동 삭제하지 않는다. iOS는 ZIP에서 나온 `.app`을
   `xcrun simctl install <simulator-udid> <app-path>`로 설치한다. 앱에서 해당 Metro URL을 연다.
4. `apiObservation`은 패키징 시점의 preview health SHA 관측일 뿐이다. unavailable도 사실대로
   기록한다. `compatibility=runtime-smoke-required`이며 해당 앱/API 조합의 실제 로그인·두 역할·
   자료/리포트·재인증/삭제와 #339/#71 인수를 마치기 전 원격 동작·출시 완료로 표현하지 않는다.

정확한 artifact/실행 결과는 #385에 연결한다. source/OS/설정이 다른 로컬 probe receipt나
이전 native compile을 새 preview 앱·물리 기기 성공으로 확대하지 않는다.
