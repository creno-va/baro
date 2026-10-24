# 내부 bundled Android preview (#397)

기존 development APK/Simulator ZIP은 Metro가 필요한 개발 앱이다. 이 문서의 Android
경로는 실제 Release 설정에서 JS/Hermes bundle을 APK에 포함하되 기존 Expo template의
공개 개발용 인증서만 사용하는 별도 내부 전달물이다. Google Play upload/store key를
생성하거나 바꾸지 않고 외부 업로드·공개 배포도 하지 않는다. 실제 원격 API가 필요한
기능을 offline 지원으로 표현하지 않는다. iOS bundled Simulator와 unsigned iPhone SDK의
별도 경로·인수 기록은 아래를 따른다. Simulator 서명은 실제 iPhone 설치·스토어 서명과 구분한다.

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

### 성공한 Android compiler 원본 재검증

새 [compiler40006344034](https://github.com/creno-va/baro/actions/runs/40006344034)/source171989e은 SUCCESS다.
[원본 receipt](../quality/mobile-internal-android-2026-10-23/receipt-171989e.json)를 그대로 보존한다.
APK57,133,550bytes/SHA256cd93c333e98f9f371c013197210a9a6ebc041f94bea9b5b56cc38da6ad9ffb42와
원본 receipt SHA2568b7877c75fb4ec2ab46fbb53b9dd7415026f6b27c375397c2d7995ab29a2b4d9를 독립 대조했다.
이것은 새 문구를 포함한 compile/metadata 인수이며 실제 설치/화면 인수는 별도다.

```sh
gh workflow run mobile-internal-android-compiled-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true -f large_font=true -f guide_ui=true -f public_directory=false
```

[성공한 compiler 입력](../../tests/fixtures/android-internal-preview.json)은 원본 run/path·successful
terminal 상태·source·artifact ID/name·receipt 전체 hash·APK 전체 bytes/hash에 묶는다.
새 경로는 bundled source 입력 동일성 뒤 실제 SDK signature/manifest·packaged HBC bytes/유일한 entry·
map 미포함·compiled font를 재검증하고 원본 receipt를 byte-identical로 복사한다. 현재 SDK 버전/인증서와
현재 health/시각은 별도 sidecar에 기록한다. graph는 고정 compiler receipt의 사실이며 새 생성 HBC를
비교하거나 source map을 재생성했다고 표시하지 않는다. 재컴파일/재서명도 하지 않는다.

기존 preserved inspection workflow/입력과 이전 실패는 보존한다. Home/Guide consumer는 두 종류의
strict metadata 결과 중 실제 선택한 하나만 검증하며 다른 source의 receipt/APK를 섞지 않는다.
원본 입력이 실패·진행 중인 compiler이거나 artifact 만료/변조·다른 SHA/workflow·파일 hash 불일치면
SDK/기기 단계 전에 거부한다. 새 경로의 실제 Emulator/Home/Guide 성공은 실행 후 인수한다.

### 수정된 source171989e의 실제 관측

PR423/mainb0da132·CI40008989427 뒤 [iOS40009294558](https://github.com/creno-va/baro/actions/runs/40009294558)은 SUCCESS다.
[metadata](../quality/mobile-internal-ios-2026-10-23/verification-b0da132.json),
[Home](../quality/mobile-internal-ios-2026-10-23/home-b0da132.json),
[확대](../quality/mobile-internal-ios-2026-10-23/large-font-b0da132.json),
[실제 Guide 조작](../quality/mobile-internal-ios-2026-10-23/home-ui-b0da132.json)을 원본 그대로 보존한다.
iPhone16/iOS26.5의 Home 두 PID는 각3표본/55·20초, 확대 재시작은3표본/21초다.
XCTest는 최대 category를 전후 읽고 Home5회/Guide6회 scroll, 화면 안의 hit 가능한 버튼 tap·교정된
자료/리포트 안내·Guide 진입/복귀를 확인했다. Swift/Ruby source 전체 hash도 실제 결과와 대조했다.

[별도 PNG 대조](../quality/mobile-internal-ios-2026-10-23/visual-home-large-b0da132.json)는 한글 Home/확대 초기
viewport만 직접 확인했다. Guide pixel은 캡처/대조하지 않았으며 조작/교정 문구의 증거는 XCTest다.
전체 역할/화면·키보드/회전·VoiceOver·physical/store·실제 API/OAuth를 인수한 것은 아니다.
이전 ff5c208의 관측과 CLI exit64 실패는 그대로 보존하며 새 성공을 이전 실패의 확정 원인 증거로 쓰지 않는다.

PR425/maindd3e84e·CI40011219285 뒤 [Android40011547920](https://github.com/creno-va/baro/actions/runs/40011547920)은
SDK metadata와 [원본 receipt 유지](../quality/mobile-internal-android-2026-10-23/verification-dd3e84e.json),
[Home](../quality/mobile-internal-android-2026-10-23/home-dd3e84e.json)·[font2](../quality/mobile-internal-android-2026-10-23/large-font-dd3e84e.json)를
보존한 뒤 Guide의 마지막 receipt 생성 단계에서 terminal FAILURE다.
[원본 실패](../quality/mobile-internal-android-2026-10-23/failure-ui-dd3e84e.json)의 마지막 고정 관측은 Home 복귀 상태다.
새 SDK37.0.0 signature/manifest/HBC/font 재검증과 원본 receipt byte 일치는 별도 성공 사실이며
Guide 전체 성공으로 확대하지 않는다. [PNG 대조](../quality/mobile-internal-android-2026-10-23/visual-home-large-dd3e84e.json)도 초기 Home/확대만 확인했다.

생성 객체에서 필수 screenshotsSuppressedBeforeNavigation 필드가 빠진 코드 오류를 확인했다.
첫 이동 전 실제 guard 상태를 기록하고 생성 객체에 strict schema의 TypeScript input 검사를 적용한다.
향후 proof 검증 실패는 허용된 최상위 필드명만 기록하며 입력 값/원문 hierarchy는 내보내지 않는다.
기존 실패/시각은 바꾸지 않고 교정된 source의 새 actual 실행으로 최종 Guide 결과를 인수한다.

PR426/main346c920·CI40013909663 뒤 [Android40014252649](https://github.com/creno-va/baro/actions/runs/40014252649)은
terminal SUCCESS다. [SDK metadata](../quality/mobile-internal-android-2026-10-23/verification-346c920.json),
[Home](../quality/mobile-internal-android-2026-10-23/home-346c920.json),
[font2](../quality/mobile-internal-android-2026-10-23/large-font-346c920.json),
[완전한 Guide proof](../quality/mobile-internal-android-2026-10-23/guide-ui-346c920.json)를 원본 그대로 보존했다.
Android15/sdk_gphone64_x86_64의 OS scale을 전후2로 읽고 Home/Guide 각1회 scroll·고정 버튼 tap·
교정 문구·Home 복귀/Guide 사라짐을 확인했다. 첫 이동 전 캡처 차단·이후 PNG 미수출·Metro0다.

Guide proof의 APK bytes/hash·binary/tooling/device·baseline 및 metadata 전체 hash를 별도로 대조했다.
원본 compiler receipt도 byte-identical다. [PNG 시각 대조](../quality/mobile-internal-android-2026-10-23/visual-home-large-346c920.json)는
초기 Home/확대만 확인하며 Guide pixel 대조와 전체 UI/접근성·실제 API/OAuth·physical/store를 주장하지 않는다.
이전 dd3e84e의 final receipt 실패는 수정하지 않고 성공한 새 실행으로 독립 #424를 인수한다.
같은 앱 source171989e의 두 OS 내부 전달/익명 Home·확대·안내 조작을 인수하며 전체 #334/#379는 OPEN이다.

## 내부 전달 기준과 설치

| 전달물 | 앱 source·version/build | binary metadata | 실제 설치/초기 Home 관측 |
| --- | --- | --- | --- |
| Android APK | 171989e / 0.1.0·1 | minimum API24, arm64-v8a/x86_64, embedded HBC, 공개 template development certificate | Android15 Emulator / tooling346c920·40014252649의 Home/font2/Guide 왕복·교정 문구·Metro0·초기 PNG 대조. 이전 dedcd0e 공개 ready-empty/실패 기록 유지 |
| iOS Simulator ZIP | 171989e / 0.1.0·1 | minimum iOS16.4, arm64/x86_64, embedded HBC, No-Team Simulator ad-hoc | iPhone16/iOS26.5 Simulator / toolingb0da132·40009294558, 두 cold launch·최대 글자/Guide 왕복·교정 문구·Metro0·초기 PNG 대조 |

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
local native IO #385도 독립 인수를 완료했다. 전체 #334와 인증/역할/사용자 여정 #346/#354/#361/#369,
전체 UI/접근성·물리 기기 #379, 보안/최종 릴리스 #339/#71은 각각 남아 있다.

별도 SDK documentation step은 실제 SDK의 `simctl help ui` 문서를 읽고
명시적으로 발견한 content_size 명령/알려진 category 식별자와 문서 hash만 별도 JSON에 남긴다.
사용자 기기 상태를 읽거나 변경하지 않으며 원문 도움말·runtime 로그·사용자 값은 업로드하지
않는다. 지원되지 않은 명령을 추측해 실행하지 않고 이 관측을 글자 확대/앱/접근성 성공으로
표시하지 않는다. 위의 실제 category 설정·readback·앱 재시작/PNG/조작 결과와 SDK 문서 JSON만의 범위를 구분한다.

## iOS OS 접근성 검사 (#379)

`accessibility_audit=true`는 위 iOS 수동 재검증 workflow에서 `smoke`, `large_font`,
`ui_test`가 모두 true일 때만 허용한다. 로컬 인수된 source171989e 원본 Simulator 앱을
재컴파일/재서명하지 않고 별도 XCTest runner로 홈/이용 안내의 초기/행동 viewport 네 곳을 검사한다.
Apple의 [공개 XCTest API](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/performaccessibilityaudit(for:_:))로
대비·Dynamic Type·요소 탐지·조작 영역·설명·글자 잘림·traits를 요청한다.
내부 명령은 `--home --large-font --ui-test --accessibility-audit`이며 순서/선행 옵션을 생략할 수 없다.

XCTest issue handler는 원문 element 설명/첨부를 고정 분류·개수로 대체한다.
보고된 모든 issue는 집계하며 알 수 없는 항목도 `other`로 보존한다. `accessibility-audit.json`은
네 viewport와 요청한 일곱 검사, 각 집계와 전체 합계·성공 판정을 검증하고 원본 binary/tooling,
runner hash·기기·최대 category 전후 readback을 같은 실행의 Home/Guide proof에 묶는다.
문제가 하나라도 있으면 결과 파일을 먼저 저장한 뒤 workflow를 실패로 끝낸다.
raw hierarchy/element label/xcresult·private runner 로그는 artifact allowlist에 없다.

이 경로의 준비/합성 회귀는 OS 검사 성공이 아니다. 실제 수동 실행 뒤 고정 결과와 실패를
보존하고 앱 문제를 수정한다. 검사 통과도 전체 화면/기능·VoiceOver 실제 조작·Android TalkBack·
회전/키보드·물리 기기 인수를 대신하지 않는다. [Apple의 검사 범위와 한계](https://developer.apple.com/documentation/accessibility/performing-accessibility-audits-for-your-app)를 따른다.
실제 OAuth/역할/동의·원격 private 여정·스토어와 #334/#379/#339/#71은 별도다.

### 실제 OS 검사 결과 (2026-10-24 KST)

[PR429](https://github.com/creno-va/baro/pull/429)의 exact head
`1c1279a6a3250cc2fc7400d7034ab5cb039a215c`는 [CI40019931865](https://github.com/creno-va/baro/actions/runs/40019931865)가 성공했고,
정상 병합한 main `90a2f58a0d928d35e85c7cc9d094feecff85c8d7`도
[CI40020277557](https://github.com/creno-va/baro/actions/runs/40020277557)이 성공했다.
그 정확한 도구 SHA의 [실제40020635912](https://github.com/creno-va/baro/actions/runs/40020635912)는 SUCCESS이며,
원본 앱 source171989e·compiler40006340014·ZIP24,102,101bytes/hash와 compiler receipt 전체 hash를 재검증했다.
앱 입력 동일성·양 ABI metadata/HBC/font·SDK signing 재확인은 [별도 metadata 관측](../quality/mobile-internal-ios-2026-10-23/verification-90a2f58.json)에 보존한다.
Simulator 앱은 여전히 No-Team/ad-hoc 원본이고 앱 재컴파일·재서명이나 배포는 없었다.

- iPhone16/iOS26.5의 익명 fresh Simulator에서 [기본 두 cold launch](../quality/mobile-internal-ios-2026-10-23/home-90a2f58.json)는73/19초·각 PID3표본,
  [최대 글자 크기](../quality/mobile-internal-ios-2026-10-23/large-font-90a2f58.json)는 category 설정/readback·재시작/재readback·20초/PID3표본이었다.
- [일반 XCTest 조작](../quality/mobile-internal-ios-2026-10-23/home-ui-90a2f58.json)은 Home4/Guide6 scroll·완전히 hittable한 버튼 tap·현재 기능 설명·Home 복귀를 확인했다.
  OS 감사의 화면 변경 영향과 분리된 별도 테스트다. Metro 시작/요청은0이었다.
- [OS audit 원본](../quality/mobile-internal-ios-2026-10-23/accessibility-90a2f58.json)은2026-10-23T20:46:30.395Z 관측이다.
  최대 category 전후 readback과 같은 runner/device identity를 일반 UI proof에 묶고,
  Home 초기/행동·Guide 초기/행동의 네 viewport에서 대비·Dynamic Type·요소 탐지·조작 영역·설명·잘림·traits를 요청했다.
  네 결과 모두 completed=true·보고 issue0/findings=[]이며 전체 합계0·auditPassed=true다.
  raw hierarchy/xcresult는 내보내지 않았고 알려지지 않은 issue를 버리는 필터는 없다.
- Swift driver hash는`82e4d0b2150a2b964bd05ccc6179a5980db0b5f454d526938bd9dc2f93c81ffb`,
  generator는`c40739496c11c52dbb15844b1f4143fdb5112be4e43bebea2e8a6b8074473a18`/xcodeproj1.28.1이다.
  감사 JSON의 원본 hash는`1939a3cf309c8ec36c04cf08da5220fd60bbf9a926e8f83d57d0342ddbe6e6f2`다.
- [Home/확대 PNG 실물 대조](../quality/mobile-internal-ios-2026-10-23/visual-home-large-90a2f58.json)는 별도 관측이다.
  정상 Home/한글 카드와 확대·줄바꿈을 보았고 두 파일 전체 byte/hash를 대조했다.
  최대 크기의 제목이 초기 viewport를 크게 차지하는 사실과 Guide pixel 미대조를 보존한다.

자동 검사는 이 네 viewport의 보고 결과만 인수한다. 중간 scroll 위치나 모든 화면을 검사했다고
추정하지 않으며 이 결과로 전체 접근성/VoiceOver 실제 조작을 완료 처리하지 않는다.
Android TalkBack·키보드/회전·물리 기기·모든 역할/상태·실제 OAuth/private API와
store/#334/#379/#339/#71은 OPEN이다. 원본 metadata/기본/확대 proof의 포괄적인
`accessibilityVerified=false`를 바꾸지 않고 OS 감사의 좁은 결과를 별도로 보존한다.

## iOS 비로그인 시스템 브라우저 취소 (#346)

iOS 수동 재검증 workflow의 `auth_cancel=true`는 `smoke=true`만 함께 허용하고
`large_font`, `ui_test`, `accessibility_audit`와는 함께 실행하지 않는다.
명령은 `--home --auth-cancel`이다. 기본 Home 관측 뒤 원본 source171989e 앱의
실제 로그인 화면에서 Google/Naver/Kakao 버튼을 각각1회 누르고 시스템 WebView·hittable한 네이티브 닫기 컨트롤,
취소 뒤 비로그인 UI·오류/동의 상태 부재와 마지막 cold restart 뒤 비로그인 상태를 검사한다.
기존 독립 XCTest runner target을 사용하며 앱은 재컴파일/재서명하지 않는다.

테스트는 fresh owned Simulator와 기존 ephemeral system browser 경로만 사용한다.
알려진 BARO domain의 OS Continue prompt가 있으면 한 번 처리하고,
제공자 계정 선택·비밀번호/코드 입력·로그인 제출·약관 동의는 수행하지 않는다.
WebView 존재는 제공자 페이지의 client 설정 수용이나 실제 OAuth 성공을 뜻하지 않는다.
실제 callback/교환·SecureStore pending 삭제의 직접 계측·두 역할/동의·실기기 인수는 별도다.

호스트는 인증 진입 **전** 명시적 screenshot 명령과 raw command log 저장을 되돌릴 수 없게 차단한다.
원본 XCTest 출력은 메모리에서 고정 provider/stage/assertion·알려진 UI 상태 boolean만 대조한다.
SDK가 만든 private runner build/xcresult는 성공/실패 모두 소유 임시 폴더에서 제거하며 업로드하지 않는다.
이는 OS 내부가 일시적 진단 자료를 생성하지 않는다는 주장이 아니다.
artifact는 기존 인증 전 Home PNG/receipt와 `auth-cancel-ui.json` 또는 고정 `failure.json`만 허용한다.
URL·cookie·state·토큰·계정/원문 화면은 내보내지 않는다.

세 제공자의 표시/취소/복귀와 cold 상태가 모두 확인된 단일 strict 결과만 성공으로 인정한다.
source/tooling/compiler ZIP/receipt·기기 identity는 같은 실행의 Home baseline과 묶는다.
현재 닫기 컨트롤은 인증 전 없었던 고정 `Cancel`의 유일하고 완전히 hittable한 query를 사용한다.
[공개 descendant query](https://developer.apple.com/documentation/xcuiautomation/xcuielement/descendants(matching:))로
현재 WebView1~8개와 keyboard0~8개를 모두 조회하고, 그 어느 button 하위 query에도 `Cancel`이
없어야 한다. 관측한 수/실제 조회 수 일치·모든 query 완료·WebView/keyboard Cancel count0과
application Cancel1을 strict `cancelOwnership`으로 요구한다. 고정 label 일치 count만 읽으며
브라우저의 실제 label/value·snapshot/hierarchy·URL은 내보내지 않는다.
foreground/window/가시 WebView·인증 전 부재/hittability도 계속 확인한다.
이 조건을 통과한 `native-query-exclusion` scope만 선택하고 Done/Close·무제한 application
scope를 취소로 선택하지 않는다. WebView frame 겹침은 실제 boolean으로 유지한다.
app/window snapshot의 전체성을 가정하지 않으며 다음 실제 검증 전 성공을 표시하지 않는다.
단일 결과 누락/중복, 부분 제공자, raw 값 또는 OAuth 성공으로의 확대는 거절한다.
준비/합성 회귀는 실제 통과가 아니며 exact main CI 뒤 수동 실행 결과를 인수한다.
기존 실제 OS audit·전체 기기/VoiceOver/TalkBack·계정 인증/역할/동의·store/#334/#346/#339/#71은 보존한다.

### 첫 실제 취소 검사 실패와 닫기 컨트롤 수정

[실제40025525181](https://github.com/creno-va/baro/actions/runs/40025525181)는 tooling
`8480fa6cdc7da56d90814bf572f262bfcf40d381`에서 FAILURE였다.
[원본 실패](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-8480fa6.json)는
Google/provider-tapped 뒤 `BARO_AUTH_SYSTEM_CANCEL_MISSING`, xcodebuild65/timedOut=false다.
Swift compilation/signing/runner launch 분류는 false이며 성공한 취소/복귀 proof는 없다.
코드 순서상 WebView 존재 검사를 지난 뒤지만 당시 실제 닫기 label/scope·hittability는
기록되지 않아 정확한 원인은 확정하지 않는다. 제공자 로그인 성공/실패로 해석하지 않는다.

[같은 실행의 Home](../quality/mobile-internal-ios-2026-10-23/auth-cancel-home-8480fa6.json)과
[metadata](../quality/mobile-internal-ios-2026-10-23/auth-cancel-verification-8480fa6.json)를 따로 보존했고,
compiler receipt/ZIP 전체 hash·source171989e/8480fa6 bundled parity를 독립 재검증했다.
실패 JSON 원본 hash는`6328e6791eb62e90aff9ed3a28f7948f865116043015f883cf7853ea5b9c938b`이다.
현재 실패는 이전 정상 Home/Guide OS audit40020635912를 취소하지 않으며 auth 인수는 OPEN이다.

기존 테스트의 전역 `Cancel` 단일 이름 가정을 제거한다.
[Apple의 Safari dismiss 종류](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller/dismissbuttonstyle-swift.enum)와
[navigation bar 설명](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller/dismissbuttonstyle-swift.property)에
맞춰 고정 종류와 native bar 범위를 조회하고 선택 종류/범위를 결과에 남긴다.
없거나 모호하면 known category/count/hittability·web 제외 boolean만 기록하고 실패한다.
이 변경은 실제 style이 Close였음을 입증하지 않으며 새 SDK 실행 전 성공으로 표시하지 않는다.
같은 실패 조건을 그대로 재실행하지 않고 변경한 컨트롤 선택 조건을 exact CI/main 뒤 검증한다.

### native bar 선택 조건의 실제 실패

PR433/main`6825328f4e7896cbd4a6d469371deec034764263`·CI40029042232 뒤
[actual40029347550](https://github.com/creno-va/baro/actions/runs/40029347550)도 FAILURE다.
[원본 고정 진단](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-6825328.json)은
Google/browser-presented·systemWebViewVisible=true 뒤 `BARO_AUTH_SYSTEM_DISMISS_MISSING`,
xcodebuild65/timedOut=false를 기록한다. navigation-bar/toolbar의 세 종류 후보는 모두0개다.
application 범위의 Cancel은1개/fullyHittable=true/동일 label web button 중첩 제외=true였으나
진단 전용이므로 누르지 않았다. 이 boolean은 모든 WebView frame과의 분리를 입증하지 않는다.
취소·비로그인 복귀·다른 두 제공자 및 실제 OAuth 성공은 인수하지 않는다.
원본 실패 JSON SHA256은`d34f75a2e6d97f34d9a548eac74f2ec96bef450cfd4e3aa30c08a1d27bf87184`다.
다음 수정은 실제 관측된 browser 구조에서 안전한 컨트롤 범위를 검증한 뒤 진행하며,
이전 실패와 원본 앱171989e·독립 Home/Guide 접근성 성공은 보존한다.

후속 `codex/346-ios-webview-separated-dismiss`는 이 실패에서 새롭게 관측한 application Cancel을
위의 인증 전 부재·전체 WebView frame 분리·foreground window·unique/hittable 조건으로 검증한다.
기존 native bar 후보도 같은 강화 조건을 통과해야 한다. 고정 실패 진단은 geometry/인증 전 부재
boolean을 추가하되 실제 frame·label·URL·hierarchy·계정 화면은 내보내지 않는다.
새 scope를 허용했다는 이유만으로 성공으로 표시하지 않으며 exact CI/main 뒤 실제 실행으로
취소·익명 복귀·cold restart를 모두 확인해야 한다. 이전 원본 JSON을 새 schema에 맞춰 고치지 않는다.


### 실제 frame 분리 실패와 snapshot 소속 검증

PR435/mainca8ea4f·CI40032746542 뒤 [actual40032994784](https://github.com/creno-va/baro/actions/runs/40032994784)는 FAILURE다.
[원본 실패](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-ca8ea4f.json)는
Google/browser-presented·WebView/window geometry=true, 인증 전 없었던 Cancel1개/hittable=true,
모든 WebView frame 제외=false와 `BARO_AUTH_SYSTEM_DISMISS_MISSING`를 기록한다. native toolbar의
Done1개도 hittable/영역 제외=false였으며 실제 소속/용도는 확정하지 않았다. 어느 것도 누르지 않았다.
원본 실패 SHA256은`5da554e4b8c68c0caf6376e6c7d371bebf19e18bc3831c523f57d839866893b5`다.
[Home](../quality/mobile-internal-ios-2026-10-23/auth-cancel-home-ca8ea4f.json)와
[metadata](../quality/mobile-internal-ios-2026-10-23/auth-cancel-verification-ca8ea4f.json)를 따로 보존했다.
원본 Simulator ZIP/receipt의 고정 byte/hash와 제품 입력 동일성을 독립 재대조했다.

화면 frame의 중첩은 접근성 부모 관계가 아니다. 후속 `codex/346-ios-snapshot-dismiss`는 위의
공개 snapshot에서 native Cancel의 실제 조상을 확인한다. WebView/keyboard 하위는 통째 제외하고
다른 toolbar Done을 인증 취소로 해석하지 않는다. 모든 기존 실패·원본 앱/독립 audit는 보존하며,
새 조건의 actual runner compile/세 제공자 취소·익명 복귀/cold restart 전에는 성공으로 기록하지 않는다.

## iOS 실기기 SDK의 서명 없는 컴파일 사전 검사 (#334)

현재 Simulator ZIP과 별개로 `mobile-ios-device-sdk.yml` 수동 workflow를 제공한다.
PR434/main87dec15·CI40032179484 뒤 실제40032490751은 SUCCESS이며 아래 범위로 인수했다.
성공한 main CI의 full40 SHA에 한해 다음처럼 요청한다.

```sh
gh workflow run mobile-ios-device-sdk.yml --ref main -f target_sha=<full40-main-sha>
```

fresh 소유 checkout에서 같은 Expo 제품 entry·공통 패키지를 생성하고 `Release`/`iphoneos`/
`generic/platform=iOS`/`arm64`로 컴파일한다. 서명·team·profile을 명시적으로 끄고 provisioning
updates·계정 접근·설치·archive/export/submit은 요청하지 않는다. Simulator의 entitlement/서명
보정 도구는 호출하지 않으며 기존 Simulator compiler/receipt를 수정하지 않는다.
child 환경은 preview와 도구에 필요한 OS 항목만 전달하고 credential·dotenv·bundle entry/SDK/서명
override를 거절한다. Metro cache·private source map·전체 도구 로그는 소유 임시 경로에 한정한다.

실제 Info.plist의 preview ID/scheme·최소 iOS16.4·iPhoneOS·iPhone/iPad·폰트를 검사한다.
실행 파일의 Mach-O header/load commands에서 thin arm64 executable·LC_BUILD_VERSION의 iOS
platform2·최소 OS와 실제 CLI SDK 일치를 확인하고 Simulator/Catalyst·LC_CODE_SIGNATURE를 거절한다.
기본 앱 서명이나 provisioning profile·키·source map이 포함되면 ZIP을 내보내기 전에 실패한다.
생성/앱/ZIP Hermes bytes와 private map의 실제 제품 graph·compiled font/license를 대조한다.
whole ZIP byte/hash와 source/SDK를 별도 strict receipt에 기록한다. 실패 시 고정 phase/code만
보존하며 전체 build log/xcresult/private map을 artifact에 포함하지 않는다.

출력 이름은 `baro-ios-device-sdk-unprovisioned-<sha>.zip`이다. 이는 설치 가능한 IPA가 아니며
receipt의 installation/runtime/physical/OAuth/store signing/submission/deployment는 모두 false다.
컴파일 가능한 target 여부와 실제 기기 실행·계정/서명·스토어 인수를 구분한다.
[Apple의 기기 실행 안내](https://help.apple.com/xcode/mac/current/en.lproj/dev5a825a1ca.html)와
[Expo의 local build 안내](https://docs.expo.dev/guides/local-app-overview/)에 따라 실제 기기 실행의
서명/provisioning 검증은 별도다. 개발자 계정과 기기 모델/OS는 사용자 확인 대기이며 부재로
단정하지 않는다. 웹 UI·제품/공통 계약·서버와 #334/#346/#339/#71의 전체 인수는 유지한다.


### 실제 iPhone SDK 컴파일 인수 범위

[actual40032490751](https://github.com/creno-va/baro/actions/runs/40032490751)는 source
`87dec1597b5f2d8766c349d09b974303d11f68d8`의 원본
[receipt](../quality/mobile-ios-device-sdk-2026-10-24/receipt-87dec15.json)와
[inspection](../quality/mobile-ios-device-sdk-2026-10-24/inspection-87dec15.json)을 남겼다.
관측 시각은2026-10-23T22:30:33.500Z이며 원본 receipt SHA256은
`bf3f71fc097ef475fa96e75b1f29b17faba41ddfa184d77ed92fa65d5aca4bde`다.
ZIP13,808,079bytes/SHA`9275ce0e0ac442b31c70397afac01285860e4f1ecfdd133dac28be518419b491`와
unaccepted 원본이 byte-identical임을 확인했다. 실제 ZIP에서 plist·thin arm64 executable의
platform iOS/SDK26.5/min16.4·서명 load command 부재, HBC3,581,976bytes/
SHA`17a2d185d2b6392668092d7b2f8db6481c604bd55553005c863e193a382ff1b5`, 폰트/OFL을 다시 읽어 대조했다.
키/profile/source map/루트 서명 부재도 독립 검사했으며
[재검사 범위](../quality/mobile-ios-device-sdk-2026-10-24/reinspection-87dec15.json)를 별도로 보존했다.
private source map/제품 graph는 재생성하지 않았고 그 graph 증거는 원본 compiler receipt의 것이다.
로컬 전달물은 `.wrangler/mobile-delivery/87dec15/ios-device-sdk/`에 보존했다.
이는 실기기 SDK 컴파일의 좁은 인수이며 설치/앱 실행·실제 폰·Apple 계정/서명·store 인수가 아니다.

## Android 비로그인 Custom Tab 취소 (#346)

`mobile-internal-android-compiled-reverify.yml`의 `smoke=true`/`auth_cancel=true`는 기존 확대·Guide·
공개 탐색 mode와 함께 실행하지 않는다. 원본171989e APK/compiler/receipt와 tooling source의
제품 입력 동일성·실제 SDK metadata/HBC/font를 먼저 확인하고 fresh owned Emulator의 두 cold
Home 실행을 관측한다. 인증 전 Home PNG/receipt는 유지하며 그 뒤 캡처를 비가역 차단한다.

실제 BARO package의 enabled/clickable·고정 exact label·유일하고 viewport 안에 있는 앱 버튼만
선택해 로그인 화면과 Google/Naver/Kakao를 각각 한 번 연다. raw XML과 activity dump는 메모리에서만
해석하고 장치 임시 XML은 각 읽기 후 삭제한다. Chrome의 정확한 CustomTabActivity가 foreground인지,
고정 native `close_button` ImageButton이 유일하고 모든 WebView frame 밖에 있는지 확인한다.
그 조건을 통과해야 시스템 `KEYCODE_BACK`을 한 번 보내며 Chrome의 페이지 버튼을 누르지 않는다.
[Android Custom Tabs 안내](https://developer.android.com/develop/ui/views/layout/webapps/overview-of-android-custom-tabs)와
[Chromium의 native toolbar 구현](https://chromium.googlesource.com/chromium/src/+/7d71422e2724a49c144465b5e0880318f634a99b/chrome/android/java/src/org/chromium/chrome/browser/customtabs/features/toolbar/CustomTabToolbar.java)을
대조했으며 실제 runner의 browser/package/UI가 다르면 검사 실패로 남긴다.

Chrome 미설치·첫 실행 화면·다른/모호한 foreground와 native control/geometry 부재를 정상 취소로
대체하지 않는다. browser 첫 실행 약관·계정/비밀번호/코드·제공자 로그인/동의 버튼은 조작하지 않는다.
시작·취소 뒤 BARO의 익명 gate·오류/동의/로그인 상태 부재와 실제 foreground 복귀, 세 제공자 후
force-stop/relaunch·Home에서 다시 익명 gate를 확인해야 단일 strict proof를 만든다.
원본 APK/verification/Home receipt의 전체 hash·tooling/binary source·같은 Emulator identity에 묶는다.
인증 이후에는 failure 경로를 포함해 screencap/screenrecord/bugreport/logcat을 거절한다.
adb stdout/stderr·raw XML/dump·URL/state·계정 화면/텍스트를 artifact에 남기지 않고 실패는 고정
stage/provider와 상태 boolean만 내보낸다. 소유 Emulator와 AVD/cache만 정리한다.

허용 artifact는 인증 전 Home PNG/receipt와 별도 `auth-cancel-ui.json` 또는 고정 `failure.json`이다.
구현/합성과 실제 성공을 구분하며 exact CI/main 뒤 수동 실제 결과 전 성공을 표시하지 않는다.
Custom Tab 표시/취소는 제공자 설정 수용·계정 로그인·callback/교환·SecureStore pending 삭제의
직접 계측이 아니다. 실제 계정·두 역할/필수 동의/challenge·cold/warm 인증 복귀·물리 기기/store와
Apple 공급자 방향 결정·#334/#346/#339/#71은 별도 인수로 남긴다. 웹 UI/앱·서버·공통 계약은 바꾸지 않는다.

### Android 첫 진입의 compiler 경로 오류

PR436/main21213cb·CI40034599325 뒤 [actual40034804614](https://github.com/creno-va/baro/actions/runs/40034804614)는
구형 inspection workflow에서 실행돼 [bundled-input-parity 실패](../quality/mobile-internal-android-2026-10-23/auth-cancel-input-failure-21213cb.json)로 끝났다.
이는 기존 dedcd0e 입력과 현재171989e 제품 입력이 다른 것을 정상 거절한 것으로, Emulator·브라우저·
취소 단계에 도달하지 않았다. 현재 성공한 compiler의 원본171989e APK/receipt를 사용하는
`mobile-internal-android-compiled-reverify.yml`로 auth_cancel 입력/격리 조건/결과 경로를 옮긴다.
legacy fixture·parity/서명/HBC/font·성공한 compiler provenance gate는 완화하지 않는다.
구형 workflow의 auth_cancel 입력은 제거하고 합성 검사는 실제 compiler script 연결도 확인한다.
같은 실패 경로를 재실행하지 않으며 정확한 새 main CI 뒤 올바른 compiler 입력으로 실제 실행한다.

### 현재 두 OS의 브라우저 준비/소속 관측

PR437/main9dbb2ee·CI40035594827 뒤 Android
[actual40035889527](https://github.com/creno-va/baro/actions/runs/40035889527)은 원본171989e APK/receipt·
SDK metadata/HBC/font와 두 cold Home를 통과한 뒤 Google 진입의 Chrome FirstRunActivity에서 멈췄다.
[고정 실패](../quality/mobile-internal-android-2026-10-23/auth-cancel-browser-failure-9dbb2ee.json)는
chromeFirstRunForeground=true, Custom Tab/native close/geometry=false, 캡처 차단=true다.
[Home](../quality/mobile-internal-android-2026-10-23/auth-cancel-home-9dbb2ee.json)와
[metadata](../quality/mobile-internal-android-2026-10-23/auth-cancel-verification-9dbb2ee.json)를 별도 보존했다.
첫 실행을 취소 성공으로 바꾸지 않으며 native Custom Tab 취소/익명 복귀는 인수하지 않았다.

후속 fixture는 fresh owned CI Emulator의 serial/AVD/살아 있는 소유 process와 userdebug/eng를
요구하고 기존 command line 파일을 거절한다. preinstalled Chrome 버전을 숫자로 읽고 force-stop 후
정확히 `_ --disable-fre` 한 줄만 shell stdin/tee로 설정한다. 직접 byte readback과 실제 관측 후 파일
삭제/부재를 검증해야 strict receipt를 반환한다. 인증 전 screenshot/raw-log 차단은 계속 적용한다.
[Chromium 공개 초기화 코드](https://chromium.googlesource.com/chromium/src/+/main/base/android/java/src/org/chromium/base/CommandLineInitUtil.java)의
userdebug/eng command line 지원과
[공식 Android 디버깅 안내](https://chromium.googlesource.com/chromium/src/+/main/docs/android_debugging_instructions.md)의
테스트 switch를 사용한다. root/debug-app/global 설정·TLS/web-security·계정은 바꾸지 않고
첫 실행/약관·제공자 계정/동의 버튼을 누르지 않는다. flag가 적용되지 않거나 다른 UI면 기존 기준으로 실패한다.
자동화 fixture의 실제 Chrome 버전·단일 switch/hash·읽기·파일 삭제 확인과
consumerFirstRunVerified=false를 성공 proof/해당 실패의 별도 필드에 남긴다. 실제 사용자 기기의
Chrome 초기 설정이나 실제 OAuth 성공을 이 fixture로 인수하지 않는다.

같은 source의 iOS [actual40035878294](https://github.com/creno-va/baro/actions/runs/40035878294)도 실패다.
[고정 원본](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-9dbb2ee.json)은
Google/browser-presented·query WebView/window geometry=true·Cancel1/hittable=true이나 app root
snapshot에서 webViewObserved=false/nativeCancelCount0을 기록한다. root가 완전히 비었거나
특정 OS service 소유라는 원인은 아직 입증하지 않았다. 아무것도 누르지 않았고 취소/복귀는 미인수다.
[Home](../quality/mobile-internal-ios-2026-10-23/auth-cancel-home-9dbb2ee.json)와
[metadata](../quality/mobile-internal-ios-2026-10-23/auth-cancel-verification-9dbb2ee.json)를 따로 보존했다.
후속은 app뿐 아니라 현재 app window의 공개 snapshot을 각각 검사하고, 실제 WebView·유일 native
Cancel·WebView/keyboard 조상 제외·query/frame 일치가 입증된 root만 허용한다. scope/검사 node 수와
고정 aggregate count를 남기며 raw snapshot/URL/계정 화면은 내보내지 않는다. generic global 버튼
탭·임의 좌표나 private API로 대체하지 않는다. 두 OS 새 조건의 exact CI/main·실제 실행 전 성공을
주장하지 않고 실제 계정/기기/store·Apple 방향 결정과 전체 gate를 보존한다.

### Android 실제 세 제공자 취소·익명 복귀 인수

[actual40038397811 attempt2](https://github.com/creno-va/baro/actions/runs/40038397811/attempts/2)는
source`318df0c131b7ffaf794300c128d69ad168bdb8e5`에서 SUCCESS다.
attempt1은 앱 재검증 뒤 SDK system-image ZIP 읽기 오류로 멈춰 Emulator/Chrome fixture/auth에
도달하지 않았다. [고정 installer 실패](../quality/mobile-internal-android-2026-10-23/auth-cancel-sdk-failure-318df0c-attempt1.json)를
보존하고 손상된 임시 설치물이 없는 새 hosted VM에서 한 번만 재실행했다.
[GitHub의 hosted VM 조건](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)을
확인했으며 관측 timeout 때문의 재시작이 아니다. 새 실행은 SDK 준비와 모든 후속 검사를 통과했다.

[원본 취소 proof](../quality/mobile-internal-android-2026-10-23/auth-cancel-ui-318df0c.json)의 관측 시각은
2026-10-23T23:26:38.916Z이고 SHA256은
`3c79491debc8103e722de5e9ae83630d1fe052b829400dd15ed6ced4a37fd8a3`다.
같은 실행의 [Home baseline](../quality/mobile-internal-android-2026-10-23/auth-cancel-home-318df0c.json)과
[metadata](../quality/mobile-internal-android-2026-10-23/auth-cancel-verification-318df0c.json)의 전체 hash/
원본171989e APK57,133,550bytes·receipt·같은 Android15 Emulator identity를 독립 대조했다.
Google/Naver/Kakao 각각 anonymous UI·실제 Chrome CustomTabActivity·WebView/native close의
geometry 제외·시스템 BACK1회·앱 foreground/익명 복귀·오류/동의 부재와 마지막 force-stop/relaunch
뒤 익명 상태를 확인했다. Chrome124.0.6367.219/userdebug·단일 --disable-fre readback·파일 삭제가
기록됐고 root/debug-app/global·TLS/web-security·계정/동의 UI 변경은 없었다.
consumerFirstRunVerified/accountLoginPerformed/callbackExchangeVerified/providerAcceptanceVerified/
oauthVerified/physicalDeviceVerified는 모두 false다. 실제 계정 로그인·SecureStore pending 삭제의
직접 계측·물리 기기/현재 소비자 browser·전체 OAuth/스토어 인수로 확대하지 않는다.

### iOS snapshot 범위 실패와 query 제외 검증

같은 source의 [actual40038388554](https://github.com/creno-va/baro/actions/runs/40038388554)는 FAILURE다.
[원본](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-318df0c.json)은 Google query에서
WebView/새 Cancel이 보이고 hittable/geometry=true이지만, app snapshot66개 node·window3개/
최대62개 node에서 WebView/native Cancel을 찾지 못한 사실을 남겼다. 원본 SHA256은
`6b48d52e01bef71fdd336e5f6fefad17c9816d986bff7a4dce1702bf87c1bdbc`다.
[Home](../quality/mobile-internal-ios-2026-10-23/auth-cancel-home-318df0c.json)와
[metadata](../quality/mobile-internal-ios-2026-10-23/auth-cancel-verification-318df0c.json)를 별도 보존했고
원본 ZIP/receipt byte/hash·bundled input 동일성을 독립 대조했다. 아무것도 누르지 않았으며
취소/복귀는 미인수다. 특정 OS service 소유나 snapshot 원인을 추정으로 확정하지 않는다.

후속은 전체 snapshot을 선택 근거로 삼는 코드를 제거하고 위의 직접 descendant query 제외를
사용한다. 유일 새 Cancel이 실제 WebView/keyboard button 하위에 없다는 것을 현재 query로 확인하고
frame 겹침을 조작하지 않는다. 기존 foreground/hittability·세 제공자 취소/익명 복귀·cold restart·
privacy latch는 유지한다. 이전 snapshot/count 원본을 새 schema로 고치지 않으며 exact CI/main 뒤
바뀐 query 조건을 실제 검증한다. Android 성공 범위를 유지하고 iOS/계정 OAuth·기기/store와
#334/#346/#339/#71 전체 인수는 계속 OPEN이다.

## iOS 공개 탐색 입력·키보드·회전 검증 준비 (#379)

`mobile-internal-ios-reverify.yml`의 `smoke=true/public_directory=true`는 원본171989e
Simulator 앱을 다시 빌드하거나 재서명하지 않는 독립 수동 모드다. auth_cancel/large_font/
ui_test/accessibility_audit와 함께 실행할 수 없다. 성공한 정확한 main CI 뒤 다음처럼 실행한다.

```sh
gh workflow run mobile-internal-ios-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true -f public_directory=true
```

Home의 고정 탐색 버튼으로 진입하고 공개 목록의 준비 완료 상태만 empty/cards enum으로
확인한다. 고정 합성 ASCII 문자열을 검색란에 입력하며 키보드가 나타났을 때 입력란이 가려지지
않는지, 키보드 submit 뒤 키보드가 닫히고 필터된 빈 결과가 표시되는지 확인한다. 합성 입력과
일치하는 실제 프로필이 있으면 이 빈 결과 시나리오는 실패하며 임의 이름 검색으로 바꾸지 않는다.
가로·세로 전환마다 실제 앱 창의 종횡 크기 변화·입력 유지·입력란까지 스크롤하여 조작 가능함을
검사하고 native back으로 Home에 돌아온다. Apple의 [orientation API](https://developer.apple.com/documentation/xcuiautomation/xcuidevice/orientation)는
기기 방향과 앱 UI 방향을 구분하므로 방향 명령 자체를 회전 성공으로 인수하지 않는다.

공개 탐색 **이전**부터 명시적 screenshot과 host 원본 command log 저장을 되돌릴 수 없게
차단한다. XCTest 원본 출력은 메모리에서 고정 enum/boolean과 알려진 assertion code로만
분류하고 private runner/xcresult는 finally에서 삭제한다. artifact는 기존 pre-public Home PNG와
metadata/원본 ZIP/receipt 및 `directory-ui.json`만 보존한다. 공개 이름·사무실·소개·ID·input 값·
원본 hierarchy·xcresult/stack은 내보내지 않는다. 프로필·연락 버튼은 열지 않고 서버 mutation도
수행하지 않는다. 실제 HTTP transport/원격 API 성공, 한국어 키보드, VoiceOver, 전체 화면/역할,
물리 기기·스토어와 전체 #334/#379 인수는 별도다. 현재 문단은 검증 도구의 준비 상태이며 실제
Simulator 성공 증거는 해당 run의 strict proof를 따로 인수한 뒤 기록한다.


## iOS 세 제공자 브라우저 취소 실제 인수 (#346)

PR439/main `97c214443a2698743443496c7a9c94036aa63c94`의 CI40040850507 SUCCESS 뒤
[실제40041077753](https://github.com/creno-va/baro/actions/runs/40041077753)는 terminal SUCCESS다.
[원본 proof](../quality/mobile-internal-ios-2026-10-23/auth-cancel-ui-97c2144.json)의 관측 시각은
2026-10-23T23:50:42.075Z, 전체 SHA256은
`3a9011b0b710f80ec807d509481cec26759e07d050d42b5656f6c63a9dc3464b`다.
[Home baseline](../quality/mobile-internal-ios-2026-10-23/auth-cancel-home-97c2144.json)과
[metadata](../quality/mobile-internal-ios-2026-10-23/auth-cancel-verification-97c2144.json)의 binary/tooling/device identity,
원본171989e ZIP24,102,101bytes/전체 SHA와 원본 compiler receipt77d157…/전체 SHA,
해당 main의 Swift149051…·Ruby c4073949… 실제 source hash를 독립 대조했다.

fresh iPhone16/iOS26.5 Simulator에서 Google/Naver/Kakao마다 시스템 WebView·유일한 새
hittable Cancel을 확인했다. 각각 관측한 WebView3/2/2개를 모두 query하고 모든 WebView의
Cancel descendant0·keyboard0·query complete를 검사한 뒤 Cancel을 눌렀다. WebView 소멸·
앱 foreground·익명/오류와 동의 화면 부재를 확인하고 마지막 앱 terminate/재실행/Home→Session에서도
익명 복귀를 확인했다. 세 제공자 모두 OS Continue prompt 처리는 없었다.
`webViewFrameExcluded=false`는 그대로 보존한다. 전체 WebView 사각형과 겹치지 않는다는
증거가 아니며, 공개 descendant query로 웹/키보드 자식이 아님을 확인한 좁은 선택 범위다.
이전8480fa6/6825328/ca8ea4f/9dbb2ee/318df0c 실패와 snapshot/query 불일치 사실은 보존한다.

명시적 screenshot과 host 원본 command log 저장은 인증 진입 전에 차단했고 원본 xcresult/
hierarchy는 내보내지 않았다. 기존 pre-auth Home PNG만 포함한다. 앱 재컴파일·재서명·Metro는
없다. 실제 계정 입력/동의·callback 교환·제공자 수락·SecureStore pending 삭제의 직접 계측·
실기기·전체 OAuth 성공은 아니다. 두 OS 취소 경로 인수와 별도로 #346/#334·보안 #339·릴리스
#71은 OPEN이다. Apple 추가 방향은 사용자 결정 대기이며 이 성공으로 승인된 것으로 처리하지 않는다.

## Android 공개 탐색 입력·키보드·회전 검증 준비 (#379)

`mobile-internal-android-compiled-reverify.yml`의 `smoke=true/directory_input=true`는
원본171989e APK를 유지하는 독립 수동 모드다. large_font/public_directory/guide_ui/auth_cancel과
함께 실행하지 않는다. 성공한 정확한 main CI 뒤 실행한다.

```sh
gh workflow run mobile-internal-android-compiled-reverify.yml --ref main -f target_sha=<full40-main-tooling-sha> -f smoke=true -f large_font=false -f public_directory=false -f directory_input=true
```

fresh owned AVD·실제 부팅/기본 Home·실행 중인 소유 Emulator가 확인된 경우에만 동작한다.
공개 진입 전에 screenshot guard와 adb capture/raw diagnostic 명령 guard를 비가역 차단한다.
원본 APK/receipt·metadata와 Home baseline의 SHA/device를 별도로 바인딩하고 새 앱 compile/
resign·Chrome/account 설정을 하지 않는다. 기존 Android 취소 proof318df0c와 source를 섞지 않는다.
공유 capture guard에 public-data 진입 메서드만 추가했으며 기존 인증 진입 메서드는 유지한다.

고정 이름 검색란은 BARO 소유의 유일한 native EditText·활성/가시 상태·화면 안 bounds로만
선택한다. 실제 키보드 표시와 표시 영역은 Android15의 `dumpsys window displays`에 있는
단일 DisplayFrames·단일 IME InsetsSource에서 읽는다. 입력란 focus 뒤에는 스크롤하지 않고
IME가 실제 visible인지와 입력란 bottom이 IME top 위인지 검사한다. 합성 ASCII 입력과
**hardware KEYCODE_ENTER**로 submit하고 키보드가 닫힌 뒤 필터된 빈 결과를 요구한다.
소프트 키보드 검색 키의 직접 탭·한국어 IME·실제 HTTP transport까지 검증했다는 뜻은 아니다.
합성 검색에 실제 결과가 있으면 이 빈 결과 시나리오는 실패하며 다른 이름으로 우회하지 않는다.

[WindowManager shell](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r5/services/core/java/com/android/server/wm/WindowManagerShellCommand.java)의
user-rotation lock0→lock1→lock0을 소유 Emulator에만 적용한다. 설정 readback만으로 통과시키지
않고 실제 DisplayFrames rotation/종횡·가로/세로 native app window·같은 입력값 유지/입력란
도달을 확인한다. 정확한 화면 pixel 크기 교환을 요구하고 ambiguous display/IME 상태는 거절한다.
검증 뒤 BACK1로 Home에 돌아온다. finally에서 원래 free/lock과 user_rotation 값을 복구·readback하며
복구 실패 시 성공 proof를 만들지 않는다. 사용자 물리 기기·전역 host 설정은 대상으로 삼지 않는다.

원본 hierarchy/dumpsys는 메모리에서 고정 boolean/enum/수치로만 분류하며 명령 출력·공개
프로필 값/ID·input 값·XML/stack은 artifact에 쓰지 않는다. 소유 Emulator 내 UUID XML은
매회 finally에서 지운다. 기존 pre-public Home PNG와 `directory-input.json`·고정 실패 JSON만
해당 allowlist로 내보낸다. profile/contact·remote mutation·auth/private 화면은 열지 않는다.
현재 문단은 도구 준비 상태이며 actual 성공은 exact CI/main 뒤 별도 run/proof를 인수해야 한다.
전체 화면/역할·TalkBack/VoiceOver·한국어 키보드·실기기/store·#334/#379/#339/#71은 별도다.


## iOS 공개 탐색 첫 실제 실패와 단계 구분 (#379)

PR440/main06788cb·CI40042338503 SUCCESS 뒤 [실제40042571370](https://github.com/creno-va/baro/actions/runs/40042571370)은
2026-10-24T00:10:22Z terminal FAILURE다. [원본 실패](../quality/mobile-internal-ios-2026-10-23/directory-failure-06788cb.json)는
public-directory-xcuitest/exit65/timedOut=false이며 assertion은 `BARO_DIRECTORY_INPUT_NOT_RETAINED`다.
실패 JSON 전체 SHA256은 `33ec9c15fc1477d36f25b43dd2398f3f550d01c8d6392338e16ff6db94b21827`다.
[Home](../quality/mobile-internal-ios-2026-10-23/directory-home-06788cb.json)·[metadata](../quality/mobile-internal-ios-2026-10-23/directory-verification-06788cb.json)의
identity와 원본 ZIP24,102,101bytes/전체 SHA·compiler receipt77d157…를 독립 대조했다.
성공 directory proof는 없으며 관측 timeout이나 Simulator SDK compile 실패가 아니다.

이전 Swift는 입력 직후·가로 전환 뒤·세로 전환 뒤에 같은 assertion을 썼으므로 현재 원본만으로
어느 단계에서 실패했는지, 앱 상태 손실인지 UI 입력/관측 차이인지 특정하지 않는다. 후속 도구는
각 assertion을 고유 코드로 구분하고 입력 전/직후/10초 bounded value 대기 뒤·가로/세로 검사
위치에서 fixed status를 남긴다. 입력의 실제 문자열·길이·label은 출력하지 않고
empty/literal/sentence-capitalized/prefix/other/unavailable enum과 foreground/keyboard boolean만
허용한다. sentence-capitalized 분류는 원인으로 확정한 사실이 아니며 실제 입력 또는 제품 설정을
바꾸지 않는다. 회전 후에는 입력란이 fully hittable한 위치에 도달한 뒤 정확한 값을 검사한다. 기존의 값 검사→스크롤 순서는 offscreen native 값을 먼저 읽을 수 있었으며 실제 원인으로는 아직 확정하지 않는다.
통과 조건은 여전히 정확한 합성 입력 유지다. malformed/알 수 없는 stage/값·
추가 필드는 모두 버리고 원본 command log/xcresult/hierarchy 저장 차단을 유지한다.

새 정확한 CI/main 뒤 변경한 대기·단계 관측으로 실제 재검증하며 이전 실패를 덮어쓰지 않는다.
Android 독립 입력/회전 도구도 같은 #379에서 준비한다. 전체 M7/#334·실제 계정/OAuth·HTTP
transport·한국어 입력·VoiceOver/TalkBack·물리 기기/store·#339/#71은 OPEN이다.

## Android 공개 탐색 첫 실제 실패와 raw InsetsState 범위 (#379)

PR441/main8e1a2be·CI40044599732 SUCCESS 뒤 [실제40044821282](https://github.com/creno-va/baro/actions/runs/40044821282)는
2026-10-24T00:27:12Z terminal FAILURE다. [원본 실패](../quality/mobile-internal-android-2026-10-24/directory-input-failure-8e1a2be.json)는
directory-input-prepare/ANDROID_DIRECTORY_DISPLAY_INVALID이며 SDK boot·기본 Home은 성공했다.
[Home](../quality/mobile-internal-android-2026-10-24/directory-input-home-8e1a2be.json)·[metadata](../quality/mobile-internal-android-2026-10-24/directory-input-verification-8e1a2be.json)의
identity/SHA와 원본171989e APK57,133,550bytes/전체 SHA·compiler receipt8b7877…를 독립 대조했다.
실패 JSON 전체 SHA256은 `f0541f36516b01c0975e5a7812b593603b22f77d3e63f769bbb6541860ef5004`다.
현재 source 순서상 첫 display 읽기에서 멈췄으며 공개 탐색·입력·키보드·회전 성공 proof는 없다.
원본은 display=null뿐이어서 실제 marker/source 개수나 형식 차이를 확정하지 않는다.

Android15의 [InsetsStateController.dump](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r5/services/core/java/com/android/server/wm/InsetsStateController.java)는
`WindowInsetsStateController` 안에 raw `InsetsState`를 출력하고 그 뒤 `Control map:`에 별도
provider 진단을 출력한다. [InsetsState.dump](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r5/core/java/android/view/InsetsState.java)는
현재 source 목록만 순회한다. 후속 parser는 전체 출력의 IME 문구를 한 source로 가정하지 않고
유일한 controller의 raw state만 읽는다. 단일 DisplayFrames와 같은 크기의 raw display frame·
완전한 raw 구간을 요구한다. 아직 IME window/source가 없는 초기 상태도 이 완전한 구간에서만
구분하며, 알 수 없는 IME 형식이나 중복 raw source는 hidden으로 대체하지 않는다.
실제 focus 뒤에는 이전과 같이 visible IME/양수 bounds·입력란 비가림·정확한 입력 유지가 필수다.

다음 실행의 실패를 구분할 수 있도록 parser **이전**에 controller/frame/raw state/IME marker·
source 개수와 구간 존재 여부만 기록한다. 입력/창 이름·raw dumpsys/XML은 출력하지 않는다.
형식 검증 실패 때 display는 null로 두어 이전 정상 값을 현재 상태로 오인하지 않게 한다.
이 수정은 SDK 구조와 초기 상태에 맞춘 관측 계약이며 첫 실패의 원인을 확인한 것으로 표현하지
않는다. 원래 실패·시각/byte/hash를 보존하고 새 exact CI/main 뒤 변경된 parser로 실제 확인한다.
앱/웹 UI·공통 계약/권한/DB·Chrome/인증 설정과 전체 M7/#334/#346/#339/#71 인수는 불변이다.

## iOS 입력 직후 불일치의 실제 관측 (#379)

같은 main8e1a2be의 [실제40044821833](https://github.com/creno-va/baro/actions/runs/40044821833)도
terminal FAILURE다. [원본](../quality/mobile-internal-ios-2026-10-24/directory-failure-8e1a2be.json)은
exit65/timedOut=false·BARO_DIRECTORY_TYPED_INPUT_MISMATCH이며 마지막 status는
typed-check/other·appForeground=true·keyboardObserved=true다. 실패 전체 SHA256은
`12e78666842465b9edf3bcad176fd4bb6fe6723e5d3e1a1b4bad5a8d418adc6e`다.
[Home](../quality/mobile-internal-ios-2026-10-24/directory-home-8e1a2be.json)·[metadata](../quality/mobile-internal-ios-2026-10-24/directory-verification-8e1a2be.json)의
identity와 원본171989e ZIP24,102,101bytes/전체 SHA·receipt77d157…를 독립 대조했다.
이번 실패 위치는 회전 전 입력 직후로 구분됐다. 원래 입력·회전 공용 assertion 실패06788cb도
보존하며 새 관측으로 이전 실행의 정확한 실패 지점까지 소급 확정하지 않는다.

other 분류만으로 문자 손실·입력기·자동 변환·native 값 표현 차이를 특정하지 않는다. 후속 도구는
동일한 합성 입력을 유지하고, 입력 전 비어 있는지 확인한 뒤 고정 boolean 비교만 추가한다.
길이 **일치 여부**·대소문자/공백/dash/호환 문자 정규화 **후 일치 여부**·기대 입력의 부분 수열/
고정 부분 문자열·숫자 suffix·한글 범위·고정 label 일치 여부를 읽는다. 실제 값·길이·Unicode
scalar/창 이름·raw 계층은 출력하지 않는다. 정규화는 진단 비교에만 쓰며 통과 조건이나 실제
앱 입력/검색 값은 바꾸지 않는다. 값 불일치를 성공으로 대체하지 않는다.

허용된 status 최근8줄의 bounded history를 보존해 입력 전/직후/대기 뒤를 비교한다. 기존 signature
없는 status도 구분해서 읽고, unknown 필드·원문/숫자/부분 signature는 모두 버린다. 같은 Swift
진단 함수를 Foundation에서 컴파일/실행해 nil·합성 대소문자/공백/dash/호환 문자·누락·한글/
고정 label을 검사한다. swiftc 없는 환경은 이 순수 probe만 skip하며 실제 Simulator 입력 성공으로
세지 않는다. 로컬 probe 성공도 native TextInput/키보드/원격 API/VoiceOver 인수를 대체하지 않는다.
새 정확한 CI/main 뒤 변경된 관측으로 확인하며 앱/웹·계약/DB와 #334/#379/#346/#339/#71은 유지한다.


## Apple 비교 probe의 CI 실행 환경 교정 (#379)

PR442 head91a8185의 CI40046897941/host40046897934는 SUCCESS였지만 mainc401986의
[CI40047097734](https://github.com/creno-va/baro/actions/runs/40047097734)는 새 Swift 비교 probe에서
실패했다. [고정 관측](../quality/mobile-internal-ios-2026-10-24/signature-ci-failure-c401986.json)은
설정한 compiler timer45,000ms·test45,054.55ms·expected0/received143을 보존한다. timer와
시간/exit가 일치하며 cold cache나 실제 compiler 오류까지 확정하지 않는다. 원본 compiler
stdout/stderr는 probe가 수집하지 않았고 raw failed-step log/stack은 관측 JSON에 넣지 않았다.
원본 main 실패를 SUCCESS로 바꾸지 않으며 이 상태에서 새 native run을 시작하지 않았다.

후속 probe는 Apple Foundation이 설치된 macOS에서 컴파일한다. Linux quick은 이 비교 probe를
skip하고 기존 타입/계약·보안 회귀를 유지한다. macOS local quick에서는 컴파일러가 있으면
실행한다. 실제 iOS workflow는 public_directory 요청 시 immutable CI 확인 뒤, native 관측 전에
`BARO_IOS_DIRECTORY_SIGNATURE_REQUIRED=1`로 반드시 실행한다. required 경로에서 Apple
Swift가 없으면 고정 오류로 실패하며 skip하지 않는다. compile45초/run10초/test60초 bound는
그대로다. Linux/corelibs 환경에서 통과한 것을 iOS 동작 증거로 쓰지 않는다.

로컬 실제 macOS required 실행과 컴파일러가 없는 PATH의 required 실패를 각각 확인하고,
workflow 계약 검사로 required flag/실행 순서를 검증한다. 비교 정규화/직접 native 입력·parser
성공 인수 범위는 바뀌지 않는다. 새 exact main CI가 성공한 뒤에만 두 OS native 검증을
시작한다. 앱/웹 UI·공통 계약/DB·Android 관측·공급자/비용 정책과 전체 #334/#379/#339/#71은 유지한다.

## Android 공개 탐색 입력·키보드·회전 실제 인수 (#379)

PR443/main `45bc32fc56fbce7987fa089e4a864ab95fc3bb97`·CI40048165288 SUCCESS 뒤
[실제40048447253](https://github.com/creno-va/baro/actions/runs/40048447253)은 terminal SUCCESS다.
[원본 strict proof](../quality/mobile-internal-android-2026-10-24/directory-input-45bc32f.json)의
observedAt은2026-10-24T01:12:23.217Z, 전체 SHA256은
`64a76850ecf594d71a47ea7395ab36e0aa0081d463e9908d0e63c3111bb71bdb`다.
[Home](../quality/mobile-internal-android-2026-10-24/directory-input-home-45bc32f.json)·[metadata](../quality/mobile-internal-android-2026-10-24/directory-input-verification-45bc32f.json)의
source·device·원본 byte/SHA와 proof의 metadata/Home receipt SHA를 독립 대조했다.
원본171989e APK57,133,550bytes/cd93…와 compiler receipt8b7877…는 byte 그대로다.

fresh owned Android15/sdk_gphone64_x86_64에서 초기 empty 상태·고정 native 이름 검색란·
실제 IME visible/양수 영역과 입력란 비가림·합성 ASCII 정확한 입력을 확인했다. hardware
Enter submit 뒤 IME 닫힘·필터된 빈 결과, 실제 display1080×2400/r0→2400×1080/r1→portrait와
native app window 방향·동일 입력 유지/입력란 도달, BACK1 Home 복귀·원래 회전 preference
복구/readback을 확인했다. Metro0·공개 진입 전 capture guard·raw hierarchy/dumpsys/output
비출력·기기 XML 매회 삭제 조건을 유지했다. 프로필/연락·remote mutation·auth/private 접근은 없다.

이것은 해당 Emulator/입력 방법의 실제 UI 인수다. 소프트 IME 검색 키의 직접 탭·한국어 조합·
TalkBack/VoiceOver·실기기·전체 역할/화면·실제 HTTP transport/원격 API·OAuth/store 인수가 아니다.
새 parser의 해당 실행 성공과 별도로 이전8e1a2be DISPLAY_INVALID 실패를 보존한다. 이전에는
shape 개수가 없었으므로 그 실행의 정확한 원인을 소급 확정하지 않는다. 앱/웹·공유 계약/DB·
권한/공급자/비용 정책과 전체 #334/#379/#346/#339/#71은 유지한다.

같은 source의 [Apple Foundation 필수 step](../quality/mobile-internal-ios-2026-10-24/apple-signature-step-45bc32f.json)은
01:09:38Z→01:09:52Z SUCCESS다. 이 step 관측은 #443의 실제 Apple 환경 배치만 인수하며
별도 native 입력/키보드 proof와 구분한다.

## iOS 공개 탐색 입력·키보드·회전 첫 실제 성공 (#379)

같은 main45bc32f/CI40048165288의 [실제40048447226](https://github.com/creno-va/baro/actions/runs/40048447226)은
terminal SUCCESS다. [원본 strict proof](../quality/mobile-internal-ios-2026-10-24/directory-ui-45bc32f.json)의
observedAt은2026-10-24T01:19:17.070Z, 전체 SHA256은
`83300c89b02b80ea07437b2604a0aa625d8937f29791aa6367348f2ac9878111`다.
[Home](../quality/mobile-internal-ios-2026-10-24/directory-home-45bc32f.json)·[metadata](../quality/mobile-internal-ios-2026-10-24/directory-verification-45bc32f.json)의
identity와 원본171989e ZIP24,102,101bytes/f8e218…·compiler receipt77d157…를 독립 대조했다.
해당 main의 실제 Swift dc69bc58…·Ruby c4073949… source hash도 receipt와 일치한다.

fresh iPhone16/iOS26.5 Simulator에서 초기 empty·실제 hittable 입력란·키보드 표시와 입력란
비가림·정확한 합성 ASCII 입력을 확인했다. 키보드 submit/닫힘·필터된 빈 결과, 실제 landscape
window와 입력란까지 스크롤한 뒤 값 유지/95% 노출·hittable, portrait 복귀와 같은 값/노출·
native back/Home 복귀를 확인했다. 앱 재컴파일/재서명·Metro는 없고, 공개 진입 전 명시적
screenshot/host raw output 저장 차단·xcresult/hierarchy 비출력을 유지했다. 프로필/연락·
remote mutation·auth/private 접근은 없다. 비교 signature의 정규화는 통과에 사용하지 않았다.

원래06788cb의 공용 assertion 실패와8e1a2be의 typed-check/other 실패를 보존한다. 이 첫
성공으로 이전 불일치의 원인이나 앱 전체 안정성을 소급 확정하지 않는다. 초기 빈 값 guard·
기존 literal 대기·회전 후 도달 순서가 포함된 현재 조건에서 실제 성공한 좁은 범위다.
이전 입력 불일치가 있었으므로 동일 source/앱/조건의 [추가 확인40049505301](https://github.com/creno-va/baro/actions/runs/40049505301)을
새 소유 Simulator에서 한 차례 진행했고 terminal FAILURE다. [원본 실패](../quality/mobile-internal-ios-2026-10-24/directory-consistency-failure-45bc32f.json)의
SHA256은 `00d994b73018175d1b28aeac0570fdcd080615f9444245b30ce4f56136166289`이며,
[Home](../quality/mobile-internal-ios-2026-10-24/directory-consistency-home-45bc32f.json)·[metadata](../quality/mobile-internal-ios-2026-10-24/directory-consistency-verification-45bc32f.json)와
원본 ZIP/receipt byte/hash도 독립 대조했다. typed-check/other·exit65/timeout=false이며,
처음에는 빈 값, 입력 뒤에는 더 짧은 subsequence·알려진 날짜 suffix 유지·case/공백/dash/compatibility
정규화 불일치를 관측했다. 입력 값/길이/계층은 출력하지 않았다. 이는 누락 형태의 관측이며
XCTest 주입과 앱의 렌더 경합 중 원인을 확정하지 않는다. 첫 성공은 보존하되 안정성 인수는 하지
않는다. 같은 조건을 다시 실행하지 않으며 Android도 무관한 반복을 하지 않는다.

소프트 키보드 검색 키의 직접 탭·한국어 조합·VoiceOver/TalkBack·전체 역할/화면·실제 HTTP
transport/원격 API·계정/OAuth·물리 기기/store와 #334/#379/#346/#339/#71은 별도다.

## 검색 입력 렌더 분리와 소프트 Search 관측 준비 (#379)

`DirectoryQueryField`가 draft 상태를 소유하고 부모에는 ref로 전달하여 매 글자마다 목록·필터를
렌더하지 않게 한다. 버튼은 최신 draft를, 키보드 제출은 `nativeEvent.text`를 그대로 사용한다.
확정 query/필터 변경 시 초기화하고, 목록 phase 변경과 미제출 필터 선택에서는 draft를 유지한다.
한글/전각 dash 등 원문을 정규화하지 않는다. 합성 UI 회귀는 이 동작과 필터 렌더 횟수를 확인하며
실제 iOS 누락 해결을 증명하지 않는다. 제품 변경이므로 새 앱의 두 OS compiler 성공·원본 pin
갱신·새 바이너리 실제 UI 검증을 순서대로 수행해야 한다. 기존171989e 관측을 새 앱에 적용하지 않는다.

iOS runner는 native keyboard의 public `buttons`/`keys` query에서 Search/검색을 찾고, bounded
개수·95% 키보드 내부/화면 노출·hittable·유일 물리 control을 확인해 직접 탭하도록 준비한다.
button/key alias가 함께 있으면 두 frame의95% 겹침을 요구한다. newline fallback은 없고 입력
literal 검사를 먼저 통과해야 한다. 진단은 고정 count/boolean만 남긴다. 새 software-search
result/receipt kind는 필수 탭 증거를 요구하며 기존 newline receipt를 재명명하지 않는다.
로컬 schema/Swift syntax 검증과 실제 UIKit 컴파일·Search 탭 성공은 구분한다. 후자는 아직 미검증이다.
웹 UI·공통 계약/DB·권한/공급자/비용 정책은 변경하지 않는다.

## Android 소프트 IME Search 직접 탭 준비 (#379)

PR444/main `b3eea741010b572158a01fc50b51e58aa13344c6`·CI40051831098 SUCCESS 뒤
새 앱의 Android compiler40051994117·iOS compiler40051996500 및 unsigned iPhone SDK40052099884를
시작했다. 이 세 실행의 terminal 성공·원본 산출물·새 입력 해결은 아직 인수하지 않았다.
기존171989e 원본 pin은 성공 compiler 증거를 대조한 후에만 갱신한다.

Android15r5의 [DumpCommand](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r5/cmds/uiautomator/cmds/uiautomator/src/com/android/commands/uiautomator/DumpCommand.java)와
[AccessibilityNodeInfoDumper](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r5/cmds/uiautomator/library/core-src/com/android/uiautomator/core/AccessibilityNodeInfoDumper.java)의
실제 `--windows`/default display·`TYPE_INPUT_METHOD` 구조를 기준으로 소프트 Search 관측을
준비한다. 신선한 소유 Emulator의 공개 화면 capture 차단 뒤 current IME component를 읽고,
default display의 유일 input-method window 안에서 해당 IME package의 Search/검색 node가
하나인지 확인한다. enabled/clickable·양수 화면 bounds·IME window 내부·실제 IME top 아래를
요구하고 IME component가 그대로인지 다시 확인한 후 tap한다. 키를 찾지 못하면 실패하며
hardware Enter로 대체하지 않는다. 중첩 IME window 구조는 지원하지 않으며 안전하게 실패한다.

XML은 메모리에서만 해석하고 device 임시 파일은 매회 finally에서 지운다. 진단은 고정
count/boolean만 남기며 label/package/component/키 입력/계층은 출력하지 않는다. 새로운
`software-keyboard-search` 결과·별도 receipt kind는 탭 증거를 요구한다. 기존 hardware
Enter 원본 receipt는 그대로 읽되 재명명을 거부한다. 합성 parser/명령·복구 검증을 실제 키
탭 성공으로 표현하지 않는다. 새 앱 pin/정확한 main CI 뒤 실제 Emulator에서 확인해야 한다.
한국어 조합·TalkBack·실기기/전체 역할과 원격 API·OAuth·스토어 인수는 계속 별도다.

## 새 검색 앱 Android/iPhone SDK compiler 인수 (#379)

PR445 head `f0ae94c7e2d1811d5668689c4db41f9f995d105b`의 CI40052617643와 Android host
preflight40052617656 SUCCESS 뒤 정상 통합했고, main `f4cf115e83a070fb2b05eda0cd11e4348464ad12`의
CI40052811445도 SUCCESS다. b3eea74→f4cf115의 bundled product 입력 parity를 확인했다.
tooling·문서만 추가했으므로 진행 중인 b3eea74 원본 compiler를 재시작하지 않는다.

새 제품 source `b3eea741010b572158a01fc50b51e58aa13344c6`의 [Android40051994117](https://github.com/creno-va/baro/actions/runs/40051994117)은
terminal SUCCESS이고 artifact12543907248의 성공 run/source/name/만료 아님을 대조했다.
[원본 receipt](../quality/mobile-internal-android-2026-10-24/compiler-receipt-b3eea74.json)의 SHA256은
`9caa6db3b188abcf1956b82ec47f284b55f9038f9fea6e6a15aabbc10c5e4a75`다.
APK57,134,542bytes의 전체 SHA256은 `8da138d788c56b78f7671faa1a9eac6fcc3605ea1b8a8ee27f8934caf9aef41c`이며
[독립 대조](../quality/mobile-internal-android-2026-10-24/compiler-independent-b3eea74.json)는 원본 byte/hash·
HBC3,571,056bytes/05297913…·graph1456·폰트 byte/compiled family400/600/700와 실제 aapt2
package/launch/min24/arm64-v8a+x86_64/Release non-debug metadata를 확인했다. aapt2의
`minSdkVersion` 필드를 명시적으로 읽었고 기존 aapt parser의 raw format을 바꾸지 않았다.
공개 Expo 개발 cert의 compiler attestation은 보존한다. local cert 독립 readback은 false이며
후속 fresh SDK 재검증에서 actual signature를 다시 확인해야 한다. 아직 새 앱 실행/입력 해결은 아니다.

[iPhone SDK40052099884](https://github.com/creno-va/baro/actions/runs/40052099884)도 terminal SUCCESS다.
[원본 receipt](../quality/mobile-ios-device-sdk-2026-10-24/receipt-b3eea74.json)의 observedAt은
2026-10-24T02:07:33.186Z, SHA256은 `b740b30e5481661171b75a3b7fa60f1b0f236319d232fd2c68fe49c23f4f1bfb`다.
ZIP13,808,649bytes/30bbee5a…·실제 Info.plist/Mach-O iPhoneOS platform2/arm64·SDK26.5/min16.4·
서명 없음·HBC3,583,012bytes/fb561553…·font·키/profile/map 부재를 [독립 대조](../quality/mobile-ios-device-sdk-2026-10-24/independent-b3eea74.json)했다.
이전 source87dec15 기록과 이름이 다른 [unaccepted inspection](../quality/mobile-ios-device-sdk-2026-10-24/inspection-b3eea74.json)도 그대로 보존한다.
unsigned/unprovisioned SDK compile이며 설치·실기기·스토어 성공이 아니다.

iOS Simulator40051996500은 이 기록 시점 같은 run에서 컴파일 중이다. 관측 timeout으로
재시작하지 않는다. Android는 성공 원본 pin을 먼저 통합하고 exact tooling main CI 후 독립적으로
실제 키보드·소프트 Search/회전을 검증한다. iOS는 성공 원본 receipt/ZIP를 대조하고 pin을 별도
통합한 뒤 검증하며 기존 pin에 대한 parity guard를 완화하지 않는다. 기존171989e의 성공/실패/원본은
보존하며 새 앱의 실제 안정성·한국어/reader·계정/API/physical/store 인수로 적용하지 않는다.

## 새 검색 앱 iOS Simulator compiler 원본 인수 (#379)

PR446 head `3a706311de8bb5c6f6b16fa8430f0da5e71d1325`의 CI40053292017 SUCCESS 뒤
정상 통합한 main `ae6aeccaba21534c011d72fdc2d810b186757d0f`의 CI40053476538도 SUCCESS다.
새 Android 원본에 대한 [actual40053634921](https://github.com/creno-va/baro/actions/runs/40053634921)의
fresh SDK·소프트 Search/입력/회전 검증을 시작했다. 최종 실패와 좁은 SDK/Home 결과는 아래에 구분한다.

같은 제품 sourceb3eea74의 [iOS compiler40051996500](https://github.com/creno-va/baro/actions/runs/40051996500)이
terminal SUCCESS로 완료됐다. 성공 run/source·artifact12544251875/name·만료 아님과 원본
[receipt](../quality/mobile-internal-ios-2026-10-24/compiler-receipt-b3eea74.json)의 SHA256
`dc67f480fffe8b2300a2f75b292332d3727c132bbfc50fd99b0cc1aa1723533a`를 확인했다.
ZIP24,102,692bytes의 전체 SHA256은 `07ea44d1fe992848048f068e59509c8634d805a1c51a8c568d97729eda4f7fe4`다.
[독립 대조](../quality/mobile-internal-ios-2026-10-24/compiler-independent-b3eea74.json)는 02:20:04.759Z에
원본을 소유 임시 디렉터리에 추출하여 실제 codesign strict/all-architectures·ad-hoc/No-Team,
arm64/x86_64 Simulator platform과 Mach-O XML/DER entitlement section·signature entitlements,
Info.plist/실행 파일 hash를 원본 control과 대조했다. 앱을 재컴파일/재서명하지 않았고 임시 사본은 삭제했다.

실제 HBC3,583,012bytes/fb561553…·graph1465·font byte/400·600·700·min16.4/phone+tablet·
0.1.0/build1과 map/key/profile 부재도 대조했다. [compile 중간 inspection](../quality/mobile-internal-ios-2026-10-24/compiler-inspection-b3eea74.json)의
accepted=false는 원래 상태로 보존하고 최종 성공 receipt와 구분한다. 내부 전달 폴더
`.wrangler/mobile-delivery/b3eea74/ios`에도 원본 ZIP/receipt를 보존한다.

성공한 원본 pin을 정상 PR로 통합하고 exact tooling main CI 뒤 새 앱의 실제 입력·소프트
Search 탭·키보드/회전을 검사한다. 이 compiler/metadata 인수 자체는 앱 실행·입력 누락 해결·
한국어 조합/VoiceOver·계정/API·실기기/스토어 인수가 아니다. 이전171989e 기록과 전체
#334/#379/#346/#339/#71, 웹 소유권·공통 계약/DB·공급자/비용 정책을 보존한다.

### 새 Android 실제 준비 단계 명령 실패

40053634921은 terminal FAILURE다. [원본 실패](../quality/mobile-internal-android-2026-10-24/directory-failure-ae6aecc.json)의
SHA256은 `b30fae5fbdf215b38b2142c8a01164d36edcbd1b80c06a9dcc39bff8c9cbe26e`다.
phase/stage는 directory-input-ready/ready, code는 ANDROID_DIRECTORY_COMMAND_FAILED이며
softwareSearchBeforeTap/input은 null이다. 소프트 Search 제어를 검사하거나 입력을 타이핑한
단계에 도달하지 않았으므로 Search 선택 실패·앱 입력 수정 실패로 원인을 확정하지 않는다.
현재 generic command code만으로 정확 명령/exit/timeout은 알 수 없다.

별도 [SDK 재검증](../quality/mobile-internal-android-2026-10-24/directory-verification-ae6aecc.json)은
02:19:13.341Z에 fresh build-tools37.0.0의 실제 cert fac61745…·package/SDK·HBC 검증을
완료했다. compiler 원본 receipt/APK·[Home receipt](../quality/mobile-internal-android-2026-10-24/directory-home-ae6aecc.json)와
pre-public PNG/hash 및 metadata SHA도 [독립 대조](../quality/mobile-internal-android-2026-10-24/directory-failure-independent-ae6aecc.json)했다.
Home PNG는 새 앱의 고정 익명 화면을 육안 확인했으며 공개 진입 뒤 screenshot/raw XML/window
출력은 없었다. 이러한 SDK/signature/Home 관측을 전체 workflow 성공으로 표현하지 않는다.

원본 실패를 보존하고 native 명령의 고정 category/exit/timeout 진단을 보강한 뒤 바뀐 조건을
검증한다. 같은 조건을 즉시 반복하지 않으며 이전171989e hardware Enter 성공을 새 source의
입력/소프트 Search·회전 성공으로 적용하지 않는다. 새 iOS 원본 pin/actual 검증은 독립 진행한다.
