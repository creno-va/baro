# iOS Simulator SDK 초기화 진단 (#394)

source31597a8의 [runtime39921864348](https://github.com/creno-va/baro/actions/runs/39921864348)는
계측 Home layout/Metro bundle/RSS26표본 관측 뒤 native-ready에서 실패했다.
[실제 실패 분류](./mobile-runtime-2026-10-23/failure-ios-31597a8.json)를 보존한다.
전체 native IO·실제 OAuth·물리 기기 성공이 아니며 초기화의 어느 작업이 실패했는지는
당시 coarse code만으로 확정하지 않는다. 새 probe는 native/source/download cache clear,
credential reset/store/readback와 복구 key write/read를 각각 구분하고 고정 오류 category만 보낸다.

원래 Simulator executable의 entitlement dump는 출력0bytes였다. Apple의
[Keychain entitlement 진단](https://developer.apple.com/forums/thread/114456)은 빌드된 앱의
실제 signature를 확인하도록 설명한다. 이것은 원인 가설이며 실제 SDK 전/후 결과와
원래 full runtime의 검증 범위를 구분한다. 일반 앱 build/sign 설정은 이 진단에서 바꾸지 않는다.

## 수동 진단

성공한 main CI의 full40 SHA로 실행한다.

```sh
gh workflow run mobile-ios-keychain-host.yml --ref main -f target_sha=<full40-main-sha>
```

[고정 binary manifest](../../tests/fixtures/ios-host-binary.json)는 source31597a8의 검증된
public iOS Simulator 개발 앱과 receipt를 가리킨다. 원본 ZIP·receipt 전체 byte/hash,
source/이름·플랫폼·signature 종류와 native 입력(package/lock/config/자산/module/patch)의
동일성을 검사한다. native 입력이 달라지거나 artifact가 만료·변조되면 실패하며 mock이나
다른 binary로 대체하지 않는다. JS/진단 source와 binary source는 별도로 기록한다.

새 소유 Simulator의 UUID/name/Booted를 확인하고 baseline 개발 앱의 SDK 초기화를 관측한다.
원본 ZIP을 보존한 추출 사본에만 Simulator ad-hoc signature를 적용하고 동일 SDK entry를 다시
실행한다. 사본의 실제 iPhoneSimulator metadata와 known dev/preview app ID를 요구한다.
Bundle ID/Info.plist는 바꾸지 않고 application-identifier와 단일 own-app keychain group만
사용한다. `codesign --sign - --timestamp=none`이므로 실제 Apple Team·인증서/private key·
개인 keychain이나 배포 identity를 사용하지 않는다. production/기기 app·wildcard/다른 앱 group은
거부하며 양 Mach-O ABI의 실제 signature/entitlement readback을 확인한다.

entry는 기존 실제 native clear·source/cache adapter·credential/operation-storage factory와
Expo SecureStore의 synthetic write/readback을 관측한다. 데이터는 새 소유 Simulator의
합성 cookie·자기 nonce key뿐이며 끝에 정리한다. app fetch는 localhost nonce control만
허용하고 외부 시도는 검사 실패로 기록한다. 전송값이나 key·token·raw exception/stack/SQL,
Metro/native 로그를 artifact에 넣지 않는다. Simulator는 성공/실패 후 자기 UUID만 삭제한다.

receipt는 작업별 전/후 결과·개선한 stage·signature와 원본/사본 hash·별도 source를 담는다.
이 결과는 full upload/download IO·제품 여정·실제 원격 API/OAuth·접근성·physical/store의
검증을 대신하지 않는다. #385의 full runtime은 여전히 별도다.

## Home-only 증거

full runtime은 유효한 제품 Home layout과 합성 화면을 관측하면 후속 IO 전에 별도의
`instrumented-home-only` receipt를 쓴다. 이후 native probe가 실패해도 Home-only artifact를
보존하며 nativeIoVerified=false를 고정한다. 실패 분류는 마지막 phase와 allowlist category만
포함한다. Home mount를 전체 제품 여정/폰트·키보드/스크린리더 인수로 확대하지 않는다.

기존 `nativeCalls`는 관측한 native upload/download 요청 횟수다. reserve/cancel/release나
SDK 파일 read를 포함하는 전체 IPC/파일 IO 호출 수로 해석하지 않는다.

## 첫 SDK host 실행과 보완

PR395/main `6a0ea16b57644283d6b0c7e63f9c974e50466705`의
[main CI39935544965](https://github.com/creno-va/baro/actions/runs/39935544965)는 SUCCESS다.
[SDK host39935901874](https://github.com/creno-va/baro/actions/runs/39935901874)는 terminal
FAILURE다. [원본 실패 receipt](./mobile-ios-host-2026-10-23/failure-6a0ea16.json)는
baselineObserved=true, signedObserved=false, phase=signed/IOS_HOST_COMMAND_FAILED다.
control flow상 서명 helper 반환 뒤 재설치/실행 중 실패했지만 명령별 원인은 기록되지 않았다.
baseline 작업별 결과와 signing readback도 최종 receipt 전에 별도 저장하지 않아 복구할 수 없다.
이를 실제 SecureStore 성공/실패나 원인 확정으로 해석하지 않는다.

보완 runner는 nonce/source/phase/schema를 검사한 baseline/signed report를 수신 즉시
별도 파일로 보존한다. 실제 signing 결과도 후속 설치 전에 저장한다. 명령 실패는 고정된
작업명·exit code·timeout/signature/launch 등 allowlist category만 담고 stderr/argv를 내보내지 않는다.
기존 앱을 종료한 뒤 설치하도록 순서를 고치며, 기존 실패와 조건 변경 후의 실행을 구분한다.
Home-only/full native IO·원격 OAuth·physical/store의 인수 경계는 그대로다.

별도 [공통 클라이언트 공개 조회 관측](./mobile-ios-host-2026-10-23/public-client-6a0ea16.json)은
2026-10-23T10:04:46.569Z에 실제 preview f912441의 공개 directory GET1회/200과 현재 공유
response schema를 통과했다. 반환 프로필 원문·식별자는 저장하지 않았다. Node/Bun의
읽기 전용 검사이며 실제 native SDK/인증 여정/OAuth/물리 기기 성공이 아니다.

## 보존된 baseline SDK 결과와 signed-launch 실패

PR396/main `15b97d302f4667dc61d9023cc6b5da839ccdb985`의 main CI39938363992는 SUCCESS,
[SDK host39938658226](https://github.com/creno-va/baro/actions/runs/39938658226)는 terminal FAILURE다.
수신 즉시 저장한 [baseline](./mobile-ios-host-2026-10-23/baseline-15b97d3.json)에서 실제
native/source/download-cache clear3개는 성공, credential reset/store·recovery·cleanup은
UNKNOWN 실패, 직접 SecureStore는 KEYCHAIN_ENTITLEMENT_MISSING 실패다. 외부 fetch 시도는0이다.
wrapper가 감춘 UNKNOWN을 직접 SDK 오류와 같다고 단정하지 않는다.

[signing readback](./mobile-ios-host-2026-10-23/signing-15b97d3.json)은 같은 원본 executable과
Info.plist hash, x86_64/arm64의 최소 own-app entitlement·ad-hoc 검증을 보존한다.
실제 signed 설치는 완료됐으나 [실패 receipt](./mobile-ios-host-2026-10-23/failure-15b97d3.json)의
signed-launch/APP_LAUNCH exit1 LAUNCH_FAILED로 종료돼 signed SDK report는 없다.
이 결과를 서명 보완 성공이나 full runtime 성공으로 해석하지 않는다.

후속 검사는 소유 Simulator에서 합성 baseline 앱만 uninstall한 뒤 signed 사본을 새로
설치한다. 덮어쓰기 이후의 launch와 first-install 조건을 구분하며 signing 원인은 미확정으로
유지한다. 같은 원본 binary/native 입력/nonce·JS와 최소 entitlement를 보존한다.
실패 시 공개할 OS 진단은 알려진 NSError domain8종·범위 내 정수 code 최대4개만 허용하고
중복·알 수 없는 domain·범위 밖 숫자·원문 stderr/argv/stack/SQL·private 값을 내보내지 않는다.
일반 앱 build/sign 설정과 실제 사용자/물리 기기·원격 API는 바꾸지 않는다.

## 새 설치 결과와 명시적 group-only 후속 실험

PR398/main `716d9e563266138f5f8525c55605a91c43c71bb0`의 main CI39940703999는 SUCCESS,
[SDK host39941004115](https://github.com/creno-va/baro/actions/runs/39941004115)는 terminal FAILURE다.
[baseline](./mobile-ios-host-2026-10-23/baseline-716d9e5.json)·
[signing](./mobile-ios-host-2026-10-23/signing-716d9e5.json)·
[실패](./mobile-ios-host-2026-10-23/failure-716d9e5.json)를 보존한다.
signed 새 설치 뒤 URL launch wrapper가 exit1/LAUNCH_FAILED로 종료됐고 signed SDK 결과는 없다.
domains[]만으로 원인을 특정하지 않는다. 기존 parser가 simctl의 comma/lowercase-code 형식과
Buffer stderr를 놓치는 빈틈도 확인해, 실제 원인과 parser 보완을 구분한다.

후속 runner는 app ID 직접 launch와 제한된 loopback URL 열기/approval readback 단계를
각각 기록한다. 내부 NSError는 알려진 domain·정수 code만 보존한다. 실제 Simulator 사본에는
원래 `app-and-group` profile/default와 별도로 `group-only` profile을 명시한다. 이 실험의
권한은 known preview/dev bundle의 단일 own keychain group뿐이며 application-identifier,
Team/prefix·다른 group·wildcard를 더하지 않는다. 원본 ZIP·Info.plist/앱 ID는 그대로이고
양 ABI readback으로 실제 profile을 확인한다. 일반 앱 build/sign 설정은 바꾸지 않는다.

[Apple의 access-group 설명](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)은
명시 group과 application identifier의 우선순위를 설명한다. 이 참고를 Simulator 실험의
성공 보장으로 해석하지 않는다. `group-only` 사본의 로컬 Mac signature/entitlement readback은
통과했지만 실제 SDK 초기화·실행·큰 IO/물리 기기·store 성공은 별도이며 원인은 미확정이다.

## 실제 OS 직접 실행 거절과 Xcode signing control

PR400/main `64afcfb9353accbc6d0108313c83b46f71ced919`·main CI39945732408 SUCCESS 뒤
[SDK39946286601](https://github.com/creno-va/baro/actions/runs/39946286601)은 terminal FAILURE다.
[baseline](./mobile-ios-host-2026-10-23/baseline-64afcfb.json)·
[group-only signing](./mobile-ios-host-2026-10-23/signing-64afcfb.json)·
[실패](./mobile-ios-host-2026-10-23/failure-64afcfb.json)를 보존한다.
signed-direct-launch/APP_DIRECT_LAUNCH exit1, FBSOpenApplicationServiceErrorDomain code1의
실제 OS 거절이므로 URL wrapper만의 문제로 해석하지 않는다. signed SDK report는 없고
일반 앱 서명 변경의 성공 근거도 아니다.

다음 control은 수동 codesign profile을 더 추측하지 않고 실제 Xcode의 Simulator signing
machinery로 새 앱을 컴파일한다. [Apple DTS의 Simulator ad-hoc 설명](https://developer.apple.com/forums/thread/826882)은
Simulator에서 Apple Development signing identity를 요구하지 않는 범위를 설명한다.
실제 iPhone/스토어 profile·계정·심사 승인과 구분하며 이 문서를 성공 보장으로 사용하지 않는다.

```sh
gh workflow run mobile-ios-xcode-control.yml --ref main -f target_sha=<full40-main-sha>
```

이 경로는 fresh CI checkout·known preview/Simulator에만 열리는 별도 `--xcode-control`다.
normal/native defaults의 CODE_SIGNING_ALLOWED=NO와 기존 pinned-binary 전후 비교는 유지한다.
actual generated app target의 비어 있는 entitlements 파일만 표준 own-app keychain placeholder로
바꾸고 Xcode가 확장하도록 한다. identity `-`/빈 Team/profile·manual Simulator signing을 명시하며
provisioning 업데이트를 요청하거나 실제 인증서/private key를 선택하지 않는다. 자식 환경은
명시한 OS/Ruby 도구와 preview 값만 전달하고 dotenv·credential·Node preload는 제외한다.

compiler 출력은 private log에 보존하고 artifact로 내보내지 않는다. 실제 Info/ABI·양식과
ad-hoc/no-Team signature, 각 ABI의 expanded own-group/표준 debugger entitlement readback을
검사한 뒤 strict control sidecar와 기존 개발 ZIP byte/hash를 기록한다. 예상 밖 Team/group/
wildcard·device/production identity는 인수하지 않는다. 실제 값·관측 시각은 조작하지 않는다.

fresh same-source archive와 control sidecar의 byte/hash·실제 추출 Info/executable hash를
대조하고 새 소유 Simulator에서 기존 SDK entry/factories를 한 번 관측한다. 이 모드에서는
컴파일된 앱을 수동으로 재서명하지 않는다. baseline report와 control signing·컴파일 ZIP을
각각 보존하고 성공 전 일반 앱 설정을 바꾸지 않는다. 실제 SecureStore 성공은 아직 미확정이며
full native IO·실제 OAuth/API·physical/store·#339/#71의 인수를 대신하지 않는다.
