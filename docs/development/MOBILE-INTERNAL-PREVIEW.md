# 내부 bundled Android preview (#397)

기존 development APK/Simulator ZIP은 Metro가 필요한 개발 앱이다. 이 문서의 Android
경로는 실제 Release 설정에서 JS/Hermes bundle을 APK에 포함하되 기존 Expo template의
공개 개발용 인증서만 사용하는 별도 내부 전달물이다. Google Play upload/store key를
생성하거나 바꾸지 않고 외부 업로드·공개 배포도 하지 않는다. 실제 원격 API가 필요한
기능을 offline 지원으로 표현하지 않는다. iOS bundled 전달물은 후속 범위이며 #394의
실제 SDK 서명 인수 전 일반 iOS build/sign 설정을 바꾸지 않는다.

## 수동 빌드와 검사

성공한 main CI의 full40 SHA로 실행한다.

```sh
gh workflow run mobile-internal-android.yml --ref main -f target_sha=<full40-main-sha>
```

runner는 tracked source/현재 HEAD/main ancestry와 `expo-router/entry`를 검사한 뒤 소유
checkout을 만든다. 원래 앱 manifest/entry를 바꾸지 않고 workspace resolver만 소유 source로
연결한다. 자식 process에는 명시한 OS·Java/Android tool 환경과 preview API만 전달하고
dotenv·entry override·probe 변수·credential·private key·상속 Node preload를 사용하지 않는다.
Metro transform/file-map과 Gradle cache도 소유 디렉터리에 둔다. root package/lock·module·
공유 wire·서버는 바꾸지 않는다. 예전 임시 폴더를 참조한 로컬 export 실패를 보존하며,
다른 작업의 전역 Metro cache를 지우거나 없는 Home source 검사를 완화하지 않는다.

현재 실제 SDK template의 `export:embed`와 Release의 `signingConfigs.debug`를 요구하고
`:app:assembleRelease`로 arm64-v8a/x86_64를 빌드한다. 실제 SDK apksig가 양식/서명을 검증하고,
기존 template 개발용 certificate fingerprint와 다르면 전달물을 만들지 않는다. Release 설정과
실제 store identity는 별개다. production app ID/새 서명 경로를 이 도구에 추가하지 않는다.

검사는 APK metadata의 preview app ID/version/build/minimum OS/ABI·non-debuggable·실제
MainActivity, APK 전체 byte/hash를 확인한다. Gradle이 생성한 Hermes bytecode와 실제 APK의
`assets/index.android.bundle` byte/hash를 대조한다. 최종 source map의 제품 Home source 존재와
alternate runtime-probe source 부재, APK의 source-map 미포함을 검사한다. 이는 byte/graph
검사이며 JS 기능 전체 실행 증거가 아니다. 실제 Release APK의 한글 폰트·weight·OFL byte도
Debug artifact와 혼동하지 않고 검사한다.

전달 artifact는 APK와 `receipt-android.json`뿐이다. 실패 artifact는 고정 phase/category/exit
code의 JSON만 포함한다. raw build/native/Metro log·stack/SQL·키/토큰·실제 사건은 올리지 않는다.
원본 audit2건/#339·실제 API/OAuth/physical/store·#71은 별도이며 이 내부 빌드가 full validation
또는 공개 릴리스 성공을 뜻하지 않는다. 살아 있는 실행을 관측 timeout으로 취소/재생성하지 않는다.

2026-10-23 source3e73151의 [첫 실제 build39944522758](https://github.com/creno-va/baro/actions/runs/39944522758)는
native compile exit0 뒤 verify-binary에서 terminal FAILURE였다.
[원본 실패](../quality/mobile-internal-android-2026-10-23/failure-3e73151.json)의 failedTool=null만으로
원인을 특정하지 않는다. 해당 실행은 완료된 APK를 보존하지 않아 독립 재검증으로 복구할 수 없다.

후속 runner는 compile 완료 직후 별도 `inspection/`에 미인수 APK·실제 generated HBC·font
declaration와 안전한 graph 요약을 보존한다. raw source map/log·실제 사용자 데이터는 담지 않는다.
이것은 `unaccepted-android-inspection`, accepted=false/binaryMetadataVerified=false이며 정상
전달 영수증으로 사용할 수 없다. 실패 artifact에만 별도로 포함하며 검증 전 설치하지 않는다.
post-compile phase와 allowlist code/metadata field만 기록하고, generated Release output은
SDK별 실제 파일 한 개를 찾아 읽는다. 중복·다른 variant/외부 symlink를 성공으로 대체하지 않는다.
정상 전달은 기존 모든 signature/identity/byte/hash/graph/font 검사가 통과한 뒤에만 만든다.

## 설치와 실제 인수

```sh
gh run download <run-id> --name mobile-internal-android-<full40-sha> --dir <owned-output>
shasum -a 256 <owned-output>/baro-internal-preview-android-<full40-sha>.apk
adb -s <selected-device-serial> install -r <owned-output>/baro-internal-preview-android-<full40-sha>.apk
adb -s <selected-device-serial> shell am start -n site.baro.app.preview/.MainActivity
```

receipt의 source·artifact hash·개발 인증서를 먼저 대조한다. `-r`은 기존 앱 데이터를 보존하며
서명이 다르면 멈춘다. 실제 사용자 앱/미해결 작업을 지우는 uninstall로 설치를 강제하지 않는다.
이 도구는 사용자의 물리 기기를 자동 선택하거나 설치하지 않는다.

`requiresMetro=false`는 bundle 포함과 검사 범위다. 실제 설치/부팅·초기 화면, 기존 3사
OAuth/앱 복귀·고객/변호사 여정·원격 API·기기 권한/접근성은 앱 source/API health 관측 SHA와
OS/기기·실행 시각별로 별도 인수한다. receipt의 `appRuntimeVerified/remoteApiVerified/
physicalDeviceVerified/storeSigned/deployed`는 모두 false다. 초기 화면 성공을 전체 제품
기능 성공으로 확대하지 않는다. 사용자에게 요청한 실기기/기존 개발자 계정 정보는 답변 대기다.
# 보존된 Android Release 바이너리 재검증

PR401/main `dedcd0e13e8c7263edcd78f53f3f1da980f273c8`·main CI39950029643 SUCCESS 뒤
[실제 빌드39950492600](https://github.com/creno-va/baro/actions/runs/39950492600)은 compile을 마쳤지만
compiled-font/COMPILED_FONT_READ_FAILED로 실패했다. [실패 사실](../quality/mobile-internal-android-2026-10-23/failure-dedcd0e.json)과
[원본 unaccepted inspection](../quality/mobile-internal-android-2026-10-23/inspection-dedcd0e.json)을 보존한다.
APK는57,133,498bytes이며 서명·badging parse·HBC 대조 이후 폰트 읽기에서 멈췄다.
최종 strict metadata receipt는 그 다음 단계이므로 이전 실패를 모든 identity gate의 성공으로 확대하지 않는다.

실제 APK를 Google Maven의 macOS AAPT2 9.1.0-14792394로 조사한 결과 `font/baro_mobile`은
`res/Yd.ttf`, `font/xml_baro_mobile`은 `res/dr.xml`로 매핑됐다. 최적화된 파일명을 하드코딩하지 않고
[AAPT2 resource/XML dump](https://developer.android.com/tools/aapt2)에서 named resource와 세 font face의
참조·normal style·400/600/700 variation/weight를 확인한다. ZIP 경로 중복·alias·qualifier·경로 이탈은
거절하고 실제 TTF 전체 byte/hash와 기존 원본·한글11172자·embedded OFL 검사를 유지한다.
로컬 실제 compiled font 검사는 통과했지만 이는 앱 실행이나 전체 APK 인수가 아니다.

```sh
gh workflow run mobile-internal-android-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha>
```

이 수동 경로는 원본 run/artifact ID와 source SHA를 확인한 뒤 고정 inspection 전체 hash와 APK·
실제 생성 HBC·font XML의 전체 byte/hash를 대조한다. binary source `dedcd0e`와 tooling source는
분리하며 앱·계약·공통 package·lock/patch/native 입력이 달라졌으면 재사용을 거절한다.
원본 safe graph 요약과 source-map hash는 pinned inspection의 사실로 사용하고 원본 source map을
새로 검사한 것처럼 표현하지 않는다. 생성 HBC와 APK에서 추출한 HBC를 실제 대조하고 map이
APK에 들어 있으면 거절한다. packaged HBC를 자기 자신과 비교하지 않는다.

실제 SDK apksig/certificate·metadata·font와 최종 strict preview identity gate를 모두 재실행한 뒤에만
새 전달 receipt를 만든다. 원본 unaccepted report는 수정하지 않고 별도의 verification sidecar에
원본 run·두 source·새 관측 시각을 기록한다. 정상 빌드도 같은 리소스 해석기를 사용한다.
Metro 없는 Home 실행·실제 API/OAuth·physical/store 검증은 이 receipt가 인수하지 않는다.

## 실제 SDK 재검증과 Metro 없는 Home 관측

PR403/main `dfd05f2426356c62cc2bb873f776b0f8f05e1029`·main CI39955426563 SUCCESS 뒤
[수동 SDK39955771243](https://github.com/creno-va/baro/actions/runs/39955771243)이 SUCCESS다.
[binary receipt](../quality/mobile-internal-android-2026-10-23/receipt-dfd05f2.json)와
[별도 verification](../quality/mobile-internal-android-2026-10-23/verification-dfd05f2.json)을 보존한다.
실제 SDK37 apksig/certificate·metadata/strict identity·1455-module graph 요약·생성/packaged HBC·
compiled font 인수가 통과했다. APK는 원본 dedcd0e의 동일57,133,498bytes/hash이며 새로운
빌드로 표시하지 않는다. requiresMetro=false이고 실제 Home/runtime·API/OAuth·physical/store는 미검증이다.

```sh
gh workflow run mobile-internal-android-reverify.yml --ref main -f target_sha=<full40-main-sha> -f smoke=true
```

선택한 smoke는 실제 SDK 재검증 뒤 같은 APK를 새 소유 Android35 Emulator에 설치한다.
Metro 프로세스나 adb reverse를 만들지 않고 host8081에는 503 거절 guard만 둔다. 원래
Home/route에 계측·fixture를 삽입하지 않는다. 실제 Activity 직접 실행·app PID·자기 package의
유효한 Home 제목/첫 카드 UI hierarchy를 두 차례 force-stop/cold launch에서 관측한다.
기존 구성 오류 화면은 인수하지 않으며 첫 실행 실제 PNG와 source/hash를 별도로 기록한다.

raw UI hierarchy·emulator 로그·AVD 데이터는 업로드하지 않는다. 실패는 phase와 고정 code만
보존하고 소유 Emulator/guard/AVD를 정리한다. Home smoke가 실패해도 앞선 SDK 검증의
receipt와 바이너리는 별도 artifact로 보존한다. 실제 Home 실행 전 해당 성공을 표시하지 않으며
전체 화면/IO·API/OAuth·physical/store·접근성·#339/#71의 인수는 별도다.

PR404/main478a904·CI39956914163 뒤 [실제39957216861](https://github.com/creno-va/baro/actions/runs/39957216861)이
SUCCESS다. [Home receipt](../quality/mobile-internal-android-2026-10-23/home-478a904.json)의 Android15
sdk_gphone64_x86_64에서 두 cold launch 모두 제목/첫 카드가 보이고 구성 오류는 없었다.
실제 PNG174,841bytes/SHA25661135c992afe141c03cf13c1fd324eb9241a659bbfd4ff39aeb1c5b627c4640e을
직접 확인해 브랜드/한글 Home 표시를 대조했다. Metro 요청0·adb reverse 없음이며 원본 binary
source dedcd0e의 동일 APK다. 실제 폰·전체 화면/IO/API/OAuth·store 인수는 이 관측에 포함되지 않는다.

## Android Home 글자 확대 관측 (#379)

```sh
gh workflow run mobile-internal-android-reverify.yml --ref main -f target_sha=<full40-main-sha> -f smoke=true -f large_font=true
```

이 선택은 일반 Home의 두 cold launch receipt를 먼저 보존한 뒤 소유 Emulator의 Android
font_scale을2.0으로 설정하고 실제 readback2를 확인한다. 같은 앱을 다시 시작해 Home 제목과
구성 오류 부재를 관측하고 실제 large-font PNG·hash·시각을 별도 JSON으로 기록한다.
제품 route·primitive·웹/공통 토큰은 수정하지 않는다. 명시적으로 요청한 JSON/PNG가 없으면
workflow가 실패하며 기존 tooling이 옵션을 무시한 경우를 성공으로 처리하지 않는다.

확대 단계가 실패해도 앞선 일반 Home 관측을 지우지 않는다. 설정은 새 소유 Emulator에만
적용하고 종료 후 AVD를 정리한다. raw UI hierarchy·로그·실제 계정/사건은 업로드하지 않는다.
실제 실행과 PNG 대조 전 성공으로 표시하지 않으며 Home만의 관측은 전체 화면·회전·키보드·
TalkBack/VoiceOver·두 OS/물리 기기 접근성 인수를 대신하지 않는다.

PR406/mainbf88d0d·CI39960471564 뒤 [실제39960797413](https://github.com/creno-va/baro/actions/runs/39960797413)이
SUCCESS다. [확대 관측](../quality/mobile-internal-android-2026-10-23/large-font-bf88d0d.json)의
font_scale readback2와 실제 PNG218,078bytes/SHA25642a7f2263f63012afe965175213c146d0ea0bf1f839ac83ea146d4e5b70687b0을
직접 대조해 원래 Home 제목·카드의 한글 확대/줄바꿈을 확인했다. 모든 글자가 정확히2배로
렌더링됐다는 측정이나 다른 화면·TalkBack/VoiceOver·실제 기기의 인수는 아니다.

## 실제 공개 탐색 UI의 안전한 관측 (#407)

```sh
gh workflow run mobile-internal-android-reverify.yml --ref main -f target_sha=<full40-main-sha> -f smoke=true -f public_directory=true
```

일반 Home 관측을 보존한 뒤 같은 pinned/reverified APK의 원래 공개 탐색 버튼을 한 번 누른다.
자기 preview package의 enabled/clickable·유일한 label과 실제 viewport 안 bounds만 사용한다.
검색·재시도·프로필 상세·로그인·사건 mutation은 실행하지 않는다. loading/구성 오류/목록 오류와
ready-empty 또는 ready-profile-card의 고정 UI 상태만 구분한다. API 오류는 즉시 실패로 남기고
정상 상태로 대체하지 않는다. 목록 아래로의 swipe는 최대4회이며 추가 검색/재시도를 누르지 않는다.

공개 데이터 진입 전 screenshot reader를 비가역적으로 비활성화한다. 이후 실패 경로에서도 SDK
스크린샷을 읽지 않으며 raw UI hierarchy·이름/ID/소개/연락처·로그를 artifact에 담지 않는다.
사전 anonymous Home/확대 PNG와 고정 상태 boolean·phase/code·source만 보존한다.
명시 요청한 public-directory JSON이 없으면 workflow가 실패한다.

compiled preview API 설정과 immutable 제품 client가 내보내는 실제 ready UI의 관측이며 HTTP
transport를 별도로 계측한 증거로 표시하지 않는다. health 관측 source/시각은 해당 health
요청의 사실로 분리한다. 실제 실행 전 public UI 성공으로 표시하지 않고 실제 OAuth/인증 여정·
private API·physical/store·전체 접근성/#339/#71은 별도로 유지한다.

PR408/main5b41fc2·CI39963435347 뒤 [실제39963766414](https://github.com/creno-va/baro/actions/runs/39963766414)이
SUCCESS다. [공개 UI receipt](../quality/mobile-internal-android-2026-10-23/public-directory-5b41fc2.json)의
실제 상태는 ready-empty이며 loading/error는 false다. 검색/재시도/상세를 실행하지 않았고
공개 데이터 진입 전 screenshot reader를 차단했다. 공개 프로필의 실제 card 분기는 이번
관측에 없으며 HTTP transport 별도 계측·OAuth/private API·physical/store 인수와 구분한다.

## iOS Simulator bundled preview 준비 (#397)

```sh
gh workflow run mobile-internal-ios.yml --ref main -f target_sha=<full40-main-sha>
```

별도 수동 경로는 성공한 main CI의 정확한 SHA와 깨끗한 소유 checkout에서만 실행한다.
preview 앱 ID/API·기본 expo-router 제품 entry를 유지하고 Xcode Release/iphonesimulator로
컴파일한다. Debug 개발 앱이나 계측 probe entry를 내부 전달 앱으로 대체하지 않는다.
[Expo의 로컬 Release 안내](https://docs.expo.dev/guides/local-app-development/)와 잠근 Expo/RN의
실제 Xcode bundle script에 따라 Hermes bundle과 private source map을 생성한다.
private map/로그는 전달하지 않으며 zip 내 map·probe source graph·bundle 변조를 거부한다.
중간 JavaScript와 compiled HBC는 서로 다른 산출물이므로 각각의 해시를 기록한다.
compiled app의 HBC와 ZIP에서 다시 읽은 HBC가 같음을 확인한다.

서명은 #394에서 실제 SDK 준비가 검증된 Xcode Simulator own-group/No-Team ad-hoc 경로다.
양 ABI의 Simulator platform·host signature·XML/DER와 내장 폰트를 필수로 검사하며 실제
Apple 계정/인증서/private key·스토어 profile을 사용하거나 iPhone IPA를 만들지 않는다.
기존 Debug 기본값과 Android 전달물은 그대로다. native compile exit0 뒤 원본 ZIP/hash를
먼저 unaccepted inspection으로 보존해 후속 검사 실패를 성공으로 덮어쓰지 않는다.

이 도구의 receipt는 Release/embedded bundle/signature/font/byte/hash만 인수하며
appRuntimeVerified=false를 고정한다. 실제 compile/산출물 검증과 이후 Metro 없는 소유
Simulator 설치/부팅·초기 화면 대조를 완료하기 전 iOS 전달 인수 성공으로 표시하지 않는다.
원격 API/OAuth·physical·전체 화면/접근성·store 및 #339/#71은 별도 인수로 유지한다.

PR411/mainff5c208·CI39980051064 뒤 [실제39980418548](https://github.com/creno-va/baro/actions/runs/39980418548)은
SUCCESS다. [원본 compiler receipt](../quality/mobile-internal-ios-2026-10-23/receipt-ff5c208.json)와
[검증 전 inspection](../quality/mobile-internal-ios-2026-10-23/inspection-ff5c208.json)을 각각 보존한다.
ZIP24,102,166bytes/SHA25640305a809554b104041fbac52b154faea42dcab9b446119f0fd572b6078617d2,
HBC3,581,924bytes/SHA2562a5caf19e7c611aca1c3ac4f2e7add88f143c4d17828d6b4cf5fc236ebfd523b다.
제품 source1464개·probe/map 제외·실제 양 ABI Simulator XML/DER·No-Team host signature·font를
인수했다. minimum iOS16.4/Expo58.0.17/RN0.88.0이며 실제 부팅은 이 compile receipt에 없다.

```sh
gh workflow run mobile-internal-ios-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true
```

[고정 compiler 입력](../../tests/fixtures/ios-internal-preview.json)은 성공한 원본 workflow/run/artifact와
receipt 전체 hash를 묶는다. 새 검증은 ZIP 전체 hash·현재 bundled JS/native/공유 입력 동일성·
실제 추출 signature/양 ABI XML·DER·font/HBC를 재검증한다. 원래 receipt의 시각/API 관측과 source를
고치지 않고 새 tooling/health 관측을 sidecar에 기록한다. graph는 고정한 compiler receipt의
사실이며 private source map을 다시 만들었다고 표시하지 않는다. 재컴파일/재서명은 하지 않는다.

선택한 smoke는 새 소유 iPhone16 Simulator에 원본 앱만 설치하고 두 cold launch의 PID를
각각3회 읽는다. Metro를 시작하지 않고 loopback8081의 별도 감시 응답 횟수가0이어야 한다.
익명 초기 화면만 캡처하며 공개 데이터/로그인으로 이동하지 않는다. receipt는 process launch와
최소15초의 표본을 기록하지만 Home 내용은 homeContentVerified=false/visualReviewRequired=true다.
PNG를 실제로 대조한 시각 관측을 별도로 남기며 전체 구간의 연속 생존·전체 기능/접근성·
OAuth/물리 기기/스토어 인수로 확대하지 않는다. 첫 실제 smoke 결과는 실행 후 기록한다.

PR414/mainfd86914·CI39987437927 뒤 [실제39987887841](https://github.com/creno-va/baro/actions/runs/39987887841)은
SUCCESS다. [metadata 재검증](../quality/mobile-internal-ios-2026-10-23/verification-fd86914.json)과
[cold launch 원본](../quality/mobile-internal-ios-2026-10-23/home-fd86914.json)을 보존한다.
iPhone16/iOS26.5의 각 새 PID를3회 읽었고 실제 경과 시간은25/54초, Metro 요청은0이다.
실제 PNG220,647bytes/SHA256b26d9c5dc645149ab4d398ba0ec22f84bd554e6f38f95491a09b3065d0d40e82를
직접 대조해 BARO/한글 Home 카드와 구성 오류 부재를 확인했다.
[별도 시각 관측](../quality/mobile-internal-ios-2026-10-23/visual-home-fd86914.json)을 추가하고 자동
receipt의 homeContentVerified=false와 원래 관측 시각·API health·compiler source는 바꾸지 않았다.
초기 viewport의 확인이며 전체 스크롤/기능/접근성·native IO·실제 API/OAuth·physical/store는 별도다.

### iOS 큰 글자 관측

PR418/maind57266a·CI39997516170 뒤 [SDK 관측39997880067](https://github.com/creno-va/baro/actions/runs/39997880067)은
SUCCESS다. [원본 SDK capability](../quality/mobile-internal-ios-2026-10-23/ui-capabilities-d57266a.json)는
`content_size`와 `accessibility-extra-extra-extra-large` 지원 문서만 인수하며 기기 변경·앱 실행 증거가 아니다.

```sh
gh workflow run mobile-internal-ios-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true -f large_font=true
```

이 선택은 일반 Home의 두 cold launch/PNG를 먼저 보존하고 같은 새 소유 Simulator에서
SDK 지원을 다시 확인한 뒤 가장 큰 접근성 category를 설정한다. 설정값을 읽고 앱을 종료·재시작하여
서로 다른 PID/3회 생존 표본을 확인한 다음 category를 다시 읽는다. 익명 초기 화면만 별도
`large-font-ios.png`로 캡처하고 원본 binary/receipt·tooling/device/hash와 `large-font.json`에 묶는다.
Metro 요청은 계속0이어야 한다. `smoke=false`의 확대 요청·지원되지 않는 category·불일치 readback은 거부한다.
자동 receipt는 Home 내용·정확한 배율·전체 접근성 인수를 주장하지 않는다. PNG 시각 대조와
실제 두 역할/화면·키보드/회전·VoiceOver/TalkBack·physical/store는 별도다. 실제 확대 실행 결과는 실행 후 기록한다.

PR419/mainf1ac60d·CI39999943507 뒤 [실제40000381723](https://github.com/creno-va/baro/actions/runs/40000381723)은
SUCCESS다. [baseline 원본](../quality/mobile-internal-ios-2026-10-23/home-f1ac60d.json)의 두 PID는 각3회/
실제21·88초, [확대 원본](../quality/mobile-internal-ios-2026-10-23/large-font-f1ac60d.json)은 재시작한 새 PID를
3회/25초 관측했다. 가장 큰 category를 재시작 전후 그대로 읽었고 Metro 요청은0이다.
[metadata 재검증](../quality/mobile-internal-ios-2026-10-23/verification-f1ac60d.json)은 원본 compiler/ZIP을 보존한다.

실제 PNG를 직접 대조한 [별도 시각 관측](../quality/mobile-internal-ios-2026-10-23/visual-large-font-f1ac60d.json)은
한글 확대·줄바꿈을 확인한다. 제목이 초기 viewport 대부분을 차지하고 카드/행동은 화면 아래로 이동한다.
확대 PNG163,252bytes/SHA2561b95bcb98ca2e86b9271a1e03018c27d1c68a24b857dee7d37c5343a4946fe25다.
스크롤로 행동에 도달하는지·전체 확대 사용성은 아직 확인하지 않았으며 정확한 배율/접근성 통과로
표현하지 않는다. #379/#334는 OPEN이다.

### iOS 최대 글자 크기 실제 조작 검증

```sh
gh workflow run mobile-internal-ios-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true -f large_font=true -f ui_test=true
```

`ui_test`는 일반 Home/확대 PNG·원본 receipt를 먼저 보존하고 같은 새 소유 Simulator에서
별도 Xcode UI test runner를 컴파일한다. 원본 제품 앱은 재컴파일/재서명하지 않는다.
Apple의 bundle-ID 기반 `XCUIApplication`과 실제 scroll/hittability/tap API로 익명 Home의
이용 안내 버튼까지 최대24번 스크롤하고, 버튼이 화면 안에 거의 전부 보이며 hit 가능한지
확인한 뒤 정적 Guide를 연다. Guide의 처음으로 버튼에도 도달·터치해 Home 복귀를 확인한다.
디렉터리/로그인/private route를 열지 않으며 실제 API/OAuth·전체 접근성을 인수하지 않는다.

Xcode exit0만으로는 통과하지 않는다. 한 번의 완전한 고정 JSON 표식과 전후 OS category
readback, baseline/확대의 binary·tooling·compiler/archive·device 일치가 필요하다.
`home-ui-test.json`만 추가로 export하며 private build/test log·UI hierarchy·xcresult/자동
attachment는 소유 임시 폴더에서 정리하고 공개 artifact에 넣지 않는다. XCTest 실패는 고정
assertion code와 제한된 compile/서명/runner 분류만 남긴다. 실제 UI 성공은 실행 후 인수한다.

원본 Guide에는 자료 업로드/리포트 저장을 준비 중으로 설명한 오래된 문구가 있다. 이 원본의
조작 검증을 최신 기능 안내/최종 앱 인수로 확대하지 않으며 후속 문구 수정·새 앱 source의
bundled compile/동일 UI 검증이 필요하다. 확대 스크롤/조작·전체 화면/역할·키보드/회전·
VoiceOver/TalkBack·물리 기기/스토어와 #379/#334는 별도 잔여다.

참고: [XCUIApplication](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication),
[실제 테스트 실행](https://developer.apple.com/documentation/xcode/running-tests-and-interpreting-results).

첫 XCTest [실제40005659811](https://github.com/creno-va/baro/actions/runs/40005659811)/tooling3346573은
Xcode command exit64로 terminal FAILURE다. [원본 실패](../quality/mobile-internal-ios-2026-10-23/failure-ui-3346573.json)의
기존 고정 분류에는 특정 CLI 옵션의 원인이 보존되지 않았다. baseline/확대 성공과 UI 조작 완료는
구분하며 전체 UI 성공으로 표시하지 않는다. 불필요한 test-iterations 옵션을 제거하고 CLI error의
고정 topic 분류를 보강한다. 해당 옵션을 이전 실패의 확정 원인으로 표시하지 않는다.

새 앱 source171989e의 [iOS compile40006340014](https://github.com/creno-va/baro/actions/runs/40006340014)은 SUCCESS다.
[원본 receipt](../quality/mobile-internal-ios-2026-10-23/receipt-171989e.json)·[compile 직후 inspection](../quality/mobile-internal-ios-2026-10-23/inspection-171989e.json)을 보존한다.
ZIP24,102,101bytes/SHA256f8e218df820cdaa2c222b10474124b7265b73c4de43a146a3459181cd4fde356와
원본 receipt 전체 SHA25677d157201a02eda89372ef3ef850895a2478f14047ea2024b7877db3ac62bcce를 독립 대조했다.
HBC3,581,976bytes·product source1464·probe/maps 제외·font/양 ABI Simulator signature는 compile 범위다.
고정 입력은 성공한 이 원본으로 갱신하고 기존 ff5c208 receipt/부팅 기록은 그대로 보존한다.
새 앱의 실제 Home/확대/Guide 조작은 후속 실행으로만 인수한다.

### Android 확대 안내 조작

```sh
gh workflow run mobile-internal-android-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true -f large_font=true -f guide_ui=true -f public_directory=false
```

이 선택은 같은 새 소유 Emulator의 OS font_scale2와 Home baseline/확대 관측을 보존한 뒤,
고정 안내/처음으로 버튼의 유일한 enabled/clickable·화면 내 bounds만 좌표로 변환한다.
각 화면 최대24회 스크롤·tap과 Guide/Home 제목 전환·Guide 사라짐 및 전후 OS readback을 확인한다.
두 OS의 새 실행에서는 교정된 사건 화면 자료/리포트 안내 문구가 실제 native 접근성 요소에 있는지도 확인한다.
`guide-ui.json`은 원본 APK/source·현재 tooling·metadata 재검증/hash·baseline/hash·device에 묶는다.
원문 hierarchy/개인 값은 기록하지 않으며 화면 안 bounds/tap 완료를 전체 접근성으로 확대하지 않는다.
`guide_ui`는 large_font/smoke가 필요하고 public_directory와 함께 요청하면 기기 작업 전에 거부한다.
기존 공개 화면의 불가역 screenshot guard는 유지하고 Guide 조작도 첫 tap 전 캡처를 영구 차단한다.
기존 Home/확대 PNG는 이미 보존되며 이후 실패에도 새 화면 캡처를 export하지 않는다. 실제 UI 성공은 새 compiler 입력/실행 후 인수한다.

PR422/main171989e·CI40005978910의 Guide 문구 교정은 새 앱 source에만 적용된다. 기존 ff5c208/dedcd0e의
관측을 수정된 앱 인수로 쓰지 않으며, 새 source의 두 OS compile/원본 pin·실제 smoke가 필요하다.

## 내부 전달 기준과 설치

| 전달물 | 앱 source·version/build | binary metadata | 실제 설치/초기 Home 관측 |
| --- | --- | --- | --- |
| Android APK | dedcd0e / 0.1.0·1 | minimum API24, arm64-v8a/x86_64, embedded HBC, 공개 template development certificate | Android15 Emulator / tooling478a904·39957216861, Metro 요청0. 별도 글자 확대·공개 ready-empty 관측 보존 |
| iOS Simulator ZIP | ff5c208 / 0.1.0·1 | minimum iOS16.4, arm64/x86_64, embedded HBC, No-Team Simulator ad-hoc | iPhone16/iOS26.5 Simulator / toolingfd86914·39987887841, 두 cold launch·Metro 요청0·Home PNG 대조 |

두 앱은 `https://preview.baro.site`를 사용한다. 연결된 receipt의 API health source는f912441이며
각 관측 시각을 그대로 보존한다. health source를 실제 앱의 HTTP 전송 계측이나 인증된 전체
API 호환 성공으로 확대하지 않는다. 앱/검증 도구/API의 서로 다른 SHA를 하나로 합치지 않는다.
Android 실제 폰·iPhone IPA/개발자 서명·스토어 제출은 아직 이 내부 전달 범위에 포함되지 않는다.
실제 폰 모델/OS와 기존 Apple Developer/Google Play 계정은 사용자 확인 대기 상태다.

Android는 위 APK를 선택한 기기에 설치하고 앱 ID `site.baro.app.preview`로 실행한다.
iOS ZIP은 Xcode Simulator 환경에서 아래와 같이 새 소유 기기에 설치할 수 있다.
`<runtime-id>`에는 `xcrun simctl list runtimes`로 확인한 사용 가능한 iOS runtime ID를 넣는다.
각 변수는 이번 설치에서 생성한 경로/기기만 가리킨다.

```sh
xcrun simctl list runtimes
baro_preview_dir="$(mktemp -d -t baro-preview)"
ditto -x -k "<ios-simulator-zip-path>" "$baro_preview_dir"
baro_preview_device="$(xcrun simctl create baro_internal_preview com.apple.CoreSimulator.SimDeviceType.iPhone-16 '<runtime-id>')"
xcrun simctl boot "$baro_preview_device"
xcrun simctl bootstatus "$baro_preview_device" -b
xcrun simctl install "$baro_preview_device" "$baro_preview_dir/BAROPreview.app"
xcrun simctl launch "$baro_preview_device" site.baro.app.preview
```

검토가 끝난 뒤에는 위에서 생성한 기기만 정리한다.

```sh
xcrun simctl shutdown "$baro_preview_device"
xcrun simctl delete "$baro_preview_device"
```

#397은 두 OS 내부 bundled 전달물과 초기 실행·설치 안내의 독립 인수다.
전체 #334와 실제 앱 native IO #385, 인증/역할/사용자 여정 #346/#354/#361/#369,
전체 UI/접근성·물리 기기 #379, 보안/최종 릴리스 #339/#71은 각각 남아 있다.

iOS 글자 확대의 후속 준비로 재검증 workflow는 실제 SDK의 `simctl help ui` 문서를 읽고
명시적으로 발견한 content_size 명령/알려진 category 식별자와 문서 hash만 별도 JSON에 남긴다.
사용자 기기 상태를 읽거나 변경하지 않으며 원문 도움말·runtime 로그·사용자 값은 업로드하지
않는다. 지원되지 않은 명령을 추측해 실행하지 않고 이 관측을 글자 확대/앱/접근성 성공으로
표시하지 않는다. 실제 category 설정·readback·앱 재시작/PNG 대조는 다음 관측으로 구분한다.
