# 모바일 실제 실행·내부 개발 앱 증거

관측 대상 source는 `c2fa3f23394a349bf7cf7d33dee64a433d29e634`다. PR389의
Quality gate39915601296/SDK host39915601362와 main CI39915841507이 성공했다.
[이슈385](https://github.com/creno-va/baro/issues/385)에서 이전 실패와 현재 범위를 보존한다.
웹 소유 경로·제품 router·server/schema를 변경하지 않은 검증이다.

## 실제 Android 로컬 실행

[수동 runtime39916204937](https://github.com/creno-va/baro/actions/runs/39916204937)의
Android job120290228109가 성공했다. Android15/x86_64 Emulator의 계측 Home layout과
실제 RN→native module→Expo SDK 경로를 실행했다. 별도 임시 worktree·새 소유 AVD와
loopback 합성 fixture만 사용했으며 실제 사건/계정·제공자·유료 호출은 사용하지 않았다.

[receipt](./mobile-runtime-2026-10-23/receipt-android.json)를 다운로드해 strict schema·source/
platform·원본 Home/overlay/probe source hash와 합성 전체 byte/hash를 독립 대조했다.
100,000,000bytes PUT의 SHA256은 `83d30385a4a11980275dc23de3fb49ff37b906cc841efa048a96c62d90ff3b5f`,
1,000,000,000bytes download는 `c81ea537d85888c161118b7ac8dc75be6cdeaf291790cb36ab34f3c7833e9abc`다.
SDK snapshot/readback·SecureStore readback·미확정 key 보존,401/Origin·owner fencing,
전송 중 source clear/취소와 owned file cleanup을 실제 실행했다. 요청5회·header 거절0회,
취소 upload24,576bytes와 remaining source/download/native file0개를 확인했다.

Home layout은411.43×809.52이고, process RSS 표본440개 중 최대 관측381,427,712bytes다.
전체 실행 peak나 JS heap 상한을 증명하지 않는다. 계측 Home mount는 전체 제품 여정/
DocumentPicker·공유 UI·접근성·원격 API/OAuth·물리 기기 인수가 아니다.

![Android 계측 Home](./mobile-runtime-2026-10-23/product-home-android.png)

![Android 합성 native probe 완료](./mobile-runtime-2026-10-23/native-probe-android.png)

## preview 개발 앱 전달물

[수동 build39916208240](https://github.com/creno-va/baro/actions/runs/39916208240)의
두 OS job과 workflow가 성공했다. 두 파일을 실제 다운로드해 전체 byte/hash·포함 TTF를
대조했다. Android ZIP의 native ABI와 iOS Info.plist/Mach-O ABI·binary ad-hoc signature도
독립 확인했다. Android 실제 SDK apksig certificate 검증은 CI에서 수행했으며 로컬에
SDK/JDK가 없어 로컬 cryptographic APK 검증을 다시 했다고 표현하지 않는다.

| 전달물 | 실제 파일·지원 대상 | 확인한 전체 파일 SHA256 |
| --- | --- | --- |
| [Android APK](https://github.com/creno-va/baro/actions/runs/39916208240/artifacts/12485482082) | 162,497,066bytes/API24+/arm64-v8a·x86_64/debug | `636c11b03079ab5ddfedc6ce7dcc9a0941c9990ff577ba195a4db761889a98b9` |
| [iOS Simulator ZIP](https://github.com/creno-va/baro/actions/runs/39916208240/artifacts/12485743242) | 51,547,245bytes/iOS16.4+/Simulator x86_64·arm64/ad-hoc | `7721df5c8ce0f1bbba46791cd9107a58652ee7b91d298de6a0c3cf6b6fe6be79` |

[Android receipt](./mobile-runtime-2026-10-23/preview-android.json)와
[iOS receipt](./mobile-runtime-2026-10-23/preview-ios.json)를 보존한다. 식별자는
site.baro.app.preview/version0.1.0/build1이며 두 파일 모두 Metro가 필요한 개발 앱이다.
Simulator ZIP은 물리 iPhone IPA가 아니다. 설치·같은 SHA Metro 연결 절차는
[모바일 안내](../../apps/mobile/README.md#내부-preview-개발-앱-전달)를 따른다.

패키징 시 preview API 관측은 여전히57121d2378cb5fd8d0e8761899672be00dcaf59f이며 native
인증 이전 SHA다. 이 앱/API 조합의 실제 로그인·전체 사용자 여정은 미검증이다. local runtime의
site.baro.app.dev/합성 loopback 성공을 preview 앱의 원격/물리 기기 성공으로 확대하지 않는다.

## 잔여·보완 범위

iOS local runtime39916204937/job120290227903은 compile SUCCESS 뒤
product-home-layout/RUNTIME_WAIT_EXPIRED로 terminal FAILURE다. [실제 실패 분류](./mobile-runtime-2026-10-23/failure-ios.json)를
보존하며 제품 layout/native result는 false다. 두 OS runtime 전체 성공으로 표시하지 않는다.
설치된 Expo CLI58.1.14는 appId별 Simulator schemeapproval을 준비하고 openurl을 호출한다.
기존 host가 이 준비 없이 raw openurl만 호출한 차이를 확인했고 소유 UUID/name/Booted만
허용하는 SDK 경로·readback을 추가한다. 이것은 아직 실패 원인 확정이나 수정 후 실행 성공이
아니다. 실제 OAuth·물리 기기의 deep-link permission을 검증/대체하지 않는다. #346/#354/#361/
#369/#379의 실제 제공자/전체 화면·기기 인수와 스토어 서명·공개 배포/#71은 별도다.

CJS toolchain 보완 PR390/main1a6c54d와 CI39917339321/main CI39917819068은 성공했다.
[패치 범위](../../patches/README.md)와 [#339의 도달성·회귀 증거](https://github.com/creno-va/baro/issues/339#issuecomment-6359737994)를
따른다. 원본 audit high2건과 forge browser dist/map 미패치·이 보완 뒤 native/SDK/full 보안은
OPEN이다. c2fa3f2의 실행을 후속 toolchain 패치 source의 native 성공으로 바꾸지 않는다.

## 후속 source31597a8·previewf912441 관측

source31597a8의 두 OS build39921868056은 native/compiled font·preview handoff 모두
성공했고 두 파일의 실제 전체 byte/hash·metadata/ABI/font를 대조했다. 이후 iOS runtime
39921864348은 Home layout/bundle/RSS를 관측한 뒤 native-ready에서 실패했다.
[실제 분류](./mobile-runtime-2026-10-23/failure-ios-31597a8.json)와
[SDK 초기화 진단](./MOBILE-IOS-KEYCHAIN-HOST.md)을 따른다. 기존c2fa3f2 Home 실패와
source315의 Home 진행을 구분하며 native IO 전체 성공으로 표시하지 않는다.

preview39926450135가 f91244151c94d871423e9f2fe6fda5a70bf0e668을 반영했고 실제 strict
SHA/schema/correlation smoke와 native API의 malformed400/비로그인401을 확인했다.
원본 preview artifact의 packaging 시각57121d2 관측은 고치지 않는다. 앱315/API f912441의
실제 인증된 사용자 여정은 별도다. production은57121d2로 관측됐으며 새 배포하지 않았다.
full39926453700은 정확한f912에서 unit3690/browser454/DB/eval/build/CSP를 통과한 뒤
raw audit high2건으로 실패했다. 성공한 full receipt·후속 processor native 검사로 확대하지 않는다.
