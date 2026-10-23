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
