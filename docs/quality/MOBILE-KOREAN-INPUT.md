# 모바일 한국어 입력 인수

2026-10-25 KST / #379·#334. 현재 상태는 **세 차례 실제 실행의 Settings 제어 탐색 실패, 한글 입력 미도달**이다.
기존 source6201112의 두 OS ASCII 입력/실제 software Search·회전 성공과
source9436e77의3사 인증 취소 성공을 한국어 IME 인수로 확대하지 않는다.

## iOS 독립 실행

현재 pin의 원본 Simulator 앱을 재컴파일/재서명하지 않는다. 성공한 main CI의 정확한 tooling
SHA에서 기존 `mobile-internal-ios-reverify.yml`을 `smoke=true`, `korean_directory=true`로
수동 실행한다. 나머지 관측 모드는 모두 false여야 하며 혼합/중복 flag는 거절한다.
앱 source9436e77과 tooling SHA, 컴파일러 receipt·원본 ZIP hash·실제 Simulator OS/모델을
각각 기록한다. 기기 SDK 무서명 컴파일은 이 런타임 검증을 대체하지 않는다.

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
