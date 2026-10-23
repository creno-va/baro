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
