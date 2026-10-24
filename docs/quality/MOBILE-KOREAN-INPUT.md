# 모바일 한국어 입력 인수

2026-10-25 KST / #379·#334. 현재 상태는 **다섯 차례 실제 실행의 Settings 제어 탐색 실패, 한글 입력 미도달**이다.
기존 source6201112의 두 OS ASCII 입력/실제 software Search·회전 성공과
source9436e77의3사 인증 취소 성공을 한국어 IME 인수로 확대하지 않는다.

## iOS 독립 실행

현재 pin의 원본 Simulator 앱을 재컴파일/재서명하지 않는다. 성공한 main CI의 정확한 tooling
SHA에서 기존 `mobile-internal-ios-reverify.yml`을 `smoke=true`, `korean_directory=true`로
수동 실행한다. 나머지 관측 모드는 모두 false여야 하며 혼합/중복 flag는 거절한다.
앱 source와 tooling SHA, 컴파일러 receipt·원본 ZIP hash·실제 Simulator OS/모델을
각각 기록한다. 현재 실행은 줄바꿈 UI가 포함된 c8215b8 원본 pin을 사용하며, 아래 첫 세 실패는
이전9436 앱의 기록으로 보존한다. 기기 SDK 무서명 컴파일은 이 런타임 검증을 대체하지 않는다.

1. 기존대로 fresh owned CI Simulator에 원본 앱을 설치해 anonymous Home cold2회·Metro0을
   확인하고 인증/공개 탐색 전 PNG만 남긴다.
2. public capture boundary를 먼저 적용해 이후 raw command 로그·UI hierarchy·xcresult·
   screenshot을 export하지 않는다. 실패도 고정 assertion/단계·boolean만 보존한다.
3. [Apple이 안내하는 Settings 경로](https://support.apple.com/guide/iphone/iph73b71eb/ios)로
   General→Keyboard→Keyboards→Add New Keyboard→Korean→2-Set을 선택하고 목록을 확인한다.
   변경 대상은 이번 실행이 만든 Simulator뿐이다. host/사용자 기기 설정·preferences DB·
   입력 속도·third-party keyboard·계정 설정은 바꾸지 않는다.
4. BARO 공개 탐색 검색창에 초점을 두고 keyboard가 보이며 입력창이 keyboard 위에 있는지
   확인한다. 최대3번의 언어 순환 안에 실제 자모 키가 나타나야 한다. 불명 layout을 영어
   문자열 주입으로 우회하지 않는다.
5. 실제 software 자모 키 `ㅂ/ㅏ/ㄹ/ㅗ`를 각각 탭하고 `ㅂ/바/발/바로` 네 checkpoint를
   정확 비교한다. 공백 key로 조합을 확정한 뒤 delete로 그 공백을 지우고 `ㅂ/ㅏ`를
   추가해 `바로바`를 확인한다. paste/typeText/정규화로 성공을 만들지 않는다.
6. keyboard 안의 유일한 Search 제어를 실제 탭하고 keyboard 닫힘·오류 없는 검색 상태를
   확인한다. 합성 query에 장래 공개 프로필이 매치될 수 있으므로 결과 0개를 요구하지 않으며
   프로필 이름/ID/값은 읽거나 내보내지 않는다. HTTP transport 독립 증명은 false다.
7. 가로→세로 회전 후 입력값과 입력창의 조작 가능성, Home 복귀를 확인한다. 조합 중 회전·
   커서 중간 편집·긴 문장/붙여넣기·다른 키보드/OS·VoiceOver·실제 기기는 별도 인수다.

[XCTest의 tap](https://developer.apple.com/documentation/xcuiautomation/xcuielement/tap())을
실제 keyboard key에 사용한다. test runner만 컴파일하며 제품 앱 소스/번들에는 진단을
주입하지 않는다. 성공 proof는 별도 `ios-public-directory-korean-software-composition` kind다.
이전 ASCII proof와 서로 바꿔 인수할 수 없고 capture/source/device identity도 일치해야 한다.

## 남은 범위

Android의 실제 한글 software IME 조합은 아직 준비/검증하지 않았다. 두 OS의 고객/변호사
private 화면 전체·첨부 bar·긴 문장·초점/키보드·reader·물리 기기를 이 검사로 완료 처리하지
않는다. 실패 시 고정 단계/원인을 먼저 확인하고 조건 변경 전 같은 실행을 반복하지 않는다.
Apple 로그인 설정/계정·전체 #346/#339/#71/#334의 미완료 gate도 유지한다.

현재 source9436 anonymous Home의 두 OS PNG에서는 문단 끝 `요`가 한 행에 남는 줄바꿈도
관찰했다. glyph 표시·native launch와 문단 가독성 인수는 구분하며, 후속 M7에서 화면 크기/
글자 확대에 따른 줄바꿈을 개선·재검증한다. 이번 도구 변경으로 제품 UI를 고쳤다고 표시하지 않는다.

## 첫 실제 실행과 후속 조건

PR493/head6710f03의 CI40100949478 성공 뒤 main808a643/main CI40101102035에서
[actual40101331106](https://github.com/creno-va/baro/actions/runs/40101331106)을 실행했다.
원본9436 Simulator ZIP/receipt/metadata가 일치했고 iPhone16/iOS26.5의 cold native launch2회를
확인했다. Settings의 general→keyboard→keyboard-list 다음 `add-keyboard`에서
`BARO_KOREAN_SETTINGS_CONTROL_MISSING`으로 **FAILURE**다. 제품 검색창/조합 checkpoint는
미도달이며 BARO 입력 실패 또는 특정 ellipsis가 원인이라고 확정하지 않는다.

[원래 실패](./mobile-native-9436e77/ios-korean-40101331106/failure.json),
[Home 영수증](./mobile-native-9436e77/ios-korean-40101331106/home.json),
[metadata 재검증](./mobile-native-9436e77/ios-korean-40101331106/verification.json),
[탐색 전 PNG](./mobile-native-9436e77/ios-korean-40101331106/home-ios.png)와
[로컬 원본 결합](./mobile-native-9436e77/ios-korean-40101331106/local-preservation.json)을 보존한다.
PNG는 별도로 읽어 anonymous Home을 검토했으나 원래 homeContentVerified=false와
visualReviewRequired=true를 수정하지 않는다. 이후 raw hierarchy/xcresult/설정 화면 캡처는 없다.

PR495 도구는 Add New Keyboard의 ellipsis/세 점/생략 표기만 허용하는 고정 목록을 사용한다.
기존 cell/button과 같은 제어의 유일한 caption text를 조회하며, 복수 후보·서로 겹치지 않는
별도 제어·hittable 부재는 실패다. known label 밖의 fuzzy selector나 임의 좌표 탭은 없다.
기존12회 scroll 상한을 유지하고 매 단계 후보8개를 넘으면 즉시 실패한다. 최종 후보의
종류/개수·scroll 수만 제한된 diagnostic으로 남기며 raw label/frame/개인정보는 내보내지
않는다. 제품 앱·타이핑 값·조합 checkpoint·회전·성공 조건을 바꾸지 않는다. 새 조건의 실제
성공은 CI/main 이후 후속이며, 원본 실패를 지우거나 같은 조건으로 재실행하지 않았다.

## 두 번째 실행의 caption 모호성

PR495/main81e504f·CI40103566104 성공 뒤
[actual40103849176](https://github.com/creno-va/baro/actions/runs/40103849176)은 **FAILURE**였다.
iPhone16/iOS26.5에서 원본9436/metadata·native cold2는 대조했지만 Settings `keyboard-list`의
cell1/button1/text2가 기존 모든 유형≤1 조건에서 ambiguous로 거절됐다. caption 두 개를
거절한 경로는 확인됐으며, actionable owner의 실제 geometry·정확한 OS label 배치와 제품
입력 실패는 확인되지 않았다. 조합 checkpoint는0이고 같은 조건으로 재실행하지 않았다.

[원래 실패](./mobile-native-9436e77/ios-korean-40103849176/failure.json),
[Home 영수증](./mobile-native-9436e77/ios-korean-40103849176/home.json),
[재검증](./mobile-native-9436e77/ios-korean-40103849176/verification.json),
[탐색 전 PNG](./mobile-native-9436e77/ios-korean-40103849176/home-ios.png)와
[로컬 결합](./mobile-native-9436e77/ios-korean-40103849176/local-preservation.json)을 그대로 보존한다.
원래 Home homeContentVerified=false/visualReviewRequired=true와 전체 미완료 범위를 바꾸지 않는다.

후속은 cell/button의 유일한 actionable owner를 먼저 확인하고 두 유형이 있으면 면적의
95% 이상 겹치는 같은 제어인지 검사한다. 그 owner가 없을 때만 유일한 caption을 사용한다.
분리된 owner·중복 owner와 owner가 없는 다중 caption은 계속 거절한다. text 후보가 있다는
이유로 다른 위치의 owner를 무시하거나 임의 좌표를 탭하지 않는다. 후보8개/scroll12·고정
label·capture 차단·원문 미출력·조합/검색/회전 성공 조건은 유지한다.

실제 Swift 판단 함수를 별도 Apple Foundation/CoreGraphics probe로 컴파일해 synthetic
rectangle12조건(중복 caption/유일 owner, 분리·중복 owner, caption-only/없음,95% 경계,
후보 상한)을 확인한다. UIKit/Settings/runtime 성공은 아니며 owned macOS workflow에서
이 검사를 필수로 통과해야 실제 관측을 시작한다. 신규 diagnostic은 ownersOverlap boolean을
남기고 기존 field가 없던 실패 기록은 당시 규칙으로 읽어 과거 관측을 재해석하지 않는다.
새 조건의 실제 실행은 정확한 CI/main 뒤다. UI PR496은 앱 입력을 바꾸므로 tooling의
원본9436 trial을 먼저 dispatch한 뒤 별도 통합·새 컴파일/pin으로 인수한다.

## 세 번째 실행의 layout 조회

PR499/main b4e146d·CI40106184967 뒤
[actual40106535873](https://github.com/creno-va/baro/actions/runs/40106535873)은 **FAILURE**였다.
정확한 Swift/CoreGraphics owner policy probe는 통과했다. 실제 Settings의 Korean 항목은
cell1/button0/text1·ownersOverlap=true·scroll6에서 선택했으나 다음 layout에서
`BARO_KOREAN_LAYOUT_MISSING`으로 끝났다. 기존 layout 조회는 cell의 literal2-Set에만
의존했다. 정확한 화면 표기/제어 유형·원인은 아직 미확정이며, BARO 입력창/조합은 미도달이다.

[원래 실패](./mobile-native-9436e77/ios-korean-40106535873/failure.json),
[Home](./mobile-native-9436e77/ios-korean-40106535873/home.json),
[metadata 재검증](./mobile-native-9436e77/ios-korean-40106535873/verification.json),
[탐색 전 PNG](./mobile-native-9436e77/ios-korean-40106535873/home-ios.png),
[독립 결합](./mobile-native-9436e77/ios-korean-40106535873/local-preservation.json)을 보존했다.
원본9436/도구b4e의 source와 범위를 유지하며 다음 c821 UI 앱의 한글 입력 증거로 재사용하지 않는다.

후속은 고정 `2-Set`/`2-Set (QWERTY)`만 조회한다. 직접 cell label이 없으면
[Apple의 containing query](https://developer.apple.com/documentation/xcuiautomation/xcuielementquery/containing(_:))로
같은 고정 label의 descendant를 가진 실제 cell owner를 찾고 기존 유일성·95% 겹침을 유지한다.
선택 상태를 확인할 actionable owner 없이 caption만 눌러 진행하지 않는다. Done도 같은
owner 원칙으로 고른다. readback·실제 자모/공백 확정·삭제·추가/검색/회전 조건은 유지한다.

선택 전후 traitSelected·value의 absent/selected/unselected/empty/other 분류, 알려진
Standard/10-Key 존재·Korean 제목·Done의 제한된 count/boolean을 진단한다. 다른 layout은
존재만 관측하고 선택하지 않으며 raw label/value/frame·UI hierarchy/xcresult는 export하지
않는다. 다음 실제 관측은 새 c821 원본 compiler 검증/pin과 정확한 CI/main 이후다.

## 네 번째 실행과 제품 없는 Settings 참고 검사

PR501의 도구·PR502/main1906321 원본 pin·CI40110871760 뒤
[actual40111078106](https://github.com/creno-va/baro/actions/runs/40111078106)은 **FAILURE**였다.
새 c8215b8 원본/receipt·native cold2·device를 대조했다. Korean 제목과 hittable Done1은
관측됐지만 layout의 cell/button/text는 모두0이었다. known-descendant 조회도 후보가 없고
Standard/10-Key의 고정 표기도 관측되지 않았다. `BARO_KOREAN_LAYOUT_MISSING`·exit65이며
조합 checkpoint는0이다. 정확한 OS 선택지 이름/구조와 제품 입력 실패는 확인되지 않았다.

[원래 실패](./mobile-native-c8215b8/ios-korean-40111078106/failure.json),
[Home](./mobile-native-c8215b8/ios-korean-40111078106/home.json),
[metadata](./mobile-native-c8215b8/ios-korean-40111078106/verification.json),
[탐색 전 PNG](./mobile-native-c8215b8/ios-korean-40111078106/home-ios.png)와
[독립 원본 결합](./mobile-native-c8215b8/ios-korean-40111078106/local-preservation.json)을 보존한다.
같은 조건으로 재실행하거나 다른 layout을 추측 선택하지 않았다.

다음은 `mobile-ios-keyboard-reference.yml`의 독립 수동 참고 검사다. exact green main의
도구만 사용해 새 owned iPhone16 Simulator를 만들고 **BARO 제품 앱이 실행 전후 모두 없는지**
SDK inventory로 확인한다. 제품 앱/별도 reference app을 설치하지 않고 UI test runner만
컴파일한다. 현재 제품 runner와 같은 Settings navigation helper를 사용해 Korean 제목과
Done이 보이는 화면에 도달하며, layout 선택이나 제품 입력은 하지 않는다.

이 별도 참고 검사는 Korean 화면 body 안에 완전히 들어오는 cell/button/static-text의
**공개 OS 제어 이름·유형만** 최대32개/이름160자로 보존한다. navigation bar·값·identifier·
좌표·부모/자식 관계·전체 hierarchy·screenshot·raw command log·xcresult는 export하지 않는다.
이는 새 CI Simulator의 OS 설정 참고 범위이며, 임의 계정/제품 화면의 문자열을 정제해
공개하는 기능이 아니다. 기존 제품/인증/공개 탐색 capture boundary는 그대로다.
검사 뒤 해당 Simulator와 임시 build/results를 정리한다. 실제 선택지 관측 뒤 정확한
제어를 연결하고 원래6자모/4checkpoint·공백 확정/삭제·추가·Search·회전을 다시 검증한다.
참고 검사 자체는 한국어 입력·제품/로그인·physical/store 인수가 아니다.

## 실제 Settings 참고 결과와 후속 연결

PR507/main eb7ea62의 CI40113858176 뒤
[reference40114158334](https://github.com/creno-va/baro/actions/runs/40114158334)은 **SUCCESS**다.
[원래 receipt](./mobile-keyboard-reference-40114158334/receipt.json),
[cleanup](./mobile-keyboard-reference-40114158334/cleanup.json)과
[원본 source/hash 결합](./mobile-keyboard-reference-40114158334/local-preservation.json)을 보존했다.
정확한eb7ea62 git tree의 합친 Swift와 Ruby hash·workflow/artifact identity를 대조했다.
제품 부재·Sim 삭제·private results 정리를 확인했으며 제품 입력·layout 선택은 하지 않았다.

Korean 화면 body에서12개 공개 OS 제어 이름/유형을 관측했다. `Add to English (US) Keyboard`와
`Add New Keyboard`가 있고, 후자는 cell2/button1/static-text1로 표현됐다. 기존 English/Emoji
항목도 같은 snapshot에 있어 화면 안에 있다는 이유만으로 현재 조작 가능한 owner라고
가정하지 않는다. 이는 이전 literal2-Set layout 조회가 현재의 별도 키보드 준비 선택지를
처리하지 못한 증거이며, 제품의 한글 조합 실패 증거는 아니다.

후속 제품 runner는 Korean 제목과 관측된 고정 prompt가 있는 경우에만 `Add New Keyboard`의
실제 fully-hittable cell/button을 고른다. 쿼리 후보8개 상한과 기존 유일 owner·95% 겹침 정책을
재사용하며 모호하거나 조작 불가능하면 실패한다. 이후 명시적 known layout이 있으면
기존대로 선택하고, 없으면 **관측된 별도 키보드 추가 제어를 탭한 경우에만** OS 기본 layout을
바꾸지 않은 채 Done·Korean 목록 readback으로 진행한다. unknown/다른 layout을 선택하거나
일반적인 layout 실패를 건너뛰지 않는다. legacy 경로에서는 기존 layout 선택이 계속 필요하다.

새 결과의 `separateKeyboardChosen`·`settingsLayoutChoiceObserved`는 실제 준비 경로를 구분한다.
둘 모두 false이거나 한쪽만 있는 새 증거는 거부하고, 두 field가 없던 과거 fixture는 당시
형태로 읽는다. 실제 보이는 자모6tap/4checkpoint·공백 확정/삭제·추가·software Search·회전과
capture boundary는 유지한다. 따라서 OS 기본 layout이 맞지 않으면 실제 키/조합 검사에서
실패하며, 참고 검사나 준비 단계만으로 한국어 입력을 완료 처리하지 않는다.

## 다섯 번째 실행의 분리된 owner와 조회 범위

PR508/main7ec6352·CI40116651207 뒤
[actual40116874262](https://github.com/creno-va/baro/actions/runs/40116874262)은 **FAILURE**였다.
Korean 제목/고정 prompt는 보였고 eligible cell1/button1이 검출됐지만 서로95% 겹치지 않아
`ambiguous/blocked`·`BARO_KOREAN_SEPARATE_CHOICE_MISSING`으로 멈췄다. 조합 checkpoint는0이다.
다른 위치의 제어라는 사실은 확인됐지만 어느 제어가 전경/배경인지나 제품 입력 실패를
확정하지 않는다.

[원래 실패](./mobile-native-c8215b8/ios-korean-40116874262/failure.json),
[Home](./mobile-native-c8215b8/ios-korean-40116874262/home.json),
[metadata](./mobile-native-c8215b8/ios-korean-40116874262/verification.json),
[탐색 전 PNG](./mobile-native-c8215b8/ios-korean-40116874262/home-ios.png)와
[원본 결합](./mobile-native-c8215b8/ios-korean-40116874262/local-preservation.json)을 보존한다.
다음은 고정 prompt `Add to English (US) Keyboard`를 포함한 table/collection 하나 안에서만
제어를 조회한다. container 누락/중복·조작 불가·분리/중복 owner는 계속 거절하고 임의의
첫 제어를 탭하지 않는다. 새 diagnostic은 scope 유형/개수만 추가하며 과거 unscoped 실패를
해당 scope의 성공으로 재해석하지 않는다. 자모/수정/검색/회전 인수는 그대로다.

## Android 제품 없는 IME 등록 정보 준비

`mobile-android-ime-reference.yml`은 기존 Google APIs Android35 image의 fresh owned AVD를
만들어 제품 부재와 실제 boot/AVD identity·PackageManager readiness를 확인한다.
설치 없이 `ime list -a --user 0`·기본 IME의 read-only 설정 조회만 수행한다.
[Android15 IME dump](https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/core/java/android/view/inputmethod/InputMethodInfo.java)와
[subtype dump](https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/core/java/android/view/inputmethod/InputMethodSubtype.java)의
개수/순번·locale/languageTag/mode가 완전하고 default가 등록 목록과 일치해야 한다.
미지원 형식/누락은 실패로 남기며 한국어0개로 대체하지 않는다.

출력은 Gboard/AOSP/other enum·현재 default 여부·등록 subtype/한국어 keyboard subtype 수,
public SDK model/API·시각/metadata hash와 cleanup 사실뿐이다. raw metadata·component/package
이름·locale·값·계층·screenshot·command log를 export하지 않는다. keyboard/언어 설정을
바꾸거나 software key를 탭하지 않고, 별도 키보드 APK·계정·BARO 앱도 설치하지 않는다.
프로세스 종료·owned AVD/임시 파일 정리에 실패하면 성공 receipt를 남기지 않는다.
이는 해당 시점의 등록 정보이며0개가 동적 language download나 실제 한국어 지원 불가를
뜻하지 않는다. 실제 software IME 조합·Android 제품 입력과 물리 기기 인수는 별도다.

새 iOS 참고 workflow의 기본 `mode=inspect`는 기존 공개 OS 이름 관측을 유지한다.
`mode=setup`은 별도 고정 test selector와 `ios-owned-korean-keyboard-setup-reference-only` kind로
공유 Settings 준비 helper만 실행해 Korean 목록 readback까지 확인한다. 제품/reference 앱을
설치·실행하지 않으며 raw label/값/계층/화면을 export하지 않는다. OS 언어 추가는 이번
owned Simulator에만 수행하고 이후 정리한다. setup 결과의 layout identity·실제 한국어
키 입력·제품 input 검증은 모두 false로 유지한다. 이는 새 앱 compile/pin 대기 중 준비
단계를 분리해 검증하는 보조 경로이며, 실제 RN 앱의6자모/4checkpoint 인수를 대체하지 않는다.

### Android 참고 실행의 시작 실패

[40120710320](https://github.com/creno-va/baro/actions/runs/40120710320)은 source92f4232의 실제
FAILURE다. SDK 준비/CI 검사는 통과했지만 도구가 `ANDROID_IME_REFERENCE_BOOTSTRAP_FAILED`로
종료했고 receipt/metadata/cleanup artifact는0개였다. [로컬 관측](./mobile-keyboard-reference-40120710320/local-observation.json)은
원래 producer receipt가 아니며 IME 등록 정보·Korean 지원·기기 인수로 사용하지 않는다.

원본 source를 확인하면 command용 `internalAndroidEnvironment` allowlist가 TARGET_SHA를
제외하는데 도구가 그 child env에서 source를 읽어 owned 디렉터리 생성 전 실패했다. 수정은
원래 입력의 full SHA를 별도로 검증·보존하면서 command env의 secret 제외를 유지한다.
합성 회귀는 source 보존과 invalid/missing SHA·SDK 거절 및 credential 비전달을 함께 확인한다.
새 exact CI/main 뒤 변경된 도구로 실행하며 같은 실패 조건을 재시도하지 않는다.

### iOS 설정 준비의 실제 성공

source92f4232의 [setup 참고40120708133](https://github.com/creno-va/baro/actions/runs/40120708133)은
SUCCESS다. prompt를 포함한 유일 list 안에서 별도 키보드 추가를 선택한 뒤 layout 후보 관측과
Korean 목록 readback까지 통과했다. 이 실행은 product 없는 iPhone16/iOS26.5 owned Simulator의
OS 준비만 확인한다. [원본 receipt](./mobile-keyboard-setup-reference-40120708133/receipt.json)와
[cleanup](./mobile-keyboard-setup-reference-40120708133/cleanup.json)을 그대로 보존하며,
[독립 결합](./mobile-keyboard-setup-reference-40120708133/local-preservation.json)에서 실제 run/artifact의
source·성공·3개 Swift source 결합 hash와 Ruby generator hash를 대조했다.

제품/reference 앱은 설치하지 않았고 account 입력·screenshot/raw log/xcresult export 없이
Simulator와 임시 결과 정리를 확인했다. 원래 결과의 layout identity·Korean keyboard·제품 입력은
false다. 기존 다섯 제품 실행의 실패를 바꾸지 않으며 새 앱 원본 pin 뒤 실제6자모/4checkpoint·
공백 확정/삭제/추가·Search·회전으로 별도 인수한다.

### Android SDK 입력기 등록 정보의 실제 관측

수정된 source784d60d의 [40122015296](https://github.com/creno-va/baro/actions/runs/40122015296)은
SUCCESS다. [원본 receipt](./mobile-keyboard-reference-40122015296/receipt.json)와
[cleanup](./mobile-keyboard-reference-40122015296/cleanup.json),
[source/run/artifact 결합](./mobile-keyboard-reference-40122015296/local-preservation.json)을 보존한다.
Android35 Google APIs fresh image의 현재 default는 Gboard이며 등록 subtype144개 중 parser의
Korean keyboard 조건과 일치하는 항목은0개였다. 다른 입력기1개/subtype1개도 관측했다.
이는 등록 metadata의 사실이며 Gboard의 동적 언어 추가·실제 Korean 지원 부재를 입증하지 않는다.

BARO/추가 키보드 앱·계정 없이 설정 변경/키tap0으로 실행했고 owned Emulator 종료·AVD 삭제·
임시 파일 정리가 통과했다. raw metadata/계층/화면/log를 export하지 않았다. 다음은 이 SDK의
공개 Gboard 언어 설정 경로를 별도로 관측한 뒤 실제 software key 조합을 준비하는 것이며,
metadata 성공을 제품 입력이나 물리 기기의 한국어 인수로 확대하지 않는다.

### Gboard 공개 설정 참고 도구 준비

동일 fresh owned image의 선택된 Gboard metadata에서 settings activity를 검증해
[Android 공식 방식](https://developer.android.com/reference/android/view/inputmethod/InputMethodInfo#getSettingsActivity())의
MAIN/명시적 component로만 연다. `mode=settings`는 전후 foreground가 그 activity와 일치하고
Gboard 제목·알려진 설정 메뉴 둘 이상을 관측해야 고정 메뉴별 개수만 남긴다.
언어 추가 경로는 [공식 안내](https://support.google.com/gboard/answer/7068494?hl=en)를 참고하되,
이 첫 관측에서 Languages/keyboard/layout 선택이나 키 입력을 수행하지 않는다.

raw label·EditText 값·resource ID·bounds·계층·화면·command log를 export하지 않으며 raw dump는
소유 Emulator의 UUID 파일로만 잠깐 읽고 삭제/부재를 확인한다. 잘못된 package/activity·
미확인/중복 foreground·미확인 저장 경로·잘못된 XML·제목/메뉴 scope 누락은 거절한다.
기본 metadata 모드는 그대로이고 실제 keyboard preference 변경은 요청하지 않는다.
이 준비는 제품 없는 고정 count 참고이며 실제 SDK 실행 성공이나 조작 가능한 owner·
언어 추가·한국어 조합 인수가 아니다. 실제 실행은 새 exact CI/main 뒤 별도로 확인한다.
